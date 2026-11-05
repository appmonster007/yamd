import type { Database } from 'sql.js';

export interface TableInfo {
  table: string;
  columns: { name: string; type: string }[];
}

/** The tables of a loaded database and their columns. */
export function describeDb(db: Database): TableInfo[] {
  const tables = db.exec("SELECT name FROM sqlite_master WHERE type IN ('table','view') AND name NOT LIKE 'sqlite_%' ORDER BY name")[0]?.values.flat() ?? [];
  return tables.map((t) => {
    const table = String(t);
    const info = db.exec(`PRAGMA table_info("${table.replace(/"/g, '""')}")`)[0]?.values ?? [];
    return { table, columns: info.map((r) => ({ name: String(r[1]), type: String(r[2] ?? '') })) };
  });
}
