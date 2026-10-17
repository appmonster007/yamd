/**
 * Converts GitHub-flavored Markdown into YAMD that renders the same way: YAMD-only syntax is
 * backslash-escaped, and soft line breaks inside paragraphs are joined (YAMD keeps them).
 */
import { parse, walkBlocks, yamdSyntaxOffsets } from './parser';
import type { Block, InlineNode, Range } from './types';

export interface ConvertResult {
  text: string;
  /** Number of backslashes added. */
  escaped: number;
  /** Number of line breaks joined. */
  joined: number;
}

/** Escaping one construct can reveal another (`{{x}}` → `\{{x}}` leaves `{x}`), so this repeats. */
const MAX_PASSES = 20;

export function convertFromMarkdown(source: string): ConvertResult {
  let text = source;
  let escaped = 0;
  for (let pass = 0; pass < MAX_PASSES; pass++) {
    const offsets = yamdSyntaxOffsets(text)
      .map((o) => skipSpace(text, o))
      .filter((o) => o < text.length);
    if (offsets.length === 0) break;
    for (const o of [...new Set(offsets)].sort((a, b) => b - a)) {
      text = `${text.slice(0, o)}\\${text.slice(o)}`;
      escaped++;
    }
  }
  const breaks = softBreaks(text);
  for (const r of breaks.sort((a, b) => b.start - a.start)) {
    text = `${text.slice(0, r.start)} ${text.slice(r.end)}`;
  }
  return { text, escaped, joined: breaks.length };
}

/**
 * Joins the source lines of one paragraph, for the Y210 quick fix. The first line keeps its
 * prefix (list marker or `>`); the others lose their indentation and `>` markers.
 */
export function joinParagraphLines(lines: string[]): string {
  return lines
    .map((l, i) => (i === 0 ? l.trimEnd() : l.replace(/^[ \t]*(?:>[ \t]?)*[ \t]*/, '').trimEnd()))
    .join(' ');
}

function skipSpace(text: string, offset: number): number {
  let o = offset;
  while (o < text.length && (text[o] === ' ' || text[o] === '\t')) o++;
  return o;
}

function softBreaks(text: string): Range[] {
  const doc = parse(text);
  const out: Range[] = [];
  const visit = (nodes: InlineNode[]) => {
    for (const n of nodes) {
      if (n.type === 'break' && n.soft) out.push(n.range);
      if ('children' in n && Array.isArray(n.children)) visit(n.children);
      if (n.type === 'reviewSubstitute') {
        visit(n.from);
        visit(n.to);
      }
    }
  };
  const roots: Block[] = [...doc.blocks, ...[...doc.footnotes.values()].flatMap((f) => f.children)];
  walkBlocks(roots, (b) => {
    if (b.type === 'paragraph' || b.type === 'heading') visit(b.children);
    else if (b.type === 'table') [...b.header, ...b.rows.flat()].forEach((c) => visit(c.children));
  });
  return out;
}
