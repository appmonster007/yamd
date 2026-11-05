import { fencedLines } from '../callouts';

export interface Heading {
  level: number;
  text: string;
  slug: string;
  line: number;
}

/** GitHub's anchor for a heading: lowercase, punctuation removed, each space a hyphen (what VS Code's Markdown links resolve to). */
export function githubSlug(text: string): string {
  return text.toLowerCase().replace(/[^\p{L}\p{N}\p{M} _-]/gu, '').replace(/ /g, '-');
}

/** The note's headings with GitHub-style anchors, skipping code, front matter and setext headings. */
export function headings(lines: string[]): Heading[] {
  const fenced = fencedLines(lines);
  let frontEnd = -1;
  if (lines[0]?.trim() === '---') frontEnd = lines.findIndex((l, i) => i > 0 && l.trim() === '---');
  const used = new Map<string, number>();
  const unique = (base: string) => {
    let slug = base;
    let n = used.get(base) ?? -1;
    while (used.has(slug)) slug = `${base}-${++n}`;
    used.set(base, n);
    used.set(slug, 0);
    return slug;
  };
  const out: Heading[] = [];
  for (let i = 0; i < lines.length; i++) {
    if (fenced.has(i) || i <= frontEnd) continue;
    const m = /^ {0,3}(#{1,6})[ \t]+(.+?)[ \t]*#*[ \t]*$/.exec(lines[i] ?? '');
    if (!m) continue;
    const text = (m[2] as string).replace(/\s\^[\w-]+$/, '').replace(/\[([^\]]*)\]\([^)]*\)/g, '$1').replace(/[*_`~]/g, '').trim();
    if (!text) continue;
    out.push({ level: (m[1] as string).length, text, slug: unique(githubSlug(text)), line: i });
  }
  return out;
}

/** The list for a `<!-- yamd:toc depth=N -->` region: headings down to level `depth` (default 3). */
export function tocLines(lines: string[], attrs: string): string[] {
  const depth = Math.min(6, Math.max(1, Number(/\bdepth=(\d+)/.exec(attrs)?.[1] ?? 3)));
  const list = headings(lines).filter((h) => h.level <= depth);
  const top = Math.min(...list.map((h) => h.level), 6);
  return list.map((h) => `${'  '.repeat(h.level - top)}- [${h.text}](#${h.slug})`);
}
