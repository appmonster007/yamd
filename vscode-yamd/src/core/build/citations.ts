/**
 * Citation links: `[@smith2020]` becomes `[(Smith, 2020)](#ref-smith2020 "cite")`, pointing at the
 * bibliography entry. The key stays in the link target and any locator in its title, so every later
 * Build can refresh the label (author-year or number) without losing either.
 */
import { Bibliography, parseCitation } from '../citations/bibtex';
import type { CitedKey } from '../citations/bibtex';
import { mapOutsideCode } from './refs';

const TOKEN = /\[(@[^\]\n]+)\](?!\()/g;
const LABEL = String.raw`((?:\\.|[^\]\n\\])*)`;
const LINK = new RegExp(String.raw`\[${LABEL}\]\(#ref-([^\s)]+) "cite(?:: ([^"]*))?"\)`, 'g');

/** Citation keys in the order they are first cited, in either form, skipping cross-reference ids. */
export function citedKeys(lines: string[], isTarget: (id: string) => boolean): string[] {
  const keys: string[] = [];
  mapOutsideCode(lines, (text) => {
    const found: { at: number; keys: string[] }[] = [];
    for (const m of text.matchAll(TOKEN)) found.push({ at: m.index ?? 0, keys: parseCitation(m[1] as string).map((c) => c.key) });
    for (const m of text.matchAll(LINK)) found.push({ at: m.index ?? 0, keys: [m[2] as string] });
    for (const f of found.sort((a, b) => a.at - b.at)) for (const k of f.keys) if (!isTarget(k) && !keys.includes(k)) keys.push(k);
    return text;
  });
  return keys;
}

const escapeLabel = (s: string) => s.replace(/[[\]]/g, '\\$&');

function link(bib: Bibliography, c: CitedKey): string {
  const locator = c.locator?.replace(/"/g, "'");
  return `[${escapeLabel(bib.cite([c]))}](#ref-${c.key} "cite${locator ? `: ${locator}` : ''}")`;
}

/**
 * Turns citation tokens into links and refreshes the labels of existing citation links. Tokens that
 * name a key missing from the bibliography are left as they are (Build warns about them).
 */
export function linkCitations(lines: string[], bib: Bibliography, order: string[], isTarget: (id: string) => boolean): string[] {
  // Numbers (IEEE) follow the order of first citation, so record it before any label is written.
  for (const k of order) bib.cite([{ key: k }]);
  return mapOutsideCode(lines, (text) =>
    text
      .replace(TOKEN, (whole, raw: string) => {
        const cited = parseCitation(raw);
        if (!cited.length || cited.some((c) => !bib.has(c.key) || isTarget(c.key))) return whole;
        return cited.map((c) => link(bib, c)).join(' ');
      })
      .replace(LINK, (whole, _label: string, key: string, locator: string | undefined) => (bib.has(key) ? link(bib, locator ? { key, locator } : { key }) : whole)),
  );
}
