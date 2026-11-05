/**
 * Lets the older block parser and renderer read a 1.2.0 note. Widget fences become the containers
 * the engine knows (` ```kanban` → `:::kanban`), line for line, so line numbers stay valid.
 */
import { scanWidgets } from '../widgets/fences';

const BOARDS = new Set(['kanban', 'calendar', 'timeline', 'gallery']);

export function toInternal(text: string): string {
  const lines = text.split('\n');
  for (const w of scanWidgets(lines)) {
    if (!BOARDS.has(w.type) || !w.closed) continue;
    lines[w.startLine] = `:::${w.type}`;
    lines[w.endLine] = ':::';
  }
  return lines.join('\n');
}
