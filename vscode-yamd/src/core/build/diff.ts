/** The smallest run of lines that differs between two versions of a note. */
export interface LineDiff {
  start: number;
  removeCount: number;
  lines: string[];
}

export function diffLines(before: string[], after: string[]): LineDiff | null {
  let a = 0;
  while (a < before.length && a < after.length && before[a] === after[a]) a++;
  if (a === before.length && a === after.length) return null;
  let b = 0;
  while (b < before.length - a && b < after.length - a && before[before.length - 1 - b] === after[after.length - 1 - b]) b++;
  return { start: a, removeCount: before.length - a - b, lines: after.slice(a, after.length - b) };
}
