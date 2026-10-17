import { posix } from 'node:path';
import type { NoteStore } from '../notes';
import type { NotesTables } from './engine';

/**
 * The notes tables for a document in folder `dir` (POSIX path): every note in that folder and its
 * subfolders, with paths relative to it. `times` gives a note's creation and modification times.
 */
export function buildNotesTables(
  store: NoteStore,
  dir: string,
  times: (path: string) => { created: string | null; modified: string | null } = () => ({ created: null, modified: null }),
): NotesTables {
  const tables: NotesTables = { notes: [], tags: [], links: [], tasks: [] };
  const prefix = dir === '' || dir === '.' ? '' : `${dir.replace(/\/$/, '')}/`;
  for (const p of store.paths()) {
    if (!p.startsWith(prefix)) continue;
    const s = store.summary(p);
    if (!s) continue;
    const rel = p.slice(prefix.length);
    const props: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(s.properties)) props[k] = v instanceof Date ? v.toISOString().slice(0, 10) : v;
    const folder = posix.dirname(rel);
    tables.notes.push({ ...props, path: rel, title: s.title, folder: folder === '.' ? '' : folder, ...times(p), properties: JSON.stringify(props) });
    for (const t of s.tags) tables.tags.push({ path: rel, tag: t });
    for (const l of s.links) {
      const r = store.resolveLink(l, p);
      tables.links.push({ source: rel, target: r ? (r.path.startsWith(prefix) ? r.path.slice(prefix.length) : r.path) : l.file });
    }
    for (const t of s.tasks) tables.tasks.push({ path: rel, line: t.line + 1, text: t.text, done: t.done ? 1 : 0 });
  }
  return tables;
}
