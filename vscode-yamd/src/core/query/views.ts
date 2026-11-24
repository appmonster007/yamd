import { escapeHtml } from '../markdown/renderUtil';
import type { QueryResult } from './engine';

const SHOWN = (r: QueryResult) => (r.total > r.rows.length ? `<div class="db-more">Showing ${r.rows.length} of ${r.total} rows.</div>` : '');
const text = (v: unknown) => (v === null || v === undefined ? '' : String(v));

interface ViewOptions {
  view: string;
  group?: string;
  type?: string;
  x?: string;
  y?: string;
}

/** The HTML for a query result in the chosen view. Read-only; nothing here sends edits. */
export function renderQueryResult(result: QueryResult, o: ViewOptions): string {
  if (!result.rows.length) return '<div class="db-empty">No results.</div>';
  if (o.view === 'board') return board(result, o.group);
  if (o.view === 'chart') return chart(result, o);
  return table(result);
}

function table(r: QueryResult): string {
  const head = r.columns.map((c) => `<th>${escapeHtml(c)}</th>`).join('');
  const body = r.rows.map((row) => `<tr>${row.map((v) => `<td>${escapeHtml(text(v))}</td>`).join('')}</tr>`).join('');
  return `<table class="db-table db-result"><thead><tr>${head}</tr></thead><tbody>${body}</tbody></table>${SHOWN(r)}`;
}

function board(r: QueryResult, group: string | undefined): string {
  const gi = group === undefined ? -1 : r.columns.findIndex((c) => c.toLowerCase() === group.toLowerCase());
  if (gi < 0) return errorBox('Q003', `The board's group column "${group ?? ''}" is not in the result. Columns: ${r.columns.join(', ')}.`);
  const titleIndex = r.columns.findIndex((_, i) => i !== gi);
  const groups = new Map<string, string[][]>();
  for (const row of r.rows) {
    const key = text(row[gi]) || 'No value';
    const list = groups.get(key);
    if (list) list.push(row.map(text));
    else groups.set(key, [row.map(text)]);
  }
  const columns = [...groups.entries()].map(([name, rows], ci) => {
    const cards = rows
      .map((row) => {
        const title = titleIndex >= 0 ? row[titleIndex] : '';
        const meta = row.map((v, i) => (i === gi || i === titleIndex || v === '' ? '' : `<span class="kanban-prop"><span class="kanban-prop-name">${escapeHtml(r.columns[i] ?? '')}</span> ${escapeHtml(v)}</span>`)).join('');
        return `<article class="kanban-card"><div class="kanban-card-title">${escapeHtml(title ?? '')}</div><div class="kanban-card-meta">${meta}</div></article>`;
      })
      .join('\n');
    return `<section class="kanban-column" data-column="${ci}"><header class="kanban-column-header"><span class="kanban-column-title">${escapeHtml(name)}</span><span class="kanban-count">${rows.length}</span></header><div class="kanban-cards">${cards}</div></section>`;
  });
  return `<div class="kanban db-board"><div class="kanban-columns">${columns.join('\n')}</div></div>${SHOWN(r)}`;
}

function chart(r: QueryResult, o: ViewOptions): string {
  const xi = r.columns.findIndex((c) => c.toLowerCase() === (o.x ?? '').toLowerCase());
  const yi = r.columns.findIndex((c) => c.toLowerCase() === (o.y ?? '').toLowerCase());
  if (xi < 0 || yi < 0) return errorBox('Q003', `A chart needs x and y columns from the result. Columns: ${r.columns.join(', ')}.`);
  const points = r.rows.map((row) => ({ label: text(row[xi]), value: Number(row[yi]) })).filter((p) => Number.isFinite(p.value));
  if (!points.length) return errorBox('Q003', `Column "${o.y}" has no numbers to chart.`);
  const W = 640;
  const H = 300;
  const pad = { l: 48, r: 16, t: 16, b: 56 };
  const max = Math.max(...points.map((p) => p.value), 0);
  const min = Math.min(...points.map((p) => p.value), 0);
  const span = max - min || 1;
  const plotW = W - pad.l - pad.r;
  const plotH = H - pad.t - pad.b;
  const yOf = (v: number) => pad.t + plotH - ((v - min) / span) * plotH;
  const step = plotW / points.length;
  const axis = `<line x1="${pad.l}" y1="${yOf(0)}" x2="${W - pad.r}" y2="${yOf(0)}" stroke="currentColor" opacity=".4"/><text x="${pad.l - 6}" y="${pad.t + 4}" text-anchor="end" font-size="11" fill="currentColor">${escapeHtml(String(max))}</text><text x="${pad.l - 6}" y="${pad.t + plotH}" text-anchor="end" font-size="11" fill="currentColor">${escapeHtml(String(min))}</text>`;
  const labels = points
    .map((p, i) => `<text x="${pad.l + step * i + step / 2}" y="${H - pad.b + 16}" text-anchor="middle" font-size="11" fill="currentColor">${escapeHtml(p.label.length > 12 ? `${p.label.slice(0, 11)}…` : p.label)}</text>`)
    .join('');
  let marks: string;
  if (o.type === 'line') {
    const pts = points.map((p, i) => `${pad.l + step * i + step / 2},${yOf(p.value)}`).join(' ');
    marks = `<polyline points="${pts}" fill="none" stroke="var(--vscode-charts-blue, #3794ff)" stroke-width="2"/>${points.map((p, i) => `<circle cx="${pad.l + step * i + step / 2}" cy="${yOf(p.value)}" r="3.5" fill="var(--vscode-charts-blue, #3794ff)"><title>${escapeHtml(`${p.label}: ${p.value}`)}</title></circle>`).join('')}`;
  } else {
    const bw = Math.max(2, step * 0.7);
    marks = points
      .map((p, i) => {
        const top = Math.min(yOf(p.value), yOf(0));
        return `<rect x="${pad.l + step * i + (step - bw) / 2}" y="${top}" width="${bw}" height="${Math.abs(yOf(p.value) - yOf(0))}" fill="var(--vscode-charts-blue, #3794ff)"><title>${escapeHtml(`${p.label}: ${p.value}`)}</title></rect>`;
      })
      .join('');
  }
  return `<figure class="db-chart"><svg viewBox="0 0 ${W} ${H}" role="img" aria-label="${escapeHtml(`${o.y} by ${o.x}`)}" style="max-width:100%;color:var(--vscode-foreground, currentColor)">${axis}${marks}${labels}</svg></figure>${SHOWN(r)}`;
}

export function errorBox(code: string, message: string): string {
  return `<div class="db-error" role="alert"><span class="db-error-code">${escapeHtml(code)}</span> ${escapeHtml(message)}</div>`;
}
