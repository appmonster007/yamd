/**
 * Folder scope for databases: a document can use databases in its own folder and subfolders only.
 * Every database read goes through `resolveDatabase`.
 */
import * as path from 'node:path';

export const DB_EXTENSIONS = /\.(ydb|sqlite3?|db)$/i;
export const SQLITE_EXTENSIONS = /\.(sqlite3?|db)$/i;

export interface FileAccess {
  exists(p: string): boolean;
  /** Real path after following symlinks. */
  realpath(p: string): string;
}

export interface DatabaseRef {
  /** Absolute path of the database file. */
  file: string;
  /** Table name for SQLite (`file#table`). */
  table?: string;
  kind: 'ydb' | 'sqlite';
  /** The reference as written in the document, for messages. */
  written: string;
}

export type ResolveResult = { ok: true; ref: DatabaseRef } | { ok: false; code: 'Y850' | 'Y951'; message: string };

/** Reads the `databases:` front matter map of aliases. */
export function databaseAliases(frontMatter: Record<string, unknown> | undefined): Record<string, string> {
  const raw = frontMatter?.['databases'];
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return {};
  return Object.fromEntries(Object.entries(raw).filter(([, v]) => typeof v === 'string')) as Record<string, string>;
}

/** Checks that a path is inside a folder, using real paths. */
export function inside(folder: string, target: string, fs: FileAccess): boolean {
  const dir = fs.realpath(folder);
  const real = fs.realpath(target);
  return real === dir || real.startsWith(dir.endsWith(path.sep) ? dir : dir + path.sep);
}

/**
 * Resolves an alias or path from a document at `docPath`. Parent segments, absolute paths and
 * files that (after symlinks) are outside the document's folder are refused with Y951.
 */
export function resolveDatabase(docPath: string, written: string, aliases: Record<string, string>, fs: FileAccess): ResolveResult {
  const target = aliases[written] ?? written;
  const hash = target.indexOf('#');
  const file = (hash === -1 ? target : target.slice(0, hash)).trim();
  const table = hash === -1 ? undefined : target.slice(hash + 1).trim() || undefined;
  if (path.isAbsolute(file) || /^[a-z]:/i.test(file) || file.startsWith('~')) {
    return { ok: false, code: 'Y951', message: `"${target}" is an absolute path. Databases must be in this note's folder or a subfolder.` };
  }
  if (file.split(/[\\/]/).includes('..')) {
    return { ok: false, code: 'Y951', message: `"${target}" is outside this note's folder. Databases must be in its folder or a subfolder.` };
  }
  const dir = path.dirname(docPath);
  const candidates = DB_EXTENSIONS.test(file) ? [file] : [`${file}.ydb`, `${file}.sqlite`, `${file}.sqlite3`, `${file}.db`];
  const found = candidates.map((c) => path.resolve(dir, c)).find((c) => fs.exists(c));
  if (!found) {
    const known = Object.keys(aliases);
    return {
      ok: false,
      code: 'Y850',
      message: `No database "${written}"${known.length ? `. Aliases in this note: ${known.join(', ')}` : ''}. Add it under "databases:" in the front matter or use a path.`,
    };
  }
  if (!inside(dir, found, fs)) {
    return { ok: false, code: 'Y951', message: `"${target}" points outside this note's folder (through a link), so it can't be used.` };
  }
  const kind = SQLITE_EXTENSIONS.test(found) ? 'sqlite' : 'ydb';
  return { ok: true, ref: { file: found, table, kind, written } };
}

/** The table name a `.ydb` file is queried as: its file name without the extension. */
export function ydbTableName(file: string): string {
  return path.basename(file).replace(/\.ydb$/i, '');
}
