// Runs inside the preview webview.

interface VsCodeApi {
  postMessage(message: unknown): void;
  getState(): unknown;
  setState(state: unknown): void;
}
declare function acquireVsCodeApi(): VsCodeApi;

type ToWebview =
  | { type: 'update'; html: string; full?: boolean }
  | { type: 'scroll'; line: number }
  | { type: 'fill'; items: { key: string; html: string }[] };

const vscode = acquireVsCodeApi();
const root = document.getElementById('root') as HTMLElement;

/** Set while the preview scrolls itself, so the scroll handler can ignore it. */
let syncing = false;

function lineElements(): HTMLElement[] {
  // Lines inside embeds belong to other notes.
  return Array.from(root.querySelectorAll<HTMLElement>('[data-line]')).filter((el) => !el.parentElement?.closest('[data-source]'));
}

/** Scrolls so the element for the last block starting at or before `line` is at the top. */
function scrollToLine(line: number) {
  let target: HTMLElement | undefined;
  for (const el of lineElements()) {
    const l = Number(el.dataset['line']);
    if (l <= line && (!target || l >= Number(target.dataset['line']))) target = el;
  }
  syncing = true;
  if (target) window.scrollTo({ top: target.getBoundingClientRect().top + window.scrollY - 8 });
  else window.scrollTo({ top: 0 });
  requestAnimationFrame(() => (syncing = false));
}

/** The top-level blocks of the last page received, as HTML, in the order they are in `root`. */
let lastBlocks: string[] = [];

/**
 * Shows new HTML by replacing only the top-level blocks that changed. Typing in one paragraph then
 * leaves every other block alone, so images don't reload, open `<details>` stay open, selections and
 * scroll position survive, and a long note doesn't re-layout. `full` replaces everything, which a
 * refused edit needs in order to undo changes the page made ahead of the source.
 */
function update(html: string, full = false) {
  const y = window.scrollY;
  const template = document.createElement('template');
  template.innerHTML = html;
  const incoming = Array.from(template.content.children);
  const incomingHtml = incoming.map((el) => el.outerHTML);
  const current = Array.from(root.children);

  if (full || current.length !== lastBlocks.length) {
    // The page and the record of it disagree, or a full refresh was asked for.
    root.replaceChildren(...incoming);
    lastBlocks = incomingHtml;
    addCopyButtons(root);
    for (const [key, cached] of fills) applyFill(key, cached);
  } else {
    // Keep the blocks that start and end the same, and swap only the ones in between.
    let head = 0;
    while (head < lastBlocks.length && head < incomingHtml.length && lastBlocks[head] === incomingHtml[head]) head++;
    let tail = 0;
    while (
      tail < lastBlocks.length - head &&
      tail < incomingHtml.length - head &&
      lastBlocks[lastBlocks.length - 1 - tail] === incomingHtml[incomingHtml.length - 1 - tail]
    ) {
      tail++;
    }
    const removed = current.slice(head, current.length - tail);
    const added = incoming.slice(head, incoming.length - tail);
    const anchor = current[current.length - tail] ?? null;
    for (const el of removed) el.remove();
    for (const el of added) root.insertBefore(el, anchor);
    lastBlocks = incomingHtml;
    for (const el of added) {
      addCopyButtons(el);
      // Database views keep showing their last result until fresh data arrives, so typing doesn't blank them.
      for (const slot of matching<HTMLElement>(el, '.db-slot')) {
        const cached = fills.get(slot.dataset['dbKey'] ?? '');
        if (cached !== undefined) applyFill(slot.dataset['dbKey'] ?? '', cached);
      }
    }
  }
  restoreCollapsed();
  restoreFocus();
  window.scrollTo({ top: y });
}

// ---- Code blocks ----

/** `scope` itself and the elements inside it that match `selector`. */
function matching<T extends HTMLElement>(scope: ParentNode, selector: string): T[] {
  const inside = Array.from(scope.querySelectorAll<T>(selector));
  return scope instanceof HTMLElement && scope.matches(selector) ? [scope as T, ...inside] : inside;
}

function addCopyButtons(scope: ParentNode) {
  for (const block of matching<HTMLElement>(scope, '.code-block')) {
    if (block.querySelector(':scope > .code-copy')) continue;
    const button = document.createElement('button');
    button.type = 'button';
    button.className = 'code-copy';
    button.textContent = 'Copy';
    button.setAttribute('aria-label', 'Copy code');
    block.append(button);
  }
}

root.addEventListener('click', (event) => {
  const button = (event.target as Element).closest<HTMLButtonElement>('.code-copy');
  const code = button?.parentElement?.querySelector('pre code');
  if (!button || !code) return;
  void navigator.clipboard.writeText((code.textContent ?? '').replace(/\n$/, '')).then(() => {
    button.textContent = 'Copied';
    button.classList.add('copied');
    setTimeout(() => {
      button.textContent = 'Copy';
      button.classList.remove('copied');
    }, 1200);
  });
});

// ---- Quiz mode: hidden answers (`:cloze[…]`) are shown when clicked ----

function toggleCloze(target: EventTarget | null): boolean {
  const cloze = (target as Element | null)?.closest<HTMLElement>('.cloze-hidden');
  if (!cloze) return false;
  cloze.classList.toggle('revealed');
  return true;
}

root.addEventListener('click', (event) => {
  if (toggleCloze(event.target)) event.preventDefault();
});
root.addEventListener('keydown', (event) => {
  if ((event.key === 'Enter' || event.key === ' ') && toggleCloze(event.target)) event.preventDefault();
});

// ---- Task checkboxes ----

root.addEventListener('change', (event) => {
  const box = event.target;
  if (!(box instanceof HTMLInputElement) || !box.classList.contains('task-toggle')) return;
  vscode.postMessage({
    type: 'toggleTask',
    line: Number(box.dataset['line']),
    hash: box.dataset['hash'],
    done: box.checked,
    source: box.dataset['source'],
  });
});

// ---- Kanban boards ----

interface State {
  /** Collapsed columns, as `boardLine:columnTitle`. */
  collapsed?: string[];
}

const state = (): State => (vscode.getState() as State | undefined) ?? {};

/** What to focus after the next render: a card by board, column and index, or a column's add box. */
let pendingFocus: { board: number; column: number; index?: number; add?: boolean } | undefined;

const boardOf = (el: Element) => el.closest<HTMLElement>('.kanban');
const isInteractive = (el: Element) => boardOf(el)?.hasAttribute('data-interactive') ?? false;
const columnKey = (section: HTMLElement) =>
  `${boardOf(section)?.dataset['board']}:${section.querySelector('.kanban-column-title')?.textContent ?? ''}`;

function cardRef(card: HTMLElement) {
  return { line: Number(card.dataset['line']), hash: card.dataset['hash'] ?? '' };
}

function columnsOf(board: HTMLElement): HTMLElement[] {
  return Array.from(board.querySelectorAll<HTMLElement>(':scope > .kanban-columns > .kanban-column'));
}

function cardsIn(list: Element, except?: Element): HTMLElement[] {
  return Array.from(list.querySelectorAll<HTMLElement>(':scope > .kanban-card')).filter((c) => c !== except);
}

/** Moves a card in the DOM right away, then asks the extension to move it in the source. */
function move(card: HTMLElement, toColumn: number, toIndex: number) {
  const board = boardOf(card);
  const target = board && columnsOf(board)[toColumn]?.querySelector<HTMLElement>('.kanban-cards');
  if (!board || !target) return;
  const others = cardsIn(target, card);
  target.insertBefore(card, others[toIndex] ?? null);
  card.focus();
  if (board.classList.contains('db-board')) {
    // A database board: the column sets the grouped property; the position orders rows.
    const column = target.closest<HTMLElement>('.kanban-column');
    const next = cardsIn(target, card)[toIndex];
    postDb(board, {
      op: 'move',
      rowId: card.dataset['rowId'],
      groupValue: JSON.parse(column?.dataset['groupValue'] ?? 'null'),
      beforeId: board.hasAttribute('data-reorder') ? (next?.dataset['rowId'] ?? null) : undefined,
    });
    return;
  }
  const boardLine = Number(board.dataset['board']);
  pendingFocus = { board: boardLine, column: toColumn, index: toIndex };
  vscode.postMessage({ type: 'kanbanMove', board: boardLine, card: cardRef(card), toColumn, toIndex, source: board.dataset['source'] });
}

function position(card: HTMLElement) {
  const list = card.parentElement as HTMLElement;
  return { column: Number(list.dataset['column']), index: cardsIn(list).indexOf(card) };
}

function restoreFocus() {
  const f = pendingFocus;
  pendingFocus = undefined;
  if (!f) return;
  const board = root.querySelector<HTMLElement>(`.kanban[data-board="${f.board}"]`);
  const column = board && columnsOf(board)[f.column];
  if (!column) return;
  const el = f.add
    ? column.querySelector<HTMLElement>('.kanban-add-input')
    : cardsIn(column.querySelector('.kanban-cards') as Element)[f.index ?? 0];
  el?.focus();
}

function setCollapsed(section: HTMLElement, collapsed: boolean) {
  section.classList.toggle('collapsed', collapsed);
  const button = section.querySelector<HTMLElement>('.kanban-collapse');
  button?.setAttribute('aria-expanded', String(!collapsed));
  const title = section.getAttribute('aria-label') ?? '';
  button?.setAttribute('aria-label', `${collapsed ? 'Expand' : 'Collapse'} ${title}`);
}

function restoreCollapsed() {
  const collapsed = new Set(state().collapsed ?? []);
  for (const section of Array.from(root.querySelectorAll<HTMLElement>('.kanban-column'))) {
    if (collapsed.has(columnKey(section))) setCollapsed(section, true);
  }
}

root.addEventListener('click', (event) => {
  const button = (event.target as Element).closest<HTMLElement>('.kanban-collapse');
  const section = button?.closest<HTMLElement>('.kanban-column');
  if (!section) return;
  const collapsed = !section.classList.contains('collapsed');
  setCollapsed(section, collapsed);
  const keys = new Set(state().collapsed ?? []);
  if (collapsed) keys.add(columnKey(section));
  else keys.delete(columnKey(section));
  vscode.setState({ ...state(), collapsed: [...keys] });
});

// Drag and drop.
let dragged: HTMLElement | null = null;
const indicator = document.createElement('div');
indicator.className = 'kanban-drop-indicator';

/** Index among the column's cards (without the dragged one) where a drop at `y` lands. */
function dropIndex(list: HTMLElement, y: number): number {
  const cards = cardsIn(list, dragged ?? undefined);
  const i = cards.findIndex((c) => {
    const r = c.getBoundingClientRect();
    return y < r.top + r.height / 2;
  });
  return i === -1 ? cards.length : i;
}

root.addEventListener('dragstart', (event) => {
  const card = (event.target as Element).closest<HTMLElement>('.kanban-card');
  if (!card || !isInteractive(card)) return;
  dragged = card;
  card.classList.add('dragging');
  event.dataTransfer?.setData('text/plain', card.getAttribute('aria-label') ?? '');
  if (event.dataTransfer) event.dataTransfer.effectAllowed = 'move';
});

root.addEventListener('dragover', (event) => {
  const list = (event.target as Element).closest<HTMLElement>('.kanban-column')?.querySelector<HTMLElement>('.kanban-cards');
  if (!dragged || !list || boardOf(list) !== boardOf(dragged)) return;
  event.preventDefault();
  if (event.dataTransfer) event.dataTransfer.dropEffect = 'move';
  const cards = cardsIn(list, dragged);
  list.insertBefore(indicator, cards[dropIndex(list, event.clientY)] ?? null);
});

root.addEventListener('drop', (event) => {
  const list = indicator.parentElement;
  if (!dragged || !list) return;
  event.preventDefault();
  const toIndex = dropIndex(list, event.clientY);
  indicator.remove();
  const card = dragged;
  const from = position(card);
  const toColumn = Number(list.dataset['column']);
  if (from.column !== toColumn || from.index !== toIndex) move(card, toColumn, toIndex);
});

root.addEventListener('dragend', () => {
  dragged?.classList.remove('dragging');
  dragged = null;
  indicator.remove();
});

// Keyboard moves: Alt+Up/Down within a column, Alt+Left/Right to the neighboring column.
root.addEventListener('keydown', (event) => {
  const card = (event.target as Element).closest<HTMLElement>('.kanban-card');
  if (!card || event.target !== card || !event.altKey || !isInteractive(card)) return;
  const board = boardOf(card);
  if (!board) return;
  const { column, index } = position(card);
  const columnCount = columnsOf(board).length;
  const count = (c: number) => cardsIn(columnsOf(board)[c]?.querySelector('.kanban-cards') as Element, card).length;
  let to: { column: number; index: number } | undefined;
  if (event.key === 'ArrowUp' && index > 0) to = { column, index: index - 1 };
  else if (event.key === 'ArrowDown' && index < count(column)) to = { column, index: index + 1 };
  else if (event.key === 'ArrowLeft' && column > 0) to = { column: column - 1, index: count(column - 1) };
  else if (event.key === 'ArrowRight' && column < columnCount - 1) to = { column: column + 1, index: count(column + 1) };
  if (!to) return;
  event.preventDefault();
  move(card, to.column, to.index);
});

// Adding cards.
root.addEventListener('submit', (event) => {
  const form = (event.target as Element).closest<HTMLFormElement>('.kanban-add');
  const input = form?.querySelector<HTMLInputElement>('.kanban-add-input');
  const board = form && boardOf(form);
  if (!form || !input || !board) return;
  event.preventDefault();
  const text = input.value.trim();
  if (!text) return;
  const column = Number(form.dataset['column']);
  const boardLine = Number(board.dataset['board']);
  pendingFocus = { board: boardLine, column, add: true };
  vscode.postMessage({ type: 'kanbanAdd', board: boardLine, column, text, source: board.dataset['source'] });
  input.value = '';
});

// Editing a card title in place.
root.addEventListener('dblclick', (event) => {
  const text = (event.target as Element).closest<HTMLElement>('.kanban-card-text');
  const card = text?.closest<HTMLElement>('.kanban-card');
  const board = card && boardOf(card);
  if (!text || !card || !board || !isInteractive(card)) return;
  const input = document.createElement('input');
  input.type = 'text';
  input.className = 'kanban-title-input';
  input.value = text.dataset['title'] ?? text.textContent ?? '';
  input.setAttribute('aria-label', 'Card title');
  const original = text.innerHTML;
  let done = false;
  const finish = (save: boolean) => {
    if (done) return;
    done = true;
    const title = input.value.trim();
    if (save && title && title !== text.dataset['title']) {
      const { column, index } = position(card);
      pendingFocus = { board: Number(board.dataset['board']), column, index };
      text.textContent = title;
      vscode.postMessage({ type: 'kanbanRename', board: Number(board.dataset['board']), card: cardRef(card), title, source: board.dataset['source'] });
    } else {
      text.innerHTML = original;
    }
    card.draggable = true;
    card.focus();
  };
  input.addEventListener('keydown', (e) => {
    e.stopPropagation();
    if (e.key === 'Enter') finish(true);
    else if (e.key === 'Escape') finish(false);
  });
  input.addEventListener('blur', () => finish(true));
  card.draggable = false;
  text.replaceChildren(input);
  input.focus();
  input.select();
});

window.addEventListener('message', (event: MessageEvent<ToWebview>) => {
  const m = event.data;
  if (m.type === 'update') update(m.html, m.full);
  else if (m.type === 'fill') fill(m.items);
  else if (m.type === 'scroll' && !syncing) scrollToLine(m.line);
});

// Show alt text in place of images that fail to load.
document.addEventListener(
  'error',
  (event) => {
    const img = event.target;
    if (!(img instanceof HTMLImageElement)) return;
    const span = document.createElement('span');
    span.className = 'image-missing';
    span.textContent = img.alt || img.getAttribute('src') || 'Missing image';
    img.replaceWith(span);
  },
  true,
);

document.addEventListener('click', (event) => {
  const link = (event.target as Element | null)?.closest('a');
  const href = link?.getAttribute('href');
  if (!link || !href) return;
  event.preventDefault();
  if (href.startsWith('#')) {
    const id = decodeURIComponent(href.slice(1));
    document.getElementById(id)?.scrollIntoView({ block: 'start' });
    return;
  }
  // Links inside an embed are relative to the embedded note; an embed's title link is relative to the outer one.
  const from = link.classList.contains('embed-title') ? link.parentElement?.parentElement : link;
  const source = from?.closest<HTMLElement>('[data-source]')?.dataset['source'];
  vscode.postMessage({ type: 'link', href, source });
});

vscode.postMessage({ type: 'ready' });


// ---- Database views and queries ----

interface ColumnMeta {
  name: string;
  type: string;
  options?: string[];
}

/** Sort and search per placeholder, kept across re-renders of its data. */
const viewState = new Map<string, { sort?: { prop: string; desc: boolean }; search?: string }>();

const slotKey = (el: Element) => el.closest<HTMLElement>('.db-slot')?.dataset['dbKey'] ?? '';

function postDb(el: Element, message: Record<string, unknown>) {
  vscode.postMessage({ type: 'db', key: slotKey(el), ...message });
}

/** The last HTML received for each database view or query. */
const fills = new Map<string, string>();

function applyFill(key: string, html: string) {
  const slot = root.querySelector<HTMLElement>(`.db-slot[data-db-key="${CSS.escape(key)}"]`);
  if (!slot) return;
  slot.innerHTML = html;
  slot.classList.add('filled');
  const state = viewState.get(key);
  if (state?.sort) applySort(slot, state.sort.prop, state.sort.desc);
  if (state?.search) {
    const input = slot.querySelector<HTMLInputElement>('.db-search');
    if (input) input.value = state.search;
    applySearch(slot, state.search);
  }
}

function fill(items: { key: string; html: string }[]) {
  // The host sends every view of the note, so views that no longer exist can be forgotten.
  fills.clear();
  for (const { key, html } of items) {
    fills.set(key, html);
    applyFill(key, html);
  }
}

function cellValue(cell: Element | null): unknown {
  try {
    return JSON.parse((cell as HTMLElement | null)?.dataset['value'] ?? 'null');
  } catch {
    return null;
  }
}

function applySort(slot: HTMLElement, prop: string, desc: boolean) {
  for (const table of Array.from(slot.querySelectorAll<HTMLTableElement>('table.db-table'))) {
    const head = Array.from(table.querySelectorAll<HTMLElement>('th[data-prop]'));
    const index = head.findIndex((th) => th.dataset['prop'] === prop);
    head.forEach((th, i) => th.setAttribute('aria-sort', i === index ? (desc ? 'descending' : 'ascending') : 'none'));
    if (index === -1) continue;
    const body = table.tBodies[0];
    if (!body) continue;
    const rows = Array.from(body.rows);
    const key = (r: HTMLTableRowElement) => {
      const v = cellValue(r.cells[index] ?? null);
      return Array.isArray(v) ? v.join(', ') : v;
    };
    rows.sort((a, b) => {
      const x = key(a);
      const y = key(b);
      if (x === y) return 0;
      if (x === null || x === undefined) return 1;
      if (y === null || y === undefined) return -1;
      const cmp = typeof x === 'number' && typeof y === 'number' ? x - y : String(x).localeCompare(String(y), undefined, { numeric: true });
      return desc ? -cmp : cmp;
    });
    body.append(...rows);
  }
}

function applySearch(slot: HTMLElement, query: string) {
  const q = query.trim().toLowerCase();
  for (const item of Array.from(slot.querySelectorAll<HTMLElement>('[data-row-id]'))) {
    item.hidden = q !== '' && !(item.textContent ?? '').toLowerCase().includes(q);
  }
}

root.addEventListener('input', (event) => {
  const input = event.target;
  if (!(input instanceof HTMLInputElement) || !input.classList.contains('db-search')) return;
  const slot = input.closest<HTMLElement>('.db-slot');
  if (!slot) return;
  const key = slotKey(slot);
  viewState.set(key, { ...viewState.get(key), search: input.value });
  applySearch(slot, input.value);
});

root.addEventListener('click', (event) => {
  const target = event.target as Element;
  const slot = target.closest<HTMLElement>('.db-slot');
  if (!slot) return;
  const key = slotKey(slot);

  const sort = target.closest<HTMLElement>('.db-sort');
  if (sort) {
    // Sorting is a reading aid: the document doesn't change.
    const prop = sort.closest<HTMLElement>('th')?.dataset['prop'] ?? '';
    const current = viewState.get(key)?.sort;
    const desc = current?.prop === prop ? !current.desc : false;
    viewState.set(key, { ...viewState.get(key), sort: { prop, desc } });
    applySort(slot, prop, desc);
    return;
  }
  const body = target.closest<HTMLElement>('.db-view-body');
  if (!body?.hasAttribute('data-interactive')) {
    if (target.closest('.db-month')) postDb(slot, { op: 'month', delta: Number(target.closest<HTMLElement>('.db-month')?.dataset['delta']) });
    return;
  }
  if (target.closest('.db-month')) {
    postDb(slot, { op: 'month', delta: Number(target.closest<HTMLElement>('.db-month')?.dataset['delta']) });
  } else if (target.closest('.db-new')) {
    const raw = target.closest<HTMLElement>('.db-new')?.dataset['groupValue'];
    postDb(slot, { op: 'add', groupValue: raw ? JSON.parse(raw) : undefined });
  } else if (target.closest('.db-delete')) {
    postDb(slot, { op: 'delete', rowId: target.closest<HTMLElement>('[data-row-id]')?.dataset['rowId'] });
  } else if (target.closest('.db-save-view')) {
    const s = viewState.get(key)?.sort;
    postDb(slot, { op: 'saveView', sort: s ? [`${s.desc ? '-' : ''}${s.prop}`] : undefined });
  } else {
    const cell = target.closest<HTMLElement>('td.db-cell.editable');
    if (cell && !cell.querySelector('.db-editor')) editCell(cell);
  }
});

root.addEventListener('keydown', (event) => {
  const cell = (event.target as Element).closest<HTMLElement>('td.db-cell.editable');
  if (cell && event.target === cell && (event.key === 'Enter' || event.key === 'F2')) {
    event.preventDefault();
    editCell(cell);
  }
});

/** Opens an editor that matches the cell's property type. */
function editCell(cell: HTMLElement) {
  const body = cell.closest<HTMLElement>('.db-view-body');
  const rowId = cell.closest<HTMLElement>('[data-row-id]')?.dataset['rowId'];
  const prop = cell.dataset['prop'] ?? '';
  const type = cell.dataset['type'] ?? 'text';
  let schema: ColumnMeta[] = [];
  try {
    schema = JSON.parse(body?.dataset['schema'] ?? '[]') as ColumnMeta[];
  } catch {
    // No schema: plain text editing.
  }
  const meta = schema.find((c) => c.name === prop);
  const value = cellValue(cell);
  const commit = (v: unknown) => postDb(cell, { op: 'set', rowId, prop, value: v });
  if (type === 'checkbox') {
    commit(!(value === true || value === 1));
    return;
  }
  const original = cell.innerHTML;
  let editor: HTMLInputElement | HTMLSelectElement;
  if ((type === 'select' || type === 'status') && meta?.options) {
    const select = document.createElement('select');
    for (const o of ['', ...meta.options]) {
      const opt = document.createElement('option');
      opt.value = o;
      opt.textContent = o || '—';
      opt.selected = o === value;
      select.append(opt);
    }
    editor = select;
  } else {
    const input = document.createElement('input');
    input.type = type === 'number' ? 'number' : type === 'date' ? 'date' : type === 'url' ? 'url' : type === 'email' ? 'email' : 'text';
    input.value = Array.isArray(value) ? value.join(', ') : value === null || value === undefined ? '' : String(value).slice(0, type === 'date' ? 10 : undefined);
    if (type === 'multi_select') input.placeholder = meta?.options?.join(', ') ?? 'a, b';
    editor = input;
  }
  editor.className = 'db-editor';
  editor.setAttribute('aria-label', prop);
  let done = false;
  const finish = (save: boolean) => {
    if (done) return;
    done = true;
    if (save) {
      const v = type === 'multi_select' ? editor.value.split(',').map((x) => x.trim()).filter(Boolean) : editor.value;
      if (JSON.stringify(v) !== JSON.stringify(value)) {
        commit(v);
        return;
      }
    }
    cell.innerHTML = original;
    cell.focus();
  };
  editor.addEventListener('keydown', (e) => {
    const k = (e as KeyboardEvent).key;
    e.stopPropagation();
    if (k === 'Enter') finish(true);
    else if (k === 'Escape') finish(false);
  });
  editor.addEventListener('blur', () => finish(true));
  if (editor instanceof HTMLSelectElement) editor.addEventListener('change', () => finish(true));
  cell.replaceChildren(editor);
  editor.focus();
}

