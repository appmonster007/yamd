/**
 * Finds widget blocks in a Markdown note: fenced code blocks whose info string names a widget
 * (` ```kanban id=sprint-12 `), and ` ```sql ` blocks whose first line is an attribute comment
 * (`-- id="open-bugs" source="bugs.csv"`). Pure functions, free of `vscode`, so they can be tested.
 * Line numbers are 0-based.
 */

export const WIDGET_TYPES = ['kanban', 'calendar', 'timeline', 'gallery', 'sql'] as const;
export type WidgetType = (typeof WIDGET_TYPES)[number];

/** Lowercase letters, digits and `-`, starting with a letter or digit. */
export const ID_PATTERN = /^[a-z0-9][a-z0-9-]*$/;

export interface Fence {
  /** The first word of the info string, as written (lowercased). */
  type: string;
  attrs: Record<string, string>;
  /** The explicit `id`, if the block has one. */
  id?: string;
  /** Line of the opening fence. */
  startLine: number;
  /** Line of the closing fence (the last line of the note for an unclosed fence). */
  endLine: number;
  /** First and last line of the body (empty when `bodyEndLine < bodyStartLine`). */
  bodyStartLine: number;
  bodyEndLine: number;
  closed: boolean;
}

export interface WidgetBlock extends Fence {
  type: WidgetType;
  /** `id` when present, otherwise a positional label such as `kanban #2`. */
  label: string;
  /** Position among the widgets of the same type, starting at 1. */
  ordinal: number;
}

/** An opening or closing fence, after an optional quote or list prefix. */
const FENCE_LINE = /^((?:[ \t]*>)*[ \t]*(?:(?:[-*+]|\d{1,9}[.)])[ \t]+)?)(`{3,}|~{3,})(.*)$/;

/**
 * Parses `key=value`, `key="value with spaces"` and bare words. A bare word alone is returned in
 * `bare`; callers decide what it means.
 */
export function parseAttributes(text: string): { attrs: Record<string, string>; bare: string[] } {
  const attrs: Record<string, string> = {};
  const bare: string[] = [];
  const re = /([A-Za-z_][\w-]*)=(?:"([^"]*)"|'([^']*)'|(\S+))|(\S+)/g;
  for (const m of text.matchAll(re)) {
    if (m[1] !== undefined) attrs[m[1]] = m[2] ?? m[3] ?? m[4] ?? '';
    else if (m[5] !== undefined) bare.push(m[5]);
  }
  return { attrs, bare };
}

/** The attribute text after `-- ` on the first body line of a `sql` block, or undefined if it has none. */
export function sqlHeader(line: string | undefined): string | undefined {
  const m = line === undefined ? null : /^\s*--\s*(.*)$/.exec(line);
  return m?.[1];
}

/** Every fenced code block in the note, in order. */
export function scanFences(lines: string[]): Fence[] {
  const out: Fence[] = [];
  let open: { prefix: string; char: string; length: number; line: number; info: string } | undefined;
  for (let i = 0; i < lines.length; i++) {
    const m = FENCE_LINE.exec(lines[i] ?? '');
    if (!open) {
      if (!m) continue;
      const [, prefix = '', ticks = '', info = ''] = m;
      // An info string for a backtick fence can't contain backticks.
      if (ticks[0] === '`' && info.includes('`')) continue;
      open = { prefix, char: ticks[0] ?? '`', length: ticks.length, line: i, info: info.trim() };
      continue;
    }
    if (m && (m[2] ?? '')[0] === open.char && (m[2] ?? '').length >= open.length && (m[3] ?? '').trim() === '') {
      out.push(makeFence(open.info, open.line, i, lines, true));
      open = undefined;
    }
  }
  if (open) out.push(makeFence(open.info, open.line, lines.length - 1, lines, false));
  return out;
}

function makeFence(info: string, startLine: number, endLine: number, lines: string[], closed: boolean): Fence {
  const [first = '', ...rest] = info.split(/\s+/);
  const type = first.toLowerCase();
  const { attrs, bare } = parseAttributes(rest.join(' '));
  // One bare word and no other options is the id (` ```kanban sprint-12 `).
  if (bare.length === 1 && Object.keys(attrs).length === 0) attrs['id'] = bare[0] as string;
  const bodyStartLine = startLine + 1;
  const bodyEndLine = (closed ? endLine : endLine + 1) - 1;
  if (type === 'sql') {
    const header = bodyEndLine >= bodyStartLine ? sqlHeader(lines[bodyStartLine]) : undefined;
    if (header !== undefined) Object.assign(attrs, parseAttributes(header).attrs);
  }
  const fence: Fence = { type, attrs, startLine, endLine, bodyStartLine, bodyEndLine, closed };
  if (attrs['id'] !== undefined) fence.id = attrs['id'];
  return fence;
}

/**
 * The widget blocks in a note. A ` ```sql ` block is a widget only when its header comment names a
 * `source`; any other `sql` block is ordinary code.
 */
export function scanWidgets(lines: string[]): WidgetBlock[] {
  const counts = new Map<string, number>();
  const out: WidgetBlock[] = [];
  for (const f of scanFences(lines)) {
    if (!(WIDGET_TYPES as readonly string[]).includes(f.type)) continue;
    if (f.type === 'sql' && f.attrs['source'] === undefined) continue;
    const ordinal = (counts.get(f.type) ?? 0) + 1;
    counts.set(f.type, ordinal);
    out.push({ ...f, type: f.type as WidgetType, ordinal, label: f.id ?? `${f.type} #${ordinal}` });
  }
  return out;
}
