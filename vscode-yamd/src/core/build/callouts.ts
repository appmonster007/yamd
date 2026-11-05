/**
 * Obsidian-style callouts: `> [!theorem] Title ^id` followed by `> ` lines. A callout ends at the first
 * line that does not start with `>`, so a blank line after it is required.
 */
import { scanFences } from '../widgets/fences';

/** Study callouts are numbered per type within a note. */
export const STUDY_TYPES = ['definition', 'theorem', 'lemma', 'proof', 'example', 'question', 'remark', 'summary', 'derivation'] as const;
const PLAIN_TYPES = ['note', 'tip', 'important', 'warning', 'caution', 'danger', 'card'] as const;
const CALLOUT_TYPES: readonly string[] = [...STUDY_TYPES, ...PLAIN_TYPES];

interface Callout {
  type: string;
  title: string;
  id?: string;
  startLine: number;
  endLine: number;
  /** Position among callouts of the same study type, starting at 1; undefined for other types. */
  number?: number;
}

const START = /^[ \t]*>[ \t]*\[!([A-Za-z][\w-]*)\][+-]?[ \t]*(.*)$/;
const QUOTE = /^[ \t]*>/;

export const isStudyType = (type: string) => (STUDY_TYPES as readonly string[]).includes(type);

/** `Theorem`, `Definition`, … */
export const typeLabel = (type: string) => type.charAt(0).toUpperCase() + type.slice(1);

export function fencedLines(lines: string[]): Set<number> {
  const out = new Set<number>();
  for (const f of scanFences(lines)) for (let l = f.startLine; l <= f.endLine; l++) out.add(l);
  return out;
}

export function scanCallouts(lines: string[]): Callout[] {
  const fenced = fencedLines(lines);
  const counts = new Map<string, number>();
  const out: Callout[] = [];
  for (let i = 0; i < lines.length; i++) {
    if (fenced.has(i)) continue;
    const m = START.exec(lines[i] ?? '');
    if (!m) continue;
    const type = (m[1] as string).toLowerCase();
    let title = (m[2] ?? '').trim();
    let id: string | undefined;
    const idMatch = /(?:^|\s)\^([A-Za-z0-9][\w-]*)\s*$/.exec(title);
    if (idMatch) {
      id = idMatch[1];
      title = title.slice(0, idMatch.index).trim();
    }
    let end = i;
    while (end + 1 < lines.length && QUOTE.test(lines[end + 1] ?? '')) end++;
    const callout: Callout = { type, title, startLine: i, endLine: end };
    if (id) callout.id = id;
    if (isStudyType(type)) {
      const n = (counts.get(type) ?? 0) + 1;
      counts.set(type, n);
      callout.number = n;
    }
    out.push(callout);
    i = end;
  }
  return out;
}

/** Problems with callouts: unknown types and a missing blank line after the block. */
export function calloutProblems(lines: string[]): { line: number; code: 'C001' | 'C002'; message: string }[] {
  const out: { line: number; code: 'C001' | 'C002'; message: string }[] = [];
  for (const c of scanCallouts(lines)) {
    if (!CALLOUT_TYPES.includes(c.type)) out.push({ line: c.startLine, code: 'C001', message: `Unknown callout type "${c.type}".` });
    const next = lines[c.endLine + 1];
    if (next !== undefined && next.trim() !== '') {
      out.push({ line: c.endLine, code: 'C002', message: 'Leave a blank line after a callout, or the next line is absorbed into it.' });
    }
  }
  return out;
}
