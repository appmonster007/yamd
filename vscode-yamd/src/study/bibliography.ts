import { readFileSync, statSync } from 'node:fs';
import * as path from 'node:path';
import { Bibliography, citationStyle, parseBibtex } from '../core/study/bibtex';
import type { BibEntry } from '../core/study/bibtex';
import type { YamdDocument } from '../core/types';

const cache = new Map<string, { mtime: number; entries: BibEntry[] }>();

/** The `.bib` file a note names in its `bibliography` front matter key, relative to the note or the workspace. */
export function bibliographyPath(doc: YamdDocument, notePath: string, root?: string): string | undefined {
  const name = doc.frontMatter?.data['bibliography'];
  if (typeof name !== 'string' || !name.trim()) return undefined;
  const candidates = [path.resolve(path.dirname(notePath), name), ...(root ? [path.resolve(root, name)] : [])];
  return candidates.find((c) => {
    try {
      return statSync(c).isFile();
    } catch {
      return false;
    }
  });
}

export function readBib(file: string): BibEntry[] {
  try {
    const mtime = statSync(file).mtimeMs;
    const hit = cache.get(file);
    if (hit?.mtime === mtime) return hit.entries;
    const entries = parseBibtex(readFileSync(file, 'utf8'));
    cache.set(file, { mtime, entries });
    return entries;
  } catch {
    return [];
  }
}

/** A fresh `Bibliography` for one render (it records the order of citations as it goes), or undefined if the note has none. */
export function bibliographyFor(doc: YamdDocument, notePath: string, root?: string): Bibliography | undefined {
  const file = bibliographyPath(doc, notePath, root);
  if (!file) return undefined;
  return new Bibliography(readBib(file), citationStyle(doc.frontMatter?.data['citation-style']));
}
