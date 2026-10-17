import { Document, parseDocument } from 'yaml';
import { extractFrontMatter } from './frontmatter';

export interface PropertyEdit {
  /** Lines to replace, inclusive. `endLine` is `startLine - 1` for an insertion. */
  startLine: number;
  endLine: number;
  text: string;
}

/**
 * Sets (or with `undefined`, removes) a front matter key, keeping other keys, their order and
 * comments. Creates the front matter when the note has none.
 */
export function setProperty(source: string, key: string, value: unknown): PropertyEdit | null {
  const lines = source.split('\n').map((l) => l.replace(/\r$/, ''));
  const fm = extractFrontMatter(lines);
  if (!fm) {
    if (value === undefined) return null;
    const doc = new Document({ [key]: value });
    return { startLine: 0, endLine: -1, text: `---\n${doc.toString().trimEnd()}\n---` };
  }
  if (fm.error) return null;
  const doc = parseDocument(lines.slice(1, fm.endLine).join('\n'));
  if (value === undefined) doc.delete(key);
  else doc.set(key, value);
  const yaml = doc.toString().trimEnd();
  const body = yaml === '{}' || yaml === '' ? '' : `${yaml}\n`;
  return { startLine: 0, endLine: fm.endLine, text: `---\n${body}---` };
}
