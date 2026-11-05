/**
 * Flashcards written as callouts: `> [!card] Question` with the answer in the body. A card is
 * identified by a hash of its question (or an explicit `^id`), so editing the answer keeps its schedule.
 */
import { scanCallouts } from '../callouts';
import { extractFrontMatter } from '../frontmatter';
import { hashText } from '../kanban';
import type { Card } from './cards';

const stripQuote = (line: string) => line.replace(/^[ \t]*>[ \t]?/, '');

export function extractCardsMd(text: string, path: string): Card[] {
  const lines = text.split('\n');
  const course = extractFrontMatter(lines)?.data['course'];
  const out: Card[] = [];
  for (const c of scanCallouts(lines)) {
    if (c.type !== 'card') continue;
    const front = c.title.trim();
    if (!front) continue;
    const back = lines.slice(c.startLine + 1, c.endLine + 1).map(stripQuote).join('\n').trim();
    out.push({
      id: c.id ?? `c${hashText(front)}`,
      kind: 'qa',
      front,
      back,
      line: c.startLine,
      path,
      ...(typeof course === 'string' && course.trim() ? { course: course.trim() } : {}),
    });
  }
  return out;
}
