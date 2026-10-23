/**
 * HTML for database views and query results. Every value is escaped here; the webview never
 * builds HTML from data.
 */
import { escapeHtml, isoWeek, sanitizeUrl } from '../render';
import { READ_ONLY_TYPES, titleProperty } from './ydb';
import type { Property, SavedView, Schema } from './ydb';
import type { QueryResult } from './engine';

export const VIEW_TYPES = ['table', 'list', 'gallery', 'calendar', 'board', 'timeline', 'chart'] as const;
/** Property types a board (or a timeline's `group`) can group by. */
export const BOARD_GROUP_TYPES = new Set(['select', 'status', 'person', 'checkbox']);
/** Property types usable as a gallery's `cover`. */
const COVER_TYPES = new Set(['url', 'text']);
const AGGREGATES = new Set(['count', 'sum', 'avg', 'min', 'max']);
const CHART_SHAPES = new Set(['bar', 'line', 'pie']);

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
  const coverProp = data.settings.cover ? propertyMap(data.schema).get(data.settings.cover) : undefined;
  if (data.settings.cover && (!coverProp || !COVER_TYPES.has(coverProp.type))) {
    return viewError(`A gallery can't use "${data.settings.cover}" as a cover. Use a url property or an embedded image reference.`, 'Y855');
  }
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
  if (data.settings.date && propertyMap(data.schema).get(data.settings.date)?.type !== 'date') {
    return viewError(`A calendar can't place rows by "${data.settings.date}". Use a date property.`, 'Y855');
  }
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
  const cols = columnsFor(data).filter((p) => p.name !== dateProp);
  const eventHtml = (r: ViewRow): string => {
    const detailLine = propsLine(data, r, cols);
    const detail = detailLine ? `<div class="db-event-detail">${detailLine}</div>` : '';
    return `<div class="db-event" tabindex="0" data-row-id="${escapeHtml(r.id)}"><div class="db-event-summary">${escapeHtml(titleOf(data, r))}</div>${detail}</div>`;
  };
  interface Cell {
    html: string;
    iso?: string;
  }
  const cells: Cell[] = [];
  for (let i = 0; i < offset; i++) cells.push({ html: '<div class="db-day empty"></div>' });
  for (let d = 1; d <= days; d++) {
    const iso = `${month}-${String(d).padStart(2, '0')}`;
    const items = (byDay.get(d) ?? []).map(eventHtml).join('');
    cells.push({ html: `<div class="db-day${iso === data.today ? ' today' : ''}" data-date="${iso}"><button type="button" class="db-day-number">${d}</button>${items}</div>`, iso });
  }
  while (cells.length % 7 !== 0) cells.push({ html: '<div class="db-day empty"></div>' });
  const weeks: string[] = [];
  for (let i = 0; i < cells.length; i += 7) {
    const week = cells.slice(i, i + 7);
    const firstIso = week.find((c) => c.iso)?.iso;
    const label = firstIso
      ? `<button type="button" class="db-week-number" data-week="${isoWeek(firstIso)}">Wk ${isoWeek(firstIso)}</button>`
      : '<span class="db-week-number empty"></span>';
    weeks.push(`<div class="db-week">${label}${week.map((c) => c.html).join('')}</div>`);
  }
  const weekdays = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'].map((w) => `<div class="db-weekday">${w}</div>`).join('');
  const title = `${['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'][m - 1]} ${y}`;
  const agenda = `<div class="db-agenda" hidden><div class="db-agenda-header"><span class="db-agenda-title"></span><button type="button" class="db-agenda-close" aria-label="Close list">Close</button></div><div class="db-agenda-list"></div></div>`;
  return `<div class="db-calendar" data-month="${month}"><div class="db-calendar-header"><button type="button" class="db-month" data-delta="-1" aria-label="Previous month">‹</button><span class="db-month-title">${title}</span><button type="button" class="db-month" data-delta="1" aria-label="Next month">›</button></div><div class="db-calendar-weekdays"><span class="db-week-number"></span>${weekdays}</div>${weeks.join('')}${agenda}</div>`;
}

interface TimelineItem {
  row: ViewRow;
  start: string;
  end: string;
}

function timeline(data: ViewData): string {
  if (!data.settings.date) return viewError('A timeline needs a start date property: add date=<property>.', 'Y851');
  const startProp = propertyMap(data.schema).get(data.settings.date);
  if (!startProp || startProp.type !== 'date') {
    return viewError(`A timeline can't start rows by "${data.settings.date}". Use a date property.`, 'Y855');
  }
  const endProp = data.settings.dateEnd ? propertyMap(data.schema).get(data.settings.dateEnd) : undefined;
  if (data.settings.dateEnd && (!endProp || endProp.type !== 'date')) {
    return viewError(`A timeline can't end rows by "${data.settings.dateEnd}". Use a date property.`, 'Y855');
  }
  const group = data.settings.group ? propertyMap(data.schema).get(data.settings.group) : undefined;
  if (data.settings.group && (!group || !BOARD_GROUP_TYPES.has(group.type))) {
    return viewError(`A timeline can't group by "${data.settings.group}" (${group?.type ?? 'unknown'}). Use a select, status, person or checkbox property.`, 'Y855');
  }
  const items: TimelineItem[] = [];
  for (const r of data.rows) {
    const s = r.values[startProp.name];
    if (typeof s !== 'string' || !s) continue;
    const e = endProp ? r.values[endProp.name] : undefined;
    items.push({ row: r, start: s, end: typeof e === 'string' && e ? e : s });
  }
  if (!items.length) return '<div class="db-timeline db-empty">No dated rows.</div>';
  const time = (d: string) => new Date(d).getTime();
  const min = Math.min(...items.map((i) => time(i.start)));
  const max = Math.max(...items.map((i) => time(i.end)));
  const span = Math.max(max - min, 86400000);
  const pct = (t: number) => ((t - min) / span) * 100;
  const bar = (i: TimelineItem) => {
    const left = pct(time(i.start));
    const width = Math.max(pct(time(i.end)) - left, 1.5);
    const title = titleOf(data, i.row);
    return `<div class="db-timeline-bar" data-row-id="${escapeHtml(i.row.id)}" style="left:${left}%;width:${width}%" title="${escapeHtml(title)}">${escapeHtml(title)}</div>`;
  };
  if (!group) {
    return `<div class="db-timeline"><div class="db-timeline-row"><div class="db-timeline-track">${items.map(bar).join('')}</div></div></div>`;
  }
  const byRowId = new Map(items.map((i) => [i.row.id, i]));
  const lanes = groupRows({ ...data, rows: items.map((i) => i.row) }, group);
  return `<div class="db-timeline">${lanes
    .map((g) => {
      const bars = g.rows.map((r) => byRowId.get(r.id)).filter((i): i is TimelineItem => i !== undefined).map(bar).join('');
      const label = g.value === null ? 'No value' : g.label;
      return `<div class="db-timeline-row" data-group-value="${escapeHtml(JSON.stringify(g.value))}"><span class="db-timeline-label">${escapeHtml(label)}</span><div class="db-timeline-track">${bars}</div></div>`;
    })
    .join('')}</div>`;
}

function chart(data: ViewData): string {
  if (!data.settings.x) return viewError('A chart needs a category property: add x=<property>.', 'Y851');
  const xProp = propertyMap(data.schema).get(data.settings.x);
  if (!xProp) return viewError(`A chart can't bucket by "${data.settings.x}": no such property.`, 'Y855');
  if (data.settings.aggregate && !AGGREGATES.has(data.settings.aggregate)) {
    return viewError(`Unknown aggregate "${data.settings.aggregate}". Use count, sum, avg, min or max.`, 'Y855');
  }
  const aggregate = data.settings.aggregate ?? 'count';
  const yProp = data.settings.y ? propertyMap(data.schema).get(data.settings.y) : undefined;
  if (aggregate !== 'count') {
    if (!data.settings.y) return viewError(`aggregate=${aggregate} needs a property: add y=<property>.`, 'Y851');
    if (!yProp || !['number', 'formula'].includes(yProp.type)) {
      return viewError(`A chart can't ${aggregate} "${data.settings.y}". Use a number property.`, 'Y855');
    }
  }
  if (data.settings.shape && !CHART_SHAPES.has(data.settings.shape)) {
    return viewError(`Unknown chart shape "${data.settings.shape}". Use bar, line or pie.`, 'Y855');
  }
  const shape = data.settings.shape ?? 'bar';
  const points = groupRows(data, xProp).map((g) => {
    const label = g.value === null ? 'No value' : g.label;
    if (aggregate === 'count') return { label, value: g.rows.length };
    const nums = g.rows.map((r) => Number(r.values[yProp!.name])).filter((n) => !Number.isNaN(n));
    const value = !nums.length
      ? 0
      : aggregate === 'sum'
        ? nums.reduce((a, b) => a + b, 0)
        : aggregate === 'avg'
          ? nums.reduce((a, b) => a + b, 0) / nums.length
          : aggregate === 'min'
            ? Math.min(...nums)
            : Math.max(...nums);
    return { label, value };
  });
  const formatValue = (v: number) => (Number.isInteger(v) ? String(v) : v.toFixed(2).replace(/0+$/, '').replace(/\.$/, ''));
  if (shape === 'pie') {
    const total = points.reduce((a, p) => a + p.value, 0) || 1;
    const hue = (i: number) => (i * 47) % 360;
    let angle = 0;
    const stops = points.map((p, i) => {
      const start = angle;
      angle += (p.value / total) * 360;
      return `hsl(${hue(i)} 65% 55%) ${start}deg ${angle}deg`;
    });
    const legend = points
      .map((p, i) => `<li><span class="db-chart-swatch" style="background:hsl(${hue(i)} 65% 55%)"></span>${escapeHtml(p.label)} (${formatValue(p.value)})</li>`)
      .join('');
    return `<div class="db-chart db-chart-pie"><div class="db-chart-pie-circle" style="background:conic-gradient(${stops.join(', ')})" title="${points.map((p) => `${escapeHtml(p.label)}: ${formatValue(p.value)}`).join(', ')}"></div><ul class="db-chart-legend">${legend}</ul></div>`;
  }
  const max = Math.max(...points.map((p) => p.value), 1);
  if (shape === 'line') {
    const w = 300;
    const h = 120;
    const padX = 16;
    const padY = 14;
    const n = points.length;
    const stepX = n > 1 ? (w - padX * 2) / (n - 1) : 0;
    const coords = points.map((p, i) => ({
      x: n > 1 ? padX + i * stepX : w / 2,
      y: padY + (1 - p.value / max) * (h - padY * 2),
      p,
    }));
    const path = coords.map((c, i) => `${i === 0 ? 'M' : 'L'}${c.x.toFixed(1)},${c.y.toFixed(1)}`).join(' ');
    const dots = coords
      .map(
        (c, i) =>
          `<circle class="db-chart-dot" data-color="${i % 8}" cx="${c.x.toFixed(1)}" cy="${c.y.toFixed(1)}" r="3"><title>${escapeHtml(c.p.label)}: ${formatValue(c.p.value)}</title></circle>`,
      )
      .join('');
    const axis = coords
      .map((c) => `<div class="db-chart-label" style="left:${((c.x / w) * 100).toFixed(2)}%">${escapeHtml(c.p.label)}</div>`)
      .join('');
    const values = coords
      .map((c) => `<div class="db-chart-value" style="left:${((c.x / w) * 100).toFixed(2)}%;top:${((c.y / h) * 100).toFixed(2)}%">${formatValue(c.p.value)}</div>`)
      .join('');
    return `<div class="db-chart db-chart-line"><div class="db-chart-plot"><svg viewBox="0 0 ${w} ${h}" preserveAspectRatio="none" class="db-chart-svg"><path d="${path}" class="db-chart-path"></path>${dots}</svg>${values}</div><div class="db-chart-axis">${axis}</div></div>`;
  }
  return `<div class="db-chart db-chart-${shape}">${points
    .map(
      (p, i) =>
        `<div class="db-chart-bar" data-color="${i % 8}" style="--value:${(p.value / max) * 100}%" title="${escapeHtml(p.label)}: ${formatValue(p.value)}"><span class="db-chart-value">${formatValue(p.value)}</span><span class="db-chart-label">${escapeHtml(p.label)}</span></div>`,
    )
    .join('')}</div>`;
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

function viewBody(data: ViewData): string {
  const type = data.settings.type;
  return type === 'list' ? list(data)
    : type === 'gallery' ? gallery(data)
    : type === 'calendar' ? calendar(data)
    : type === 'board' ? board(data)
    : type === 'timeline' ? timeline(data)
    : type === 'chart' ? chart(data)
    : table(data);
}

function ignoredAttrsMessage(ignored: (keyof SavedView)[], type: string): string {
  return `${ignored.join(', ')} ${ignored.length === 1 ? "doesn't apply" : "don't apply"} to a ${type} view, and ${ignored.length === 1 ? 'is' : 'are'} ignored.`;
}

/** The HTML for a `::db` view. */
export function renderView(data: ViewData): string {
  const body = viewBody(data);
  const shown = data.rows.length;
  const ignored = irrelevantAttrs(data.settings);
  const notice = ignored.length
    ? `<div class="db-notice"><span class="db-notice-code">Y856</span> ${escapeHtml(ignoredAttrsMessage(ignored, data.settings.type))}</div>`
    : '';
  return `<div class="db-view-body" data-db-type="${escapeHtml(data.settings.type)}" data-schema="${schemaAttr(data.schema)}"${data.interactive ? ' data-interactive' : ''}>${toolbar(data, shown)}${notice}${body}</div>`;
}

/**
 * Checks a view's settings against its schema alone — no rows, no SQL engine — so the editor can
 * surface Y851/Y855/Y856 the moment a `.ydb`-backed `::db[...]` reference is typed, not only when
 * the preview renders it. SQLite-backed views aren't checked this way yet: their schema can only be
 * read by opening the file through the SQL engine, which this (synchronous) path can't do.
 */
export function viewProblem(schema: Schema, attrs: Record<string, string | number | boolean> | undefined): { code: string; message: string } | undefined {
  const settings = viewSettings(schema, attrs);
  if (!(VIEW_TYPES as readonly string[]).includes(settings.type)) {
    return { code: 'Y851', message: `Unknown view type "${settings.type}". Use ${VIEW_TYPES.join(', ')}.` };
  }
  const data: ViewData = { key: '', ref: '', schema, rows: [], total: 0, settings, interactive: false, today: '1970-01-01' };
  const match = /class="db-error-code">([^<]+)<\/span> ([^<]*)<\/div>/.exec(viewBody(data));
  if (match) return { code: match[1] as string, message: match[2] as string };
  const ignored = irrelevantAttrs(settings);
  return ignored.length ? { code: 'Y856', message: ignoredAttrsMessage(ignored, settings.type) } : undefined;
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
    ...(str('date-end') !== undefined ? { dateEnd: str('date-end') } : {}),
    ...(str('x') !== undefined ? { x: str('x') } : {}),
    ...(str('y') !== undefined ? { y: str('y') } : {}),
    ...(str('aggregate') !== undefined ? { aggregate: str('aggregate') } : {}),
    ...(str('shape') !== undefined ? { shape: str('shape') } : {}),
  };
}

/** Which view-specific attributes actually apply to each view type. */
const TYPE_SPECIFIC_ATTRS: Record<string, (keyof SavedView)[]> = {
  table: [],
  list: [],
  gallery: ['cover'],
  calendar: ['date'],
  board: ['group'],
  timeline: ['date', 'dateEnd', 'group'],
  chart: ['x', 'y', 'aggregate', 'shape'],
};
const ALL_TYPE_SPECIFIC_ATTRS = ['group', 'date', 'dateEnd', 'cover', 'x', 'y', 'aggregate', 'shape'] as const;

/** Y856: view-specific attributes present but not meaningful for the resolved `type`, ignored. */
export function irrelevantAttrs(settings: SavedView & { type: string }): (keyof SavedView)[] {
  const relevant = new Set(TYPE_SPECIFIC_ATTRS[settings.type] ?? []);
  return ALL_TYPE_SPECIFIC_ATTRS.filter((k) => settings[k] !== undefined && !relevant.has(k));
}
