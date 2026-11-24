/**
 * Turns a built 1.2.0 note into source the renderer understands, for HTML, print and slide exports.
 * Callouts become containers. Widget blocks, query blocks and `^id` targets become placeholders that
 * `finalizeHtml` replaces after rendering: widgets are rendered on their own with the full YAMD syntax
 * (tags, `{key=value}` attributes), while the prose around them is read as plain Markdown, and ids
 * and query tables survive sanitizing untouched.
 */
import { scanCallouts, STUDY_TYPES } from '../build/callouts';
import { fencedLines } from '../build/callouts';
import { parseAttributes, scanWidgets } from '../widgets/fences';
import { parse, render } from '../markdown';
import type { RenderOptions } from '../markdown';
import { parseMarkerLine } from '../build/markers';

const BOARDS = new Set(['kanban', 'calendar', 'timeline', 'gallery']);
const PLAIN = new Set(['note', 'tip', 'warning', 'danger']);
const TYPE_ALIAS: Record<string, string> = { important: 'note', caution: 'warning' };
const STUDY = new Set<string>(STUDY_TYPES);

export interface PreparedWidget {
  /** Start line of the block, which names its placeholder `YAMDWIDGET<line>`. */
  line: number;
  type: string;
  /** The attributes from the block's opening line (`source`, `id`, …). */
  attrs: Record<string, string>;
  body: string[];
}

export interface Prepared {
  source: string;
  /** Start lines of the query blocks, whose placeholders are `YAMDQUERY<line>`. */
  queryBlocks: number[];
  widgets: PreparedWidget[];
}

const b64 = (text: string) => btoa(unescape(encodeURIComponent(text))).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
const unb64 = (token: string) => decodeURIComponent(escape(atob(token.replace(/-/g, '+').replace(/_/g, '/'))));

const stripQuote = (line: string) => line.replace(/^[ \t]*>[ \t]?/, '');
const quoteAttr = (s: string) => s.replace(/"/g, "'");

export function prepareExport(lines: string[]): Prepared {
  const replace = new Map<number, { end: number; lines: string[] }>();
  const queryBlocks: number[] = [];
  const widgets: PreparedWidget[] = [];

  for (const w of scanWidgets(lines)) {
    if (!w.closed) continue;
    if (BOARDS.has(w.type)) {
      widgets.push({ line: w.startLine, type: w.type, attrs: w.attrs, body: lines.slice(w.bodyStartLine, w.bodyEndLine + 1) });
      replace.set(w.startLine, { end: w.endLine, lines: ['', `YAMDWIDGET${w.startLine}`, ''] });
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
    // A directive typed by hand is plain text in a Markdown note; only the ones made here are real.
    if (/^\s*:{2,}[A-Za-z]/.test(line)) {
      out.push(line.replace(/^(\s*)/, '$1\\'));
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
      // Applied to the next element once the page is rendered (see `finalizeHtml`).
      out.push('', `YAMDATTRS:${b64(marker.attrs)}`, '');
      continue;
    }
    out.push(line);
  }
  return { source: out.join('\n'), queryBlocks, widgets };
}

/** Renders each widget on its own, with the full YAMD syntax, as static HTML keyed by its start line. */
export function renderWidgets(widgets: PreparedWidget[], options: RenderOptions = {}): Map<number, string> {
  const out = new Map<number, string>();
  for (const w of widgets) out.set(w.line, render(parse(`:::${w.type}\n${w.body.join('\n')}\n:::`), { ...options, interactive: false }));
  return out;
}

/** Adds `class` and `key=value` pairs from a `yamd:attrs` marker to an opening tag. */
function applyAttributes(tag: string, text: string): string {
  const { attrs } = parseAttributes(text);
  let out = tag.replace(/\s*\/?>$/, '');
  const selfClosing = /\/>$/.test(tag);
  for (const [key, value] of Object.entries(attrs)) {
    if (!/^[a-z][\w-]*$/i.test(key) || /^on/i.test(key) || key === 'id' || key === 'style') continue;
    const safe = value.replace(/&/g, '&amp;').replace(/"/g, '&quot;').replace(/</g, '&lt;');
    if (key === 'class') {
      out = /\sclass="/.test(out) ? out.replace(/\sclass="([^"]*)"/, (_m, c: string) => ` class="${c} ${safe}"`) : `${out} class="${safe}"`;
    } else if (!new RegExp(`\\s${key}=`, 'i').test(out)) out += ` ${key}="${safe}"`;
  }
  return `${out}${selfClosing ? ' />' : '>'}`;
}

/** Replaces the placeholders with anchors, widgets and query results in the rendered page. */
export function finalizeHtml(html: string, blocks: Map<number, string>): string {
  return html
    .replace(/<p[^>]*>\s*YAMDATTRS:([A-Za-z0-9_-]+)\s*<\/p>\s*(?:<p\b[^>]*>\s*(<img\b[^>]*>)|(<[a-z][a-z0-9]*\b[^>]*>))?/g, (_m, token: string, img: string | undefined, tag: string | undefined) => {
      const target = img ?? tag;
      if (!target) return '';
      const withAttrs = applyAttributes(target, unb64(token));
      return img ? `<p>${withAttrs}` : withAttrs;
    })
    .replace(/<p[^>]*>\s*YAMDANCHOR:([a-z0-9-]+)\s*<\/p>/g, (_m, id: string) => `<a id="${id}"></a>`)
    .replace(/<p[^>]*>\s*YAMD(?:QUERY|WIDGET)(\d+)\s*<\/p>/g, (_m, line: string) => blocks.get(Number(line)) ?? '');
}
