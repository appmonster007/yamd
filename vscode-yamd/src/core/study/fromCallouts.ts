/**
 * "Study this note": turns the definitions, theorems and questions in a note into flashcards,
 * written as `> [!card]` entries inside a generated `cards` region that Build can rewrite.
 */
import { scanCallouts, typeLabel } from '../build/callouts';

const SOURCES = new Set(['definition', 'theorem', 'lemma', 'question']);
const stripQuote = (line: string) => line.replace(/^[ \t]*>[ \t]?/, '');

/** The card text for every study callout outside the generated region itself. */
export function cardsFromCallouts(lines: string[]): string[] {
  const out: string[] = [];
  for (const c of scanCallouts(lines)) {
    if (!SOURCES.has(c.type) || !c.title.trim()) continue;
    const body = lines.slice(c.startLine + 1, c.endLine + 1).map(stripQuote).filter((l) => l.trim() !== '');
    if (!body.length) continue;
    const front = c.type === 'question' ? c.title.trim() : `${typeLabel(c.type)}: ${c.title.trim()}`;
    if (out.length) out.push('');
    out.push(`> [!card] ${front.replace(/\s*\^[\w-]+$/, '')}`, ...body.map((l) => `> ${l}`));
  }
  return out;
}
