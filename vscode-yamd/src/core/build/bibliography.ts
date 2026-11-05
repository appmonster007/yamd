import { mapOutsideCode } from './refs';
import { Bibliography, citationStyle, formatEntry, parseCitation } from '../citations/bibtex';
import type { BibEntry, CitationStyle } from '../citations/bibtex';

/** Citation keys in the order they are first cited, skipping cross-reference ids. */
export function citedKeys(lines: string[], isTarget: (id: string) => boolean): string[] {
  const keys: string[] = [];
  mapOutsideCode(lines, (text) => {
    for (const m of text.matchAll(/\[(@[^\]\n]+)\](?!\()/g)) {
      for (const c of parseCitation((m[1] as string).replace(/^@/, '@'))) {
        if (!isTarget(c.key) && !keys.includes(c.key)) keys.push(c.key);
      }
    }
    return text;
  });
  return keys;
}

interface BibliographyResult {
  lines: string[];
  /** Cited keys that are not in the `.bib` file. */
  missing: string[];
}

/** The reference list for a `<!-- yamd:bibliography -->` region, as Markdown. */
export function bibliographyLines(cited: string[], entries: BibEntry[], style: CitationStyle): BibliographyResult {
  const byKey = new Map(entries.map((e) => [e.key, e]));
  const missing = cited.filter((k) => !byKey.has(k));
  const used = cited.map((k) => byKey.get(k)).filter((e): e is BibEntry => !!e);
  const bib = new Bibliography(entries, style);
  for (const e of used) bib.cite([{ key: e.key }]);
  const text = (e: BibEntry) => formatEntry(e, style).replace(/<[^>]+>/g, '').toLowerCase();
  const ordered = style === 'ieee' ? used : [...used].sort((a, b) => text(a).localeCompare(text(b)));
  const lines = ordered.map((e, i) => `${style === 'ieee' ? `${i + 1}.` : '-'} <a id="ref-${e.key}"></a>${formatEntry(e, style)}`);
  return { lines, missing };
}

export { citationStyle };
