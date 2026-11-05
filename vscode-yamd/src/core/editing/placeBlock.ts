import { scanFences } from '../widgets/fences';

/** Where in a note a block of text goes, and what it replaces. */
export interface TextEditAt {
  /** Where the change starts, as an offset into the note. */
  offset: number;
  /** How many characters it replaces. */
  remove: number;
  insert: string;
}

/**
 * Puts `link` (a line, or a whole block) on lines of its own, blank lines around it, at `offset`: on the blank line the cursor
 * is on, before the line it starts, or after the line it is inside (and after a code block that
 * contains it, so a fence is never split).
 */
export function placeBlock(text: string, offset: number, link: string): TextEditAt {
  const lines = text.split('\n');
  const starts: number[] = [];
  let at = 0;
  for (const l of lines) {
    starts.push(at);
    at += l.length + 1;
  }
  const lineOf = (o: number) => {
    let i = starts.length - 1;
    while (i > 0 && (starts[i] as number) > o) i--;
    return i;
  };
  let line = lineOf(Math.max(0, Math.min(offset, text.length)));
  let column = Math.max(0, Math.min(offset, text.length)) - (starts[line] as number);

  const fence = scanFences(lines).find((f) => f.startLine <= line && line <= f.endLine);
  if (fence) {
    line = fence.endLine;
    column = (lines[line] as string).length;
  }
  const current = lines[line] as string;
  const prevBlank = line === 0 || (lines[line - 1] as string).trim() === '';
  const nextBlank = line + 1 >= lines.length || (lines[line + 1] as string).trim() === '';
  const lineStart = starts[line] as number;

  if (current.trim() === '') {
    return { offset: lineStart, remove: current.length, insert: `${prevBlank ? '' : '\n'}${link}${nextBlank ? '' : '\n'}` };
  }
  if (column === 0 && !fence) {
    return { offset: lineStart, remove: 0, insert: `${prevBlank ? '' : '\n'}${link}\n\n` };
  }
  return { offset: lineStart + current.length, remove: 0, insert: `\n\n${link}${nextBlank ? '' : '\n'}` };
}
