// Runs inside the preview webview.
import { root, state, vscode } from './shared';

// ---- Database views and queries ----

export interface ColumnMeta {
  name: string;
  type: string;
  options?: string[];
}

/** Sort and search per placeholder, kept across re-renders of its data. */
export const viewState = new Map<string, { sort?: { prop: string; desc: boolean }; search?: string }>();

export const slotKey = (el: Element) => el.closest<HTMLElement>('.db-slot')?.dataset['dbKey'] ?? '';

export function postDb(el: Element, message: Record<string, unknown>) {
  vscode.postMessage({ type: 'db', key: slotKey(el), ...message });
}

/** The last HTML received for each database view or query. */
export const fills = new Map<string, string>();

export function applyFill(key: string, html: string) {
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

export function fill(items: { key: string; html: string }[]) {
  // The host sends every view of the note, so views that no longer exist can be forgotten.
  fills.clear();
  for (const { key, html } of items) {
    fills.set(key, html);
    applyFill(key, html);
  }
}

export function cellValue(cell: Element | null): unknown {
  try {
    return JSON.parse((cell as HTMLElement | null)?.dataset['value'] ?? 'null');
  } catch {
    return null;
  }
}

export function applySort(slot: HTMLElement, prop: string, desc: boolean) {
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

export function applySearch(slot: HTMLElement, query: string) {
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
export function editCell(cell: HTMLElement) {
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


