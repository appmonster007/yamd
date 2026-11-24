/**
 * `YAMD: Build`: refreshes everything the extension generates in a note. It only touches reference
 * links and the content between `<!-- yamd:… -->` markers, and a second run changes nothing.
 */
import { extractFrontMatter } from '../markdown/frontmatter';
import type { BibEntry } from '../citations/bibtex';
import { Bibliography } from '../citations/bibtex';
import { bibliographyLines, citationStyle } from './bibliography';
import { citedKeys, linkCitations } from './citations';
import { findRegions, writeRegion } from './markers';
import { collectTargets, resolveReferences } from './refs';
import { tocLines } from './toc';

interface BuildContext {
  /** Parsed `.bib` entries, when the note names a bibliography file that could be read. */
  entries?: BibEntry[];
  /** Turn `[@key]` into links to the bibliography (default true). */
  linkCitations?: boolean;
}

interface BuildResult {
  lines: string[];
  warnings: string[];
}

/** The `bibliography` file name and `citation-style` a note's front matter names. */
export function bibSettings(lines: string[]): { file?: string; style: ReturnType<typeof citationStyle> } {
  const data = extractFrontMatter(lines)?.data ?? {};
  const file = typeof data['bibliography'] === 'string' && data['bibliography'].trim() ? data['bibliography'].trim() : undefined;
  return { ...(file ? { file } : {}), style: citationStyle(data['citation-style']) };
}

export function buildNote(input: string[], ctx: BuildContext = {}): BuildResult {
  const warnings: string[] = [];
  let lines = resolveReferences(input, collectTargets(input));

  if (ctx.entries && ctx.linkCitations !== false) {
    const targets = new Set(collectTargets(lines).map((t) => t.id));
    const bib = new Bibliography(ctx.entries, bibSettings(lines).style);
    lines = linkCitations(lines, bib, citedKeys(lines, (id) => targets.has(id)), (id) => targets.has(id));
  }

  for (const region of findRegions(lines)) {
    if (region.name === 'toc') lines = writeRegion(lines, 'toc', tocLines(lines, region.attrs));
  }

  if (findRegions(lines).some((r) => r.name === 'bibliography')) {
    const { style } = bibSettings(lines);
    if (!ctx.entries) {
      warnings.push('The note has a bibliography region but no readable "bibliography:" file in its front matter.');
    } else {
      const targets = new Set(collectTargets(lines).map((t) => t.id));
      const result = bibliographyLines(citedKeys(lines, (id) => targets.has(id)), ctx.entries, style);
      for (const k of result.missing) warnings.push(`Citation key "${k}" is not in the bibliography file.`);
      lines = writeRegion(lines, 'bibliography', result.lines);
    }
  }
  return { lines, warnings };
}
