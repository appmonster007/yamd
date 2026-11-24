import { fencedLines } from './callouts';
import { parseAttributes } from '../widgets/fences';

/**
 * Every comment YAMD reads follows one convention: it sits on a line of its own, in the `yamd:`
 * namespace.
 *
 * - A **region** is generated content between `<!-- yamd:NAME attrs -->` and `<!-- /yamd:NAME -->`:
 *   `toc`, `bibliography` and `query:ID`.
 * - An **instruction** is a single `<!-- yamd:NAME attrs -->` that affects exports: `pagebreak` and
 *   `attrs` (classes and `key=value` pairs for the next element).
 *
 * Attributes use the same `key=value` / `key="value with spaces"` grammar as widget fences. Any other
 * HTML comment is the author's own and is never touched.
 */

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
  const fenced = fencedLines(lines);
  let open: { name: string; attrs: string; line: number } | undefined;
  for (let i = 0; i < lines.length; i++) {
    // Markers shown as examples inside a code block are not real.
    if (fenced.has(i)) continue;
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

export const REGION_NAMES = ['toc', 'bibliography', 'cards'] as const;
export const INSTRUCTION_NAMES = ['pagebreak', 'attrs'] as const;

export const isRegionName = (name: string) => (REGION_NAMES as readonly string[]).includes(name) || name.startsWith('query:');
export const isKnownMarker = (name: string) => isRegionName(name) || (INSTRUCTION_NAMES as readonly string[]).includes(name);

export interface MarkerLine {
  name: string;
  attrs: string;
  closing: boolean;
}

/** A `yamd:` comment line, or undefined for any other line. */
export function parseMarkerLine(line: string): MarkerLine | undefined {
  const c = CLOSE.exec(line);
  if (c) return { name: c[1] as string, attrs: '', closing: true };
  const o = OPEN.exec(line);
  return o ? { name: o[1] as string, attrs: o[2] ?? '', closing: false } : undefined;
}

export function instructionMarker(name: (typeof INSTRUCTION_NAMES)[number], attrs = ''): string {
  return openMarker(name, attrs);
}

export interface MarkerProblem {
  code: 'M001' | 'M002' | 'M003';
  severity: 'warning' | 'error';
  message: string;
  line: number;
}

/** Problems with the markers in a note: unknown names, unclosed or stray region markers, bad attributes. */
export function lintMarkers(lines: string[]): MarkerProblem[] {
  const out: MarkerProblem[] = [];
  const skip = fencedLines(lines);
  let open: { name: string; line: number } | undefined;
  for (let i = 0; i < lines.length; i++) {
    if (skip.has(i)) continue;
    const text = lines[i] ?? '';
    const m = parseMarkerLine(text);
    if (!m) continue;
    if (!isKnownMarker(m.name)) {
      out.push({ code: 'M001', severity: 'warning', message: `Unknown YAMD marker "${m.name}". Known: ${[...REGION_NAMES, 'query:ID', ...INSTRUCTION_NAMES].join(', ')}.`, line: i });
      continue;
    }
    if (m.name === 'attrs' && !m.closing && ('id' in parseAttributes(m.attrs).attrs || /(^|\s)[.#]/.test(m.attrs))) {
      out.push({ code: 'M003', severity: 'warning', message: 'yamd:attrs takes key=value pairs such as class=wide width=50%. Use ^id for ids.', line: i });
      continue;
    }
    if (!isRegionName(m.name)) continue;
    if (m.closing) {
      if (open?.name === m.name) open = undefined;
      else out.push({ code: 'M002', severity: 'error', message: `This closes "${m.name}", which isn't open.`, line: i });
    } else {
      if (open) out.push({ code: 'M002', severity: 'error', message: `The "${open.name}" region on line ${open.line + 1} is never closed.`, line: open.line });
      open = { name: m.name, line: i };
    }
  }
  if (open) out.push({ code: 'M002', severity: 'error', message: `The "${open.name}" region is never closed.`, line: open.line });
  return out;
}
