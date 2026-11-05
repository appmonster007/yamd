/**
 * Pure fence logic for `:::name ... :::` container directives and `::name` leaf directives (§3.10),
 * kept free of `vscode` so it can be unit-tested. Line numbers are 0-based throughout.
 */
import { KNOWN_CONTAINERS, KNOWN_LEAVES } from '../core/parser';

export { KNOWN_CONTAINERS, KNOWN_LEAVES };

const OPEN = /^:::(\S+)/;
const CLOSE = /^:::\s*$/;

export interface Fence {
  openLine: number;
  closeLine: number;
  name: string;
}

/** Every closed container fence in the document, in open-line order. Unclosed fences are omitted. */
export function allFences(lines: string[]): Fence[] {
  const stack: { openLine: number; name: string }[] = [];
  const out: Fence[] = [];
  for (let i = 0; i < lines.length; i++) {
    const text = lines[i] ?? '';
    if (CLOSE.test(text) && stack.length) {
      const top = stack.pop()!;
      out.push({ openLine: top.openLine, closeLine: i, name: top.name });
      continue;
    }
    const open = OPEN.exec(text);
    if (open) stack.push({ openLine: i, name: open[1] ?? '' });
  }
  return out.sort((a, b) => a.openLine - b.openLine);
}

/** The innermost closed fence that encloses `line`, or undefined if none does. */
export function findEnclosingFence(lines: string[], line: number): Fence | undefined {
  let best: Fence | undefined;
  for (const fence of allFences(lines)) {
    if (fence.openLine <= line && line <= fence.closeLine && (!best || fence.openLine >= best.openLine)) best = fence;
  }
  return best;
}

/** The nearest fence still open at or above `line` (no matching `:::` yet), for "Close Current Block". */
export function findUnclosedFence(lines: string[], line: number): { openLine: number; name: string } | undefined {
  const stack: { openLine: number; name: string }[] = [];
  for (let i = 0; i <= line && i < lines.length; i++) {
    const text = lines[i] ?? '';
    if (CLOSE.test(text) && stack.length) {
      stack.pop();
      continue;
    }
    const open = OPEN.exec(text);
    if (open) stack.push({ openLine: i, name: open[1] ?? '' });
  }
  return stack[stack.length - 1];
}

/** Given the line of an open or close fence, the line of its match, or undefined. */
export function matchingFenceLine(lines: string[], line: number): number | undefined {
  const text = lines[line] ?? '';
  if (OPEN.exec(text) && !CLOSE.test(text)) {
    let depth = 1;
    for (let i = line + 1; i < lines.length; i++) {
      const t = lines[i] ?? '';
      if (CLOSE.test(t)) {
        depth--;
        if (depth === 0) return i;
      } else if (OPEN.exec(t)) depth++;
    }
    return undefined;
  }
  if (CLOSE.test(text)) {
    let depth = 1;
    for (let i = line - 1; i >= 0; i--) {
      const t = lines[i] ?? '';
      if (OPEN.exec(t) && !CLOSE.test(t)) {
        depth--;
        if (depth === 0) return i;
      } else if (CLOSE.test(t)) depth++;
    }
    return undefined;
  }
  return undefined;
}

export interface BlockDirective {
  name: string;
  isContainer: boolean;
}

/** Every directive name known to the parser, for the "Insert Block" picker. */
export function knownDirectives(): BlockDirective[] {
  return [
    ...[...KNOWN_CONTAINERS].sort().map((name) => ({ name, isContainer: true })),
    ...[...KNOWN_LEAVES].sort().map((name) => ({ name, isContainer: false })),
  ];
}

/** The text to insert for a new block of `name`. `cursorOffset` is where the cursor should land. */
export function blockSnippet(d: BlockDirective): { text: string; cursorOffset: number } {
  if (d.isContainer) {
    const text = `:::${d.name}\n\n:::`;
    return { text, cursorOffset: d.name.length + 4 };
  }
  const text = `::${d.name}`;
  return { text, cursorOffset: text.length };
}
