/**
 * Generated regions: `<!-- yamd:NAME attrs -->` … `<!-- /yamd:NAME -->`. The extension writes only
 * between the markers, and writing the same content twice changes nothing.
 */

interface Region {
  name: string;
  /** Attribute text from the opening marker, e.g. `depth=2`. */
  attrs: string;
  /** Line of the opening marker. */
  open: number;
  /** Line of the closing marker. */
  close: number;
}

const OPEN = /^\s*<!--\s*yamd:([a-z][\w:-]*)(?:\s+(.*?))?\s*-->\s*$/;
const CLOSE = /^\s*<!--\s*\/yamd:([a-z][\w:-]*)\s*-->\s*$/;

/** Every complete region in a note, in order. Regions don't nest. */
export function findRegions(lines: string[]): Region[] {
  const out: Region[] = [];
  let open: { name: string; attrs: string; line: number } | undefined;
  for (let i = 0; i < lines.length; i++) {
    const text = lines[i] ?? '';
    if (open) {
      const c = CLOSE.exec(text);
      if (c?.[1] === open.name) {
        out.push({ name: open.name, attrs: open.attrs, open: open.line, close: i });
        open = undefined;
      }
      continue;
    }
    const o = OPEN.exec(text);
    if (o) open = { name: o[1] as string, attrs: o[2] ?? '', line: i };
  }
  return out;
}

export function openMarker(name: string, attrs = ''): string {
  return `<!-- yamd:${name}${attrs ? ` ${attrs}` : ''} -->`;
}

export function closeMarker(name: string): string {
  return `<!-- /yamd:${name} -->`;
}

/**
 * Replaces the content of region `name` with `content`. Returns the new lines, or the same array
 * contents when nothing changes. If the region doesn't exist and `insertAfter` is given, creates
 * it there (after a blank line).
 */
export function writeRegion(lines: string[], name: string, content: string[], opts: { attrs?: string; insertAfter?: number } = {}): string[] {
  const region = findRegions(lines).find((r) => r.name === name);
  if (region) {
    const current = lines.slice(region.open + 1, region.close);
    if (current.length === content.length && current.every((l, i) => l === content[i])) return lines;
    return [...lines.slice(0, region.open + 1), ...content, ...lines.slice(region.close)];
  }
  if (opts.insertAfter === undefined) return lines;
  const block = ['', openMarker(name, opts.attrs), ...content, closeMarker(name)];
  return [...lines.slice(0, opts.insertAfter + 1), ...block, ...lines.slice(opts.insertAfter + 1)];
}
