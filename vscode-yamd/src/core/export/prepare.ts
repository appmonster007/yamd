/**
 * Turns a built 1.2.0 note into source the older renderer understands, for HTML, print and slide
 * exports: callouts and widget fences become containers, `^id` targets and query blocks become
 * placeholders that `finalizeHtml` replaces after rendering (so ids and query tables survive
 * sanitizing untouched).
 */
import { scanCallouts, STUDY_TYPES } from '../build/callouts';
import { fencedLines } from '../build/callouts';
import { parseAttributes, scanWidgets } from '../widgets/fences';
import { parseMarkerLine } from '../build/markers';

const BOARDS = new Set(['kanban', 'calendar', 'timeline', 'gallery']);
const PLAIN = new Set(['note', 'tip', 'warning', 'danger']);
const TYPE_ALIAS: Record<string, string> = { important: 'note', caution: 'warning' };
const STUDY = new Set<string>(STUDY_TYPES);

interface Prepared {
  source: string;
  /** Start lines of the query blocks, whose placeholders are `YAMDQUERY<line>`. */
  queryBlocks: number[];
}

/** `class=wide width=50%` as the engine's `{.wide width=50%}`. */
function attributeBlock(text: string): string | undefined {
  const { attrs } = parseAttributes(text);
  const parts: string[] = [];
  for (const [k, v] of Object.entries(attrs)) {
    if (k === 'class') parts.push(...v.split(/\s+/).filter(Boolean).map((c) => `.${c}`));
    else if (k !== 'id') parts.push(/^[\w%.-]+$/.test(v) ? `${k}=${v}` : `${k}="${v.replace(/"/g, "'")}"`);
  }
  return parts.length ? `{${parts.join(' ')}}` : undefined;
}

const stripQuote = (line: string) => line.replace(/^[ \t]*>[ \t]?/, '');
const quoteAttr = (s: string) => s.replace(/"/g, "'");

export function prepareExport(lines: string[]): Prepared {
  const replace = new Map<number, { end: number; lines: string[] }>();
  const queryBlocks: number[] = [];

  for (const w of scanWidgets(lines)) {
    if (!w.closed) continue;
    if (BOARDS.has(w.type)) {
      const body = lines.slice(w.bodyStartLine, w.bodyEndLine + 1);
      replace.set(w.startLine, { end: w.endLine, lines: [`:::${w.type}`, ...body, ':::'] });
    } else if (w.type === 'sql') {
      queryBlocks.push(w.startLine);
      replace.set(w.startLine, { end: w.endLine, lines: ['', `YAMDQUERY${w.startLine}`, ''] });
    }
  }

  for (const c of scanCallouts(lines)) {
    const body = lines.slice(c.startLine + 1, c.endLine + 1).map(stripQuote);
    const type = TYPE_ALIAS[c.type] ?? (STUDY.has(c.type) || PLAIN.has(c.type) || c.type === 'card' ? c.type : 'note');
    const attrs = [c.id ? `#${c.id}` : '', c.title && type !== 'card' ? `title="${quoteAttr(c.title)}"` : ''].filter(Boolean).join(' ');
    const head = `:::${type}${attrs ? ` {${attrs}}` : ''}`;
    const inner = type === 'card' ? [c.title, '---', ...body] : body;
    replace.set(c.startLine, { end: c.endLine, lines: ['', head, ...inner, ':::', ''] });
  }

  const fenced = fencedLines(lines);
  const out: string[] = [];
  let pendingAttrs: string | undefined;
  for (let i = 0; i < lines.length; i++) {
    const r = replace.get(i);
    if (r) {
      out.push(...r.lines);
      i = r.end;
      continue;
    }
    const line = lines[i] ?? '';
    if (fenced.has(i)) {
      out.push(line);
      continue;
    }
    const target = /^\s*\^([a-z0-9][a-z0-9-]*)\s*$/.exec(line);
    if (target) {
      out.push(`YAMDANCHOR:${target[1]}`);
      continue;
    }
    const marker = parseMarkerLine(line);
    if (marker && !marker.closing && marker.name === 'pagebreak') {
      out.push('::pagebreak');
      continue;
    }
    if (marker && !marker.closing && marker.name === 'attrs') {
      pendingAttrs = attributeBlock(marker.attrs);
      out.push('');
      continue;
    }
    if (pendingAttrs && line.trim() !== '') {
      out.push(`${line} ${pendingAttrs}`);
      pendingAttrs = undefined;
      continue;
    }
    out.push(line);
  }
  return { source: out.join('\n'), queryBlocks };
}

/** Replaces the placeholders with anchors and query results in the rendered page. */
export function finalizeHtml(html: string, queries: Map<number, string>): string {
  return html
    .replace(/<p[^>]*>\s*YAMDANCHOR:([a-z0-9-]+)\s*<\/p>/g, (_m, id: string) => `<a id="${id}"></a>`)
    .replace(/<p[^>]*>\s*YAMDQUERY(\d+)\s*<\/p>/g, (_m, line: string) => queries.get(Number(line)) ?? '');
}
