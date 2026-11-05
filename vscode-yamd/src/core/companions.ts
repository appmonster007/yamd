/** The companion extensions YAMD installs with it, and which one opens a given data file. */
export interface Companion {
  id: string;
  name: string;
}

export const COMPANIONS = {
  foam: { id: 'foam.foam-vscode', name: 'Foam' },
  sqlite: { id: 'yy0931.vscode-sqlite3-editor', name: 'SQLite3 Editor' },
  csv: { id: 'janisdd.vscode-edit-csv', name: 'Edit CSV' },
  markdown: { id: 'yzhang.markdown-all-in-one', name: 'Markdown All in One' },
} satisfies Record<string, Companion>;

type DataKind = 'sqlite' | 'csv' | 'json';

export function dataKind(file: string): DataKind | undefined {
  if (/\.(sqlite3?|db3?|sdb|s3db)$/i.test(file)) return 'sqlite';
  if (/\.csv$/i.test(file)) return 'csv';
  if (/\.json$/i.test(file)) return 'json';
  return undefined;
}

/** The companion that edits a kind of data file; JSON opens in VS Code's own editor. */
export function companionFor(kind: DataKind): Companion | undefined {
  return kind === 'sqlite' ? COMPANIONS.sqlite : kind === 'csv' ? COMPANIONS.csv : undefined;
}
