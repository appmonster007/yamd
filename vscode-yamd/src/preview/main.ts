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
  scheduleDrawArrows();
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

// ---- Arrow annotations: a connector from each [data-yamd-arrow-to] span to its target id ----

const arrowsSvg = document.getElementById('yamd-arrows');
let arrowFrame: number | undefined;

interface ArrowGeometry {
  curve: boolean;
  side: 'left' | 'right';
  x1: number;
  y1: number;
  x2: number;
  y2: number;
}

/**
 * The tight union of the client rects of `el`'s actual rendered text (via `Range`), not its
 * container box. A block element (a plain `{#id}`-labeled paragraph, say) is as wide as the whole
 * content column regardless of how short its text is — `getBoundingClientRect()` on the element
 * itself would center an arrow in empty space past the end of a short line, not on the text. Falls
 * back to the element's own rect if it has no text (e.g. it's empty, or layout hasn't happened).
 */
function contentRect(el: HTMLElement): DOMRect {
  const range = document.createRange();
  range.selectNodeContents(el);
  let top = Infinity;
  let left = Infinity;
  let right = -Infinity;
  let bottom = -Infinity;
  for (const r of range.getClientRects()) {
    if (r.width === 0 && r.height === 0) continue;
    top = Math.min(top, r.top);
    left = Math.min(left, r.left);
    right = Math.max(right, r.right);
    bottom = Math.max(bottom, r.bottom);
  }
  if (!isFinite(top)) return el.getBoundingClientRect();
  return new DOMRect(left, top, right - left, bottom - top);
}

/**
 * The nearest of `el` and its ancestors (stopping at `#root`) that is itself a labeled "box" —
 * a callout or a study block (definition, theorem, ...) — alongside whether that search actually
 * found one. An arrow's `source` is always some inline span (that's the only place the `arrow=`
 * attribute can go), so when a span sits inside a box, routing should connect to the *box*'s
 * edge, not the one word the attribute happens to be written on.
 *
 * Returns two rects: `box` (the full element — used as the edge a real box's arrow steps out
 * from) and `content` (the tight text extent — used to decide exactly where an arrow anchors when
 * the element isn't a real box, so it points at the actual word or sentence, not empty container
 * width).
 */
function arrowBoxRect(el: HTMLElement): { box: DOMRect; content: DOMRect; isBox: boolean } {
  let node: HTMLElement | null = el;
  while (node && node !== root) {
    if (node.classList.contains('callout') || node.classList.contains('study')) {
      const box = node.getBoundingClientRect();
      return { box, content: box, isBox: true };
    }
    node = node.parentElement;
  }
  const box = el.getBoundingClientRect();
  return { box, content: contentRect(el), isBox: false };
}

/**
 * `wire` (the default) anchors a connector at the left or right edge of its source and target —
 * never the top or bottom, so it doesn't cross over the text in between — then routes it as a
 * right-angled elbow out to a margin line clear of both edges, straight along that line, then in
 * to the target. `arrow-style=curve` instead anchors at each element's own center (not its box)
 * and bows a single smooth curve directly between them, crossing over whatever text is in
 * between — the simpler, more paper-like look some annotations want in exchange for possibly
 * covering text.
 */
function arrowGeometry(source: HTMLElement, target: HTMLElement, curveRequested: boolean): ArrowGeometry {
  const { box: fromBox, content: fromContent, isBox: fromIsBox } = arrowBoxRect(source);
  const { box: toBox, content: toContent, isBox: toIsBox } = arrowBoxRect(target);
  // For a real box (callout/study), anchor on the box itself — padding and all, since the whole
  // box is the thing being pointed at. Otherwise anchor on the actual rendered text, not the
  // element's full container width, so the arrow lands on the word or sentence someone labeled,
  // never on empty space past the end of a short line in a wide paragraph.
  const fromAnchor = fromIsBox ? fromBox : fromContent;
  const toAnchor = toIsBox ? toBox : toContent;
  if (curveRequested) {
    return {
      curve: true,
      side: 'right',
      x1: fromAnchor.left + fromAnchor.width / 2,
      y1: fromAnchor.top + fromAnchor.height / 2,
      x2: toAnchor.left + toAnchor.width / 2,
      y2: toAnchor.top + toAnchor.height / 2,
    };
  }
  const center = (fromAnchor.left + fromAnchor.right + toAnchor.left + toAnchor.right) / 4;
  const side: 'left' | 'right' = center <= window.innerWidth / 2 ? 'left' : 'right';
  const gap = side === 'right' ? 10 : -10;
  return {
    curve: false,
    side,
    x1: (side === 'right' ? fromAnchor.right : fromAnchor.left) + gap,
    y1: fromAnchor.top + fromAnchor.height / 2,
    x2: (side === 'right' ? toAnchor.right : toAnchor.left) + gap,
    y2: toAnchor.top + toAnchor.height / 2,
  };
}

/**
 * Packs each wire arrow into the first lane whose last-placed arrow's span doesn't overlap this
 * one's — so only arrows that could actually run alongside each other get separated into
 * different lanes, and unrelated arrows elsewhere on the page all stay in lane 0 instead of
 * drifting further out for no visual reason. Arrows are grouped and packed by side and vertical
 * span.
 */
function assignLanes(geometries: ArrowGeometry[]): Map<ArrowGeometry, number> {
  const lanes = new Map<ArrowGeometry, number>();

  const sideEnds: Record<'left' | 'right', number[]> = { left: [], right: [] };
  const bySideTop = geometries
    .filter((g) => !g.curve)
    .sort((a, b) => Math.min(a.y1, a.y2) - Math.min(b.y1, b.y2));
  for (const g of bySideTop) {
    const top = Math.min(g.y1, g.y2) - 12;
    const bottom = Math.max(g.y1, g.y2) + 12;
    const ends = sideEnds[g.side];
    let lane = ends.findIndex((end) => end < top);
    if (lane === -1) lane = ends.length;
    ends[lane] = bottom;
    lanes.set(g, lane);
  }

  return lanes;
}

function drawArrows() {
  if (!arrowsSvg) return;
  for (const path of Array.from(arrowsSvg.querySelectorAll('.yamd-arrow-path'))) path.remove();
  // An arrow is declared by an `arrow=` attribute on an inline span, pointing out at some other id.
  const spanPairs = Array.from(root.querySelectorAll<HTMLElement>('[data-yamd-arrow-to]')).map((source) => ({
    source,
    target: document.getElementById(source.dataset['yamdArrowTo'] ?? ''),
    curve: source.dataset['yamdArrowStyle'] === 'curve',
  }));
  // A hidden source or target (e.g. inside a collapsed `<details>`, or a not-yet-rendered database
  // view) has a zero-size rect at (0,0); without this check that would draw a stray connector into
  // the page's top-left corner instead of just not drawing it.
  const visible = (el: HTMLElement) => {
    const r = el.getBoundingClientRect();
    return r.width > 0 && r.height > 0;
  };
  const pairs = spanPairs.filter(
    (p): p is { source: HTMLElement; target: HTMLElement; curve: boolean } =>
      p.source !== null && p.target !== null && visible(p.source) && visible(p.target),
  );
  const geometries = pairs.map((p) => arrowGeometry(p.source, p.target, p.curve));
  const lanes = assignLanes(geometries);
  // A golden-angle hue step keeps consecutive arrows visually far apart in color no matter how
  // many there are, instead of cycling through a short fixed palette and repeating.
  geometries.forEach((g, i) => {
    const lane = lanes.get(g) ?? 0;
    let d: string;
    if (g.curve) {
      d = `M${g.x1},${g.y1} Q${(g.x1 + g.x2) / 2},${(g.y1 + g.y2) / 2 - 24} ${g.x2},${g.y2}`;
    } else {
      const wanted =
        (g.side === 'right' ? Math.max(g.x1, g.x2) : Math.min(g.x1, g.x2)) +
        (g.side === 'right' ? 1 : -1) * (24 + lane * 16);
      // The svg is clipped to the viewport, so a margin past its edge would render as an
      // invisible stub; keep it just inside instead. The clamp ceiling itself steps in by
      // lane too — in a narrow split-view pane, every lane's `wanted` can overshoot the edge,
      // and clamping them all to the same fixed edge would collapse distinct lanes onto one
      // visible x, overlapping again. Stepping the ceiling keeps clamped lanes distinct too.
      const margin =
        g.side === 'right' ? Math.min(wanted, window.innerWidth - 4 - lane * 10) : Math.max(wanted, 4 + lane * 10);
      d = `M${g.x1},${g.y1} L${margin},${g.y1} L${margin},${g.y2} L${g.x2},${g.y2}`;
    }
    const path = document.createElementNS('http://www.w3.org/2000/svg', 'path');
    path.setAttribute('class', 'yamd-arrow-path');
    path.style.setProperty('--yamd-arrow-hue', String((i * 137.508) % 360));
    path.setAttribute('d', d);
    path.setAttribute('marker-end', 'url(#yamd-arrowhead)');
    arrowsSvg.append(path);
  });
}

function scheduleDrawArrows() {
  if (arrowFrame !== undefined) return;
  arrowFrame = requestAnimationFrame(() => {
    arrowFrame = undefined;
    drawArrows();
  });
}

new ResizeObserver(scheduleDrawArrows).observe(root);
window.addEventListener('scroll', scheduleDrawArrows, { passive: true });
window.addEventListener('resize', scheduleDrawArrows);
