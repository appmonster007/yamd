/**
 * Unlinked mentions: places in other notes that name this note (by file name, title or alias) in plain
 * text without linking to it. Pure; the sidebar lists them and offers to turn each into a `[[wikilink]]`.
 */
import { extractFrontMatter } from '../markdown/frontmatter';
import { fencedLines } from '../build/callouts';

export interface Mention {
  path: string;
  line: number;
  col: number;
  length: number;
  /** The text as written in the note. */
  text: string;
  /** The line, trimmed, for the list. */
  snippet: string;
}

export interface NoteNames {
  /** What a link points at: the file name without `.md`. */
  target: string;
  /** Everything a note might be called in running text. */
  names: string[];
}

const MIN_LENGTH = 3;

/** The names a note answers to: its file name (with `-` and `_` read as spaces), front-matter title and aliases. */
export function namesOf(path: string, lines: string[]): NoteNames {
  const target = (path.split(/[\\/]/).pop() ?? path).replace(/\.md$/i, '');
  const data = extractFrontMatter(lines)?.data ?? {};
  const aliases = data['aliases'] ?? data['alias'];
  const raw = [target, target.replace(/[-_]+/g, ' '), ...(typeof data['title'] === 'string' ? [data['title']] : []), ...(Array.isArray(aliases) ? aliases : typeof aliases === 'string' ? [aliases] : [])];
  const seen = new Set<string>();
  const names = raw.filter((n): n is string => typeof n === 'string').map((n) => n.trim()).filter((n) => n.length >= MIN_LENGTH && !seen.has(n.toLowerCase()) && seen.add(n.toLowerCase()));
  return { target, names: names.sort((a, b) => b.length - a.length) };
}

const escapeRe = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

/** Spans of a line that must not be matched: wikilinks, Markdown links, inline code, URLs, HTML tags. */
function protectedSpans(line: string): [number, number][] {
  const spans: [number, number][] = [];
  for (const re of [/\[\[[^\]]*\]\]/g, /\[[^\]]*\]\([^)]*\)/g, /`[^`]*`/g, /https?:\/\/\S+/g, /<[^>]+>/g, /^\s*#{1,6}\s.*$/g]) {
    for (const m of line.matchAll(re)) spans.push([m.index ?? 0, (m.index ?? 0) + m[0].length]);
  }
  return spans;
}

/** Mentions of `names` in `notes`, outside the note itself and outside links and code. */
export function findMentions(self: NoteNames, notes: { path: string; text: string }[], selfPath: string, limit = 200): Mention[] {
  if (!self.names.length) return [];
  const re = new RegExp(`(?<![\\p{L}\\p{N}_])(?:${self.names.map(escapeRe).join('|')})(?![\\p{L}\\p{N}_])`, 'giu');
  const out: Mention[] = [];
  for (const note of notes) {
    if (note.path === selfPath) continue;
    const lines = note.text.split('\n');
    const fenced = fencedLines(lines);
    const fm = extractFrontMatter(lines);
    lines.forEach((line, i) => {
      if (out.length >= limit || fenced.has(i) || (fm && i <= fm.endLine)) return;
      const spans = protectedSpans(line);
      for (const m of line.matchAll(re)) {
        const col = m.index ?? 0;
        if (spans.some(([a, b]) => col < b && col + m[0].length > a)) continue;
        out.push({ path: note.path, line: i, col, length: m[0].length, text: m[0], snippet: line.trim().slice(0, 120) });
        if (out.length >= limit) break;
      }
    });
  }
  return out;
}

/** The wikilink that replaces a mention: `[[target]]`, or `[[target|as written]]` when the words differ. */
export function wikilinkFor(target: string, text: string): string {
  return text === target ? `[[${target}]]` : `[[${target}|${text}]]`;
}
