/**
 * HTML for database views and query results. Every value is escaped here; the webview never
 * builds HTML from data.
 */
import { escapeHtml, sanitizeUrl } from '../render';
import { READ_ONLY_TYPES, titleProperty } from './ydb';
import type { Property, SavedView, Schema } from './ydb';
import type { QueryResult } from './engine';

export const VIEW_TYPES = ['table', 'list', 'gallery', 'calendar', 'board'] as const;
/** Property types a board can group by. */
export const BOARD_GROUP_TYPES = new Set(['select', 'status', 'person', 'checkbox']);

export interface ViewRow {
  /** Stable row id: the `.ydb` id, or the SQLite rowid. */
  id: string;
  values: Record<string, unknown>;
}

export interface RelationTarget {
  title: string;
  href: string;
}

export interface ViewData {
  key: string;
  ref: string;
  schema: Schema;
  rows: ViewRow[];
  total: number;
  settings: SavedView & { type: string };
  /** Titles of related rows per relation property. */
  relations?: Record<string, Record<string, RelationTarget>>;
  /** Show editing controls. */
  interactive: boolean;
  today: string;
  /** `YYYY-MM` shown by calendar views. */
  month?: string;
  resolveImage?: (src: string) => string;
}

const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

export function formatDate(value: string): string {
  const m = /^(\d{4})-(\d{2})-(\d{2})(?:[T ](\d{2}):(\d{2}))?/.exec(value);
  if (!m) return value;
  const date = `${MONTHS[Number(m[2]) - 1] ?? m[2]} ${Number(m[3])}, ${m[1]}`;
  return m[4] ? `${date} ${m[4]}:${m[5]}` : date;
}

function chip(p: Property, value: string): string {
  const i = p.options?.indexOf(value) ?? -1;
  const color = i === -1 ? 'none' : String(i % 8);
  return `<span class="db-chip" data-color="${color}">${escapeHtml(value)}</span>`;
}

/** One value displayed by its property type. */
export function displayValue(p: Property | undefined, v: unknown, data?: Pick<ViewData, 'relations' | 'today'>): string {
  if (v === undefined || v === null || v === '') return '';
  if (!p) return escapeHtml(typeof v === 'object' ? JSON.stringify(v) : String(v));
  switch (p.type) {
    case 'checkbox':
      return `<input type="checkbox" disabled${v === true || v === 1 ? ' checked' : ''} aria-label="${escapeHtml(p.name)}">`;
    case 'select':
    case 'status':
      return chip(p, String(v));
    case 'multi_select':
      return (Array.isArray(v) ? v : [v]).map((x) => chip(p, String(x))).join(' ');
    case 'date':
    case 'created_time':
    case 'updated_time':
      return `<time datetime="${escapeHtml(String(v))}">${escapeHtml(formatDate(String(v)))}</time>`;
    case 'url': {
      const href = sanitizeUrl(String(v));
      return href ? `<a href="${escapeHtml(href)}">${escapeHtml(String(v).replace(/^https?:\/\//, ''))}</a>` : escapeHtml(String(v));
    }
    case 'email': {
      const href = sanitizeUrl(`mailto:${String(v)}`);
      return href ? `<a href="${escapeHtml(href)}">${escapeHtml(String(v))}</a>` : escapeHtml(String(v));
    }
    case 'relation': {
      const targets = data?.relations?.[p.name] ?? {};
      return (Array.isArray(v) ? v : [v])
        .map((id) => {
          const t = targets[String(id)];
          return t ? `<a class="db-relation" href="${escapeHtml(t.href)}">${escapeHtml(t.title)}</a>` : `<span class="db-relation missing">${escapeHtml(String(id))}</span>`;
        })
        .join(', ');
    }
    case 'formula':
      if (v === 1 || v === 0) return v === 1 ? '✓' : '';
      return escapeHtml(String(v));
    case 'number':
      return escapeHtml(typeof v === 'number' ? v.toLocaleString('en-US') : String(v));
    default:
      return escapeHtml(typeof v === 'object' ? JSON.stringify(v) : String(v));
  }
}

function propertyMap(schema: Schema): Map<string, Property> {
  return new Map(schema.properties.map((p) => [p.name, p]));
}

function columnsFor(data: ViewData): Property[] {
  const byName = propertyMap(data.schema);
  const names = data.settings.columns?.length ? data.settings.columns : data.schema.properties.map((p) => p.name).filter((n) => n.toLowerCase() !== 'id');
  return names.map((n) => byName.get(n)).filter((p): p is Property => p !== undefined);
}

function cellAttrs(p: Property, interactive: boolean): string {
  const editable = interactive && !READ_ONLY_TYPES.has(p.type);
  return ` data-prop="${escapeHtml(p.name)}" data-type="${p.type}"${editable ? ' class="db-cell editable" tabindex="0"' : ' class="db-cell"'}`;
}

/** Column metadata the webview needs to build editors: types and options. */
function schemaAttr(schema: Schema): string {
  const meta = schema.properties.map((p) => ({ name: p.name, type: p.type, options: p.options }));
  return escapeHtml(JSON.stringify(meta));
}

function toolbar(data: ViewData, shown: number): string {
  const count = data.total > shown ? `${shown} of ${data.total}` : `${data.total} row${data.total === 1 ? '' : 's'}`;
  const controls = data.interactive
    ? `<input type="search" class="db-search" placeholder="Search" aria-label="Search rows"><button type="button" class="db-new">New</button><button type="button" class="db-save-view" title="Save the current sort as a view in the database">Save view</button>`
    : `<input type="search" class="db-search" placeholder="Search" aria-label="Search rows">`;
  return `<div class="db-toolbar"><span class="db-name">${escapeHtml(data.schema.name ?? data.ref)}</span><span class="db-count">${count}</span>${controls}</div>`;
}

function groupRows(data: ViewData, by: Property): { label: string; value: unknown; rows: ViewRow[] }[] {
  const groups = new Map<string, { label: string; value: unknown; rows: ViewRow[] }>();
  const keyOf = (v: unknown) => (v === undefined || v === null || v === '' ? '' : by.type === 'checkbox' ? String(v === true || v === 1) : String(v));
  for (const o of by.options ?? []) groups.set(o, { label: o, value: o, rows: [] });
  if (by.type === 'checkbox') {
    groups.set('false', { label: `Not ${by.name}`, value: false, rows: [] });
    groups.set('true', { label: by.name, value: true, rows: [] });
  }
  for (const row of data.rows) {
    const values = by.type === 'multi_select' && Array.isArray(row.values[by.name]) ? (row.values[by.name] as unknown[]) : [row.values[by.name]];
    for (const v of values.length ? values : [undefined]) {
      const k = keyOf(v);
      if (!groups.has(k)) groups.set(k, { label: k || 'No value', value: k ? v : null, rows: [] });
      groups.get(k)?.rows.push(row);
    }
  }
  // "No value" goes last.
  const empty = groups.get('');
  groups.delete('');
  const out = [...groups.values()];
  if (empty) out.push(empty);
  return out;
}

function tableRows(data: ViewData, rows: ViewRow[], cols: Property[]): string {
  return rows
    .map(
      (r) =>
        `<tr data-row-id="${escapeHtml(r.id)}">${cols
          .map((p) => `<td${cellAttrs(p, data.interactive)} data-value="${escapeHtml(JSON.stringify(r.values[p.name] ?? null))}">${displayValue(p, r.values[p.name], data)}</td>`)
          .join('')}${data.interactive ? `<td class="db-row-actions"><button type="button" class="db-delete" aria-label="Delete row" title="Delete row">×</button></td>` : ''}</tr>`,
    )
    .join('\n');
}

function table(data: ViewData): string {
  const cols = columnsFor(data);
  const head = `<thead><tr>${cols.map((p) => `<th data-prop="${escapeHtml(p.name)}" data-type="${p.type}" aria-sort="none"><button type="button" class="db-sort">${escapeHtml(p.name)}</button></th>`).join('')}${data.interactive ? '<th class="db-row-actions"></th>' : ''}</tr></thead>`;
  const group = data.settings.group ? propertyMap(data.schema).get(data.settings.group) : undefined;
  if (!group) return `<table class="db-table">${head}<tbody>\n${tableRows(data, data.rows, cols)}\n</tbody></table>`;
  return groupRows(data, group)
    .map(
      (g) =>
        `<details class="db-group" open data-group-value="${escapeHtml(JSON.stringify(g.value))}"><summary>${g.value === null ? 'No value' : displayValue(group, g.value, data) || escapeHtml(g.label)} <span class="db-group-count">${g.rows.length}</span></summary><table class="db-table">${head}<tbody>\n${tableRows(data, g.rows, cols)}\n</tbody></table></details>`,
    )
    .join('\n');
}

function titleOf(data: ViewData, r: ViewRow): string {
  const t = titleProperty(data.schema);
  const v = t ? r.values[t.name] : undefined;
  return v === undefined || v === null || v === '' ? 'Untitled' : String(v);
}

function propsLine(data: ViewData, r: ViewRow, cols: Property[]): string {
  return cols
    .filter((p) => p.type !== 'title')
    .map((p) => {
      const shown = displayValue(p, r.values[p.name], data);
      return shown ? `<span class="db-prop" data-prop="${escapeHtml(p.name)}" title="${escapeHtml(p.name)}">${shown}</span>` : '';
    })
    .filter(Boolean)
    .join('');
}

function list(data: ViewData): string {
  const cols = columnsFor(data);
  return `<ul class="db-list">${data.rows.map((r) => `<li data-row-id="${escapeHtml(r.id)}"><span class="db-title">${escapeHtml(titleOf(data, r))}</span>${propsLine(data, r, cols)}</li>`).join('\n')}</ul>`;
}

function gallery(data: ViewData): string {
  const cols = columnsFor(data);
  const cover = data.settings.cover;
  return `<div class="db-gallery">${data.rows
    .map((r) => {
      const src = cover ? r.values[cover] : undefined;
      const safe = typeof src === 'string' ? sanitizeUrl(src, true) : null;
      const img = safe ? `<img class="db-cover" src="${escapeHtml(data.resolveImage ? data.resolveImage(safe) : safe)}" alt="">` : '<div class="db-cover empty"></div>';
      return `<article class="db-card" data-row-id="${escapeHtml(r.id)}">${img}<div class="db-card-body"><div class="db-title">${escapeHtml(titleOf(data, r))}</div>${propsLine(data, r, cols.filter((p) => p.name !== cover))}</div></article>`;
    })
    .join('\n')}</div>`;
}

function calendar(data: ViewData): string {
  const dateProp = data.settings.date ?? data.schema.properties.find((p) => p.type === 'date')?.name;
  if (!dateProp) return viewError('This calendar needs a date property: add date=<property>.', 'Y851');
  const month = data.month ?? data.today.slice(0, 7);
  const [y, m] = month.split('-').map(Number) as [number, number];
  const first = new Date(Date.UTC(y, m - 1, 1));
  const days = new Date(Date.UTC(y, m, 0)).getUTCDate();
  const offset = (first.getUTCDay() + 6) % 7; // Weeks start on Monday.
  const byDay = new Map<number, ViewRow[]>();
  for (const r of data.rows) {
    const v = r.values[dateProp];
    if (typeof v !== 'string' || !v.startsWith(month)) continue;
    const d = Number(v.slice(8, 10));
    byDay.set(d, [...(byDay.get(d) ?? []), r]);
  }
  const cells: string[] = [];
  for (let i = 0; i < offset; i++) cells.push('<div class="db-day empty"></div>');
  for (let d = 1; d <= days; d++) {
    const iso = `${month}-${String(d).padStart(2, '0')}`;
    const items = (byDay.get(d) ?? []).map((r) => `<div class="db-event" data-row-id="${escapeHtml(r.id)}">${escapeHtml(titleOf(data, r))}</div>`).join('');
    cells.push(`<div class="db-day${iso === data.today ? ' today' : ''}" data-date="${iso}"><span class="db-day-number">${d}</span>${items}</div>`);
  }
  const weekdays = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'].map((w) => `<div class="db-weekday">${w}</div>`).join('');
  const title = `${['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'][m - 1]} ${y}`;
  return `<div class="db-calendar" data-month="${month}"><div class="db-calendar-header"><button type="button" class="db-month" data-delta="-1" aria-label="Previous month">‹</button><span class="db-month-title">${title}</span><button type="button" class="db-month" data-delta="1" aria-label="Next month">›</button></div><div class="db-calendar-grid">${weekdays}${cells.join('')}</div></div>`;
}

function board(data: ViewData): string {
  const group = data.settings.group ? propertyMap(data.schema).get(data.settings.group) : undefined;
  if (!group) return viewError('A board needs group=<property>, a select, status, person or checkbox property.', 'Y855');
  if (!BOARD_GROUP_TYPES.has(group.type)) {
    return viewError(`A board can't group by "${group.name}" (${group.type}). Use a select, status, person or checkbox property.`, 'Y855');
  }
  const cols = columnsFor(data).filter((p) => p.name !== group.name);
  const reorder = data.interactive && !data.settings.sort?.length;
  const columns = groupRows(data, group).map((g, ci) => {
    const cards = g.rows
      .map(
        (r, i) =>
          `<article class="kanban-card db-board-card" tabindex="0"${data.interactive ? ' draggable="true"' : ''} data-row-id="${escapeHtml(r.id)}" data-index="${i}"><div class="kanban-card-title"><span class="kanban-card-text">${escapeHtml(titleOf(data, r))}</span></div><div class="kanban-card-meta">${propsLine(data, r, cols)}</div></article>`,
      )
      .join('\n');
    const label = g.value === null ? 'No value' : g.label;
    return `<section class="kanban-column" data-column="${ci}" data-group-value="${escapeHtml(JSON.stringify(g.value))}" aria-label="${escapeHtml(label)}"><header class="kanban-column-header"><button type="button" class="kanban-collapse" aria-expanded="true" aria-label="Collapse ${escapeHtml(label)}">▾</button><span class="kanban-column-title">${escapeHtml(label)}</span><span class="kanban-count">${g.rows.length}</span></header><div class="kanban-cards" data-column="${ci}">${cards}</div>${data.interactive ? `<button type="button" class="db-new db-board-new" data-group-value="${escapeHtml(JSON.stringify(g.value))}">+ New</button>` : ''}</section>`;
  });
  return `<div class="kanban db-board" data-board="${escapeHtml(data.key)}" data-group="${escapeHtml(group.name)}"${data.interactive ? ' data-interactive' : ''}${reorder ? ' data-reorder' : ''}><div class="kanban-columns">${columns.join('\n')}</div></div>`;
}

export function viewError(message: string, code: string): string {
  return `<div class="db-error" role="alert"><span class="db-error-code">${escapeHtml(code)}</span> ${escapeHtml(message)}</div>`;
}

/** The HTML for a `::db` view. */
export function renderView(data: ViewData): string {
  const type = data.settings.type;
  const body =
    type === 'list' ? list(data) : type === 'gallery' ? gallery(data) : type === 'calendar' ? calendar(data) : type === 'board' ? board(data) : table(data);
  const shown = data.rows.length;
  return `<div class="db-view-body" data-db-type="${escapeHtml(type)}" data-schema="${schemaAttr(data.schema)}"${data.interactive ? ' data-interactive' : ''}>${toolbar(data, shown)}${body}</div>`;
}

/** The HTML for a query result: a table, a list of the first column, or the first cell. */
export function renderResult(result: QueryResult, view: string): string {
  const more = result.total > result.rows.length ? `<div class="db-more">Showing ${result.rows.length} of ${result.total} rows.</div>` : '';
  const cell = (v: unknown) => {
    if (v === null || v === undefined) return '';
    const s = String(v);
    const url = /^https?:\/\//i.test(s) ? sanitizeUrl(s) : null;
    if (url) return `<a href="${escapeHtml(url)}">${escapeHtml(s)}</a>`;
    if (/^\d{4}-\d{2}-\d{2}$/.test(s)) return `<time datetime="${s}">${escapeHtml(formatDate(s))}</time>`;
    return escapeHtml(s);
  };
  if (view === 'value') return result.rows[0] ? cell(result.rows[0][0]) : '<span class="db-empty">no result</span>';
  if (!result.rows.length) return '<div class="db-empty">No results.</div>';
  if (view === 'list') return `<ul class="db-result-list">${result.rows.map((r) => `<li>${cell(r[0])}</li>`).join('')}</ul>${more}`;
  return `<table class="db-table db-result"><thead><tr>${result.columns.map((c) => `<th>${escapeHtml(c)}</th>`).join('')}</tr></thead><tbody>${result.rows
    .map((r) => `<tr>${r.map((v) => `<td>${cell(v)}</td>`).join('')}</tr>`)
    .join('')}</tbody></table>${more}`;
}

/** Merges a saved view with the directive's attributes (attributes win). */
export function viewSettings(schema: Schema, attrs: Record<string, string | number | boolean> | undefined): SavedView & { type: string } {
  const str = (k: string) => (typeof attrs?.[k] === 'string' ? (attrs[k] as string) : undefined);
  const list = (k: string) => str(k)?.split(',').map((s) => s.trim()).filter(Boolean);
  const saved = str('view') ? schema.views[str('view') as string] ?? {} : {};
  const limit = typeof attrs?.['limit'] === 'number' ? (attrs['limit'] as number) : Number(str('limit')) || undefined;
  return {
    ...saved,
    type: str('type') ?? saved.type ?? 'table',
    ...(str('filter') !== undefined ? { filter: str('filter') } : {}),
    ...(list('sort') ? { sort: list('sort') } : {}),
    ...(str('group') !== undefined ? { group: str('group') } : {}),
    ...(list('columns') ? { columns: list('columns') } : {}),
    ...(limit !== undefined ? { limit } : {}),
    ...(str('date') !== undefined ? { date: str('date') } : {}),
    ...(str('cover') !== undefined ? { cover: str('cover') } : {}),
  };
}
