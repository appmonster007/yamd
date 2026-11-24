/**
 * Review marks are plain HTML: `<ins>added</ins>` and `<del>removed</del>`. Accepting keeps added
 * text and drops removed text; rejecting does the opposite. Marks inside code are left alone.
 */
import { scanFences } from '../widgets/fences';

export type ReviewMode = 'accept' | 'reject';

export interface ReviewSpan {
  kind: 'ins' | 'del';
  start: number;
  end: number;
  inner: string;
}

const SPAN = /<(ins|del)\b[^>]*>([\s\S]*?)<\/\1\s*>/gi;

/** Offset ranges of fenced code blocks and inline code, where marks don't count. */
function protectedRanges(text: string): [number, number][] {
  const lines = text.split('\n');
  const starts: number[] = [];
  let offset = 0;
  for (const l of lines) {
    starts.push(offset);
    offset += l.length + 1;
  }
  const ranges: [number, number][] = scanFences(lines).map((f) => [starts[f.startLine] ?? 0, (starts[f.endLine] ?? 0) + (lines[f.endLine]?.length ?? 0)]);
  for (const m of text.matchAll(/(`+)[^`\n]*?\1/g)) ranges.push([m.index ?? 0, (m.index ?? 0) + m[0].length]);
  return ranges;
}

export function findReviewSpans(text: string): ReviewSpan[] {
  const skip = protectedRanges(text);
  const out: ReviewSpan[] = [];
  for (const m of text.matchAll(SPAN)) {
    const start = m.index ?? 0;
    if (skip.some(([a, b]) => start >= a && start <= b)) continue;
    out.push({ kind: (m[1] as string).toLowerCase() as 'ins' | 'del', start, end: start + m[0].length, inner: m[2] as string });
  }
  return out;
}

const replacement = (s: ReviewSpan, mode: ReviewMode) => ((s.kind === 'ins') === (mode === 'accept') ? s.inner : '');

/** The text with every span (or those `only` accepts) accepted or rejected. */
export function resolveReview(text: string, mode: ReviewMode, only?: (s: ReviewSpan) => boolean): string {
  let out = '';
  let last = 0;
  for (const s of findReviewSpans(text)) {
    if (only && !only(s)) continue;
    out += text.slice(last, s.start) + replacement(s, mode);
    last = s.end;
  }
  return out + text.slice(last);
}

/** The span a cursor offset is inside or touching, if any. */
export function spanAt(text: string, offset: number): ReviewSpan | undefined {
  return findReviewSpans(text).find((s) => offset >= s.start && offset <= s.end);
}

export function countReview(text: string): { ins: number; del: number } {
  const spans = findReviewSpans(text);
  return { ins: spans.filter((s) => s.kind === 'ins').length, del: spans.filter((s) => s.kind === 'del').length };
}
