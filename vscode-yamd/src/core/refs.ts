/**
 * Cross-reference targets and references. A target is a `^id` on its own line after a figure, table or
 * equation (`^fig-arch`), or a `^id` on a callout's title. A reference is written `[@fig-arch]`; Build
 * turns it into `[Figure 2](#fig-arch)` and keeps the label current.
 */
import { fencedLines, isStudyType, scanCallouts, typeLabel } from './callouts';

export interface Target {
  id: string;
  kind: string;
  number: number;
  label: string;
  line: number;
}

const KIND_BY_PREFIX: Record<string, string> = { fig: 'Figure', tbl: 'Table', eq: 'Equation' };
const TARGET_LINE = /^\s*\^([a-z0-9][a-z0-9-]*)\s*$/;

/** Every target in a note, in document order, with its number within its kind. */
export function collectTargets(lines: string[]): Target[] {
  const fenced = fencedLines(lines);
  const found: { id: string; kind: string; line: number; number?: number }[] = [];
  for (let i = 0; i < lines.length; i++) {
    if (fenced.has(i)) continue;
    const m = TARGET_LINE.exec(lines[i] ?? '');
    const kind = m ? KIND_BY_PREFIX[(m[1] as string).split('-')[0] as string] : undefined;
    if (m && kind) found.push({ id: m[1] as string, kind, line: i });
  }
  for (const c of scanCallouts(lines)) {
    if (c.id && isStudyType(c.type) && c.number !== undefined) found.push({ id: c.id, kind: typeLabel(c.type), line: c.startLine, number: c.number });
  }
  found.sort((a, b) => a.line - b.line);
  const counts = new Map<string, number>();
  const out: Target[] = [];
  for (const f of found) {
    const number = f.number ?? (counts.get(f.kind) ?? 0) + 1;
    if (f.number === undefined) counts.set(f.kind, number);
    out.push({ id: f.id, kind: f.kind, number, label: `${f.kind} ${number}`, line: f.line });
  }
  return out;
}

/** Applies `fn` to the parts of each line that are not inline code, skipping fenced code and front matter. */
export function mapOutsideCode(lines: string[], fn: (text: string) => string): string[] {
  const fenced = fencedLines(lines);
  let frontEnd = -1;
  if (lines[0]?.trim() === '---') frontEnd = lines.findIndex((l, i) => i > 0 && l.trim() === '---');
  return lines.map((line, i) => {
    if (fenced.has(i) || i <= frontEnd) return line;
    return line.split(/(`+[^`]*`+)/).map((part, k) => (k % 2 === 1 ? part : fn(part))).join('');
  });
}

const LABEL = /^[A-Z][a-z]+ \d+$/;

/** Turns `[@id]` into `[Label](#id)` and refreshes the label of existing reference links. */
export function resolveReferences(lines: string[], targets: Target[]): string[] {
  const byId = new Map(targets.map((t) => [t.id, t]));
  return mapOutsideCode(lines, (text) =>
    text
      .replace(/\[@([a-z0-9][a-z0-9-]*)\](?!\()/g, (whole, id: string) => {
        const t = byId.get(id);
        return t ? `[${t.label}](#${id})` : whole;
      })
      .replace(/\[([^\]\n]+)\]\(#([a-z0-9][a-z0-9-]*)\)/g, (whole, label: string, id: string) => {
        const t = byId.get(id);
        return t && LABEL.test(label) && label !== t.label ? `[${t.label}](#${id})` : whole;
      }),
  );
}

export type RefAt = { kind: 'xref'; id: string } | { kind: 'cite'; keys: string[] } | { kind: 'image'; src: string };

/** What the cursor is on: a cross-reference, a citation, or an image. */
export function refAt(line: string, col: number): RefAt | undefined {
  const spans: { re: RegExp; make: (m: RegExpExecArray) => RefAt | undefined }[] = [
    { re: /!\[[^\]]*\]\(([^)\s]+)(?:\s+"[^"]*")?\)/g, make: (m) => ({ kind: 'image', src: m[1] as string }) },
    { re: /\[[^\]\n]+\]\(#([a-z0-9][a-z0-9-]*)\)/g, make: (m) => ({ kind: 'xref', id: m[1] as string }) },
    {
      re: /\[(@[^\]\n]+)\]/g,
      make: (m) => {
        const keys = [...(m[1] as string).matchAll(/@([^\s;,\]]+)/g)].map((k) => k[1] as string);
        if (keys.length === 1 && /^[a-z0-9][a-z0-9-]*$/.test(keys[0] as string) && /^(fig|tbl|eq)-/.test(keys[0] as string)) return { kind: 'xref', id: keys[0] as string };
        return keys.length ? { kind: 'cite', keys } : undefined;
      },
    },
  ];
  for (const { re, make } of spans) {
    for (const m of line.matchAll(re)) {
      const start = m.index ?? 0;
      if (col >= start && col <= start + m[0].length) return make(m);
    }
  }
  return undefined;
}
