import type { Attrs } from './types';

const TOKEN = /\s*(?:#([^\s{}]+)|\.([\w-]+)|([\w-]+)=(?:"([^"]*)"|'([^']*)'|([^\s"'{}]+))|([\w-]+))/y;

/** Parses the inside of `{...}`. Returns null if it isn't a valid attribute list. */
export function parseAttrs(body: string): Attrs | null {
  const attrs: Attrs = { classes: [], values: {} };
  TOKEN.lastIndex = 0;
  let pos = 0;
  let count = 0;
  while (pos < body.length) {
    if (body.slice(pos).trim() === '') break;
    TOKEN.lastIndex = pos;
    const m = TOKEN.exec(body);
    if (!m) return null;
    pos = TOKEN.lastIndex;
    if (pos < body.length && !/\s/.test(body[pos] ?? '')) return null;
    count++;
    if (m[1] !== undefined) attrs.id = m[1];
    else if (m[2] !== undefined) attrs.classes.push(m[2]);
    else if (m[3] !== undefined) attrs.values[m[3]] = m[4] ?? m[5] ?? m[6] ?? '';
    else if (m[7] !== undefined) attrs.values[m[7]] = true;
  }
  return count > 0 ? attrs : null;
}

/** Parses a complete `{...}` string. */
export function parseAttrBlock(text: string): Attrs | null {
  const t = text.trim();
  if (!t.startsWith('{') || !t.endsWith('}') || t.startsWith('{{')) return null;
  const body = t.slice(1, -1);
  if (/[{}]/.test(body) || /^[+\-~=>]/.test(body)) return null;
  return parseAttrs(body);
}

const TRAILING = /(?<![{\\])\{([^{}]*)\}\s*$/;

/** Splits a trailing `{...}` attribute list off the end of a line. */
export function splitTrailingAttrs(text: string): { text: string; attrs?: Attrs } {
  const m = TRAILING.exec(text);
  if (!m || /^[+\-~=>]/.test(m[1] ?? '')) return { text };
  const attrs = parseAttrs(m[1] ?? '');
  if (!attrs) return { text };
  return { text: text.slice(0, m.index).replace(/\s+$/, ''), attrs };
}

export function mergeAttrs(a: Attrs | undefined, b: Attrs | undefined): Attrs | undefined {
  if (!a) return b;
  if (!b) return a;
  return {
    id: b.id ?? a.id,
    classes: [...a.classes, ...b.classes],
    values: { ...a.values, ...b.values },
  };
}

export function attrString(attrs: Attrs | undefined, key: string): string | undefined {
  const v = attrs?.values[key];
  return typeof v === 'string' ? v : undefined;
}

export function attrNumber(attrs: Attrs | undefined, key: string): number | undefined {
  const v = attrString(attrs, key);
  if (v === undefined || !/^\d+$/.test(v)) return undefined;
  return Number(v);
}
