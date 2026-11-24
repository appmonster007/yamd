/**
 * Widget edits work on the block as a one-container document (`:::kanban` … `:::`), where the board
 * edit logic already applies. This maps such an edit back to the note's own lines.
 */

/**
 * Applies an edit computed on the synthetic document to the note: only the lines that changed inside
 * the block are replaced, so the rest of the note and the cursor stay where they are.
 */
export function bodyEdit(synthetic: string, edit: { startLine: number; endLine: number; text: string }, bodyStartLine: number): { startLine: number; removeCount: number; lines: string[] } | null {
  const syn = synthetic.split('\n');
  const next = [...syn.slice(0, edit.startLine), ...edit.text.split('\n'), ...syn.slice(edit.endLine + 1)];
  // The container's own first and last lines aren't part of the block's body.
  if (next[0] !== syn[0] || next[next.length - 1] !== ':::') return null;
  const oldBody = syn.slice(1, -1);
  const newBody = next.slice(1, -1);
  let a = 0;
  while (a < oldBody.length && a < newBody.length && oldBody[a] === newBody[a]) a++;
  let b = 0;
  while (b < oldBody.length - a && b < newBody.length - a && oldBody[oldBody.length - 1 - b] === newBody[newBody.length - 1 - b]) b++;
  return { startLine: bodyStartLine + a, removeCount: oldBody.length - a - b, lines: newBody.slice(a, newBody.length - b) };
}

/** Applies the result of `bodyEdit` to a note's lines. */
export function applyBodyEdit(lines: string[], change: { startLine: number; removeCount: number; lines: string[] }): string[] {
  return [...lines.slice(0, change.startLine), ...change.lines, ...lines.slice(change.startLine + change.removeCount)];
}
