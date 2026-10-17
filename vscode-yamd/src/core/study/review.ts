/**
 * Peer review (§7): a summary of the suggestions and comments in a note, and accept-all or
 * reject-all as plain text edits.
 */
import { walkBlocks } from '../parser';
import type { Block, InlineNode, Range, YamdDocument } from '../types';

export interface ReviewItem {
  kind: 'insert' | 'delete' | 'substitute' | 'comment';
  /** 0-based line. */
  line: number;
  range: Range;
  /** The changed or commented text, shortened. */
  text: string;
  comment?: string;
}

function inlinesOf(b: Block): InlineNode[][] {
  switch (b.type) {
    case 'paragraph':
    case 'heading':
      return [b.children];
    case 'table':
      return [...b.header, ...b.rows.flat()].map((c) => c.children);
    case 'leaf':
      return [b.label];
    default:
      return [];
  }
}

function visit(nodes: InlineNode[], fn: (n: InlineNode) => void): void {
  for (const n of nodes) {
    fn(n);
    if ('children' in n && Array.isArray(n.children)) visit(n.children, fn);
    if (n.type === 'reviewSubstitute') {
      visit(n.from, fn);
      visit(n.to, fn);
    }
  }
}

function lineAt(doc: YamdDocument, offset: number): number {
  let line = 0;
  while (line + 1 < doc.lineStarts.length && (doc.lineStarts[line + 1] ?? Infinity) <= offset) line++;
  return line;
}

const short = (s: string) => (s.length > 60 ? `${s.slice(0, 57)}…` : s);

/** Top-level review nodes in source order (nested ones are covered by their parent). */
function topLevel(doc: YamdDocument): InlineNode[] {
  const found: InlineNode[] = [];
  const roots = [...doc.blocks, ...[...doc.footnotes.values()].flatMap((f) => f.children)];
  walkBlocks(roots, (b) => {
    for (const nodes of inlinesOf(b)) {
      visit(nodes, (n) => {
        if (n.type === 'review' || n.type === 'reviewSubstitute' || n.type === 'reviewHighlight' || n.type === 'reviewComment') {
          if (!found.some((f) => f.range.start <= n.range.start && f.range.end >= n.range.end)) found.push(n);
        }
      });
    }
  });
  return found.sort((a, b) => a.range.start - b.range.start);
}

export function collectReview(doc: YamdDocument): ReviewItem[] {
  const items = topLevel(doc).map((n): ReviewItem => {
    const raw = doc.source.slice(n.range.start, n.range.end);
    const line = lineAt(doc, n.range.start);
    switch (n.type) {
      case 'review':
        return { kind: n.kind, line, range: n.range, text: short(raw.slice(3, -3)) };
      case 'reviewSubstitute': {
        const [from = '', to = ''] = raw.slice(3, -3).split('~>');
        return { kind: 'substitute', line, range: n.range, text: short(`${from} → ${to}`) };
      }
      case 'reviewHighlight':
        return { kind: 'comment', line, range: n.range, text: short(raw.replace(/^\{==|==\}.*$/gs, '')), comment: n.comment };
      default:
        return { kind: 'comment', line, range: n.range, text: '', comment: raw.slice(3, -3) };
    }
  });
  // A comment right after highlighted text belongs to it.
  const merged: ReviewItem[] = [];
  for (const item of items) {
    const prev = merged[merged.length - 1];
    if (prev && item.kind === 'comment' && !item.text && prev.kind === 'comment' && prev.text && !prev.comment && prev.range.end === item.range.start) {
      merged[merged.length - 1] = { ...prev, comment: item.comment, range: { start: prev.range.start, end: item.range.end } };
    } else merged.push(item);
  }
  return merged;
}

/** The note with every suggestion applied (`accept`) or undone (`reject`) and comments removed. */
export function resolveReview(doc: YamdDocument, mode: 'accept' | 'reject'): string {
  let out = '';
  let last = 0;
  for (const n of topLevel(doc)) {
    const raw = doc.source.slice(n.range.start, n.range.end);
    let replacement = '';
    if (n.type === 'review') replacement = (n.kind === 'insert') === (mode === 'accept') ? raw.slice(3, -3) : '';
    else if (n.type === 'reviewSubstitute') replacement = raw.slice(3, -3).split('~>')[mode === 'accept' ? 1 : 0] ?? '';
    else if (n.type === 'reviewHighlight') replacement = /^\{==([\s\S]*?)==\}/.exec(raw)?.[1] ?? '';
    out += doc.source.slice(last, n.range.start) + replacement;
    last = n.range.end;
  }
  return out + doc.source.slice(last);
}
