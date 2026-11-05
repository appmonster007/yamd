/**
 * The query engine: loads a CSV, JSON or SQLite file into an in-memory sql.js database and runs one
 * read-only statement. CSV and JSON become a table named after the file; a SQLite file is read from
 * a copy of its bytes, so the file itself can never change.
 */
import type { Database, SqlJsStatic, SqlValue } from 'sql.js';
import { parseCsv } from './csv';

export type Cell = string | number | null;

export interface QueryResult {
  columns: string[];
  rows: Cell[][];
  /** Rows the query produced in total (counted up to a limit). */
  total: number;
}

export interface QueryProblem {
  code: 'Q001' | 'Q002' | 'Q003' | 'Q004';
  message: string;
}

const COUNT_LIMIT = 100_000;
export const MAX_ROWS = 500;

const quote = (name: string) => `"${name.replace(/"/g, '""')}"`;

/** SQL with strings, quoted names and comments blanked out, for checking its keywords. */
export function stripSql(sql: string): string {
  return sql.replace(/'(?:[^']|'')*'|"(?:[^"]|"")*"|`[^`]*`|\[[^\]]*\]|--[^\n]*|\/\*[\s\S]*?(?:\*\/|$)/g, ' ');
}

const BLOCKED = /\b(ATTACH|DETACH|PRAGMA|VACUUM|LOAD_EXTENSION|INSERT|UPDATE|DELETE|REPLACE|CREATE|DROP|ALTER|REINDEX|ANALYZE|BEGIN|COMMIT|ROLLBACK|SAVEPOINT|RELEASE)\b/i;
const WRITE_OPCODES = new Set(['OpenWrite', 'Insert', 'Delete', 'Destroy', 'Clear', 'CreateBtree', 'ParseSchema', 'DropTable', 'DropIndex', 'DropTrigger', 'IdxInsert', 'IdxDelete', 'SorterInsert']);

/** Why `sql` can't run as a note query, or null when it is a single read-only statement. */
export function readOnlyProblem(db: Database, sql: string): QueryProblem | null {
  const stripped = stripSql(sql);
  const blocked = BLOCKED.exec(stripped);
  if (blocked) return { code: 'Q001', message: `${blocked[1]?.toUpperCase()} isn't allowed in a note query. Only SELECT runs here; use a SQL client for changes.` };
  if (/;\s*\S/.test(stripped)) return { code: 'Q001', message: 'Only one statement can run in a note query.' };
  let count = 0;
  try {
    for (const stmt of db.iterateStatements(sql)) {
      count++;
      stmt.free();
    }
  } catch (err) {
    return { code: 'Q002', message: `SQL error: ${(err as Error).message}` };
  }
  if (count === 0) return { code: 'Q002', message: 'The query is empty.' };
  try {
    const plan = db.exec(`EXPLAIN ${sql.trim().replace(/;\s*$/, '')}`);
    const col = plan[0]?.columns.indexOf('opcode') ?? -1;
    for (const row of plan[0]?.values ?? []) {
      if (WRITE_OPCODES.has(String(row[col]))) return { code: 'Q001', message: 'Only read-only queries can run in a note.' };
    }
  } catch (err) {
    return { code: 'Q002', message: `SQL error: ${(err as Error).message}` };
  }
  return null;
}

export function runQuery(db: Database, sql: string, maxRows = MAX_ROWS): QueryResult {
  const stmt = db.prepare(sql);
  try {
    const columns = stmt.getColumnNames();
    const rows: Cell[][] = [];
    let total = 0;
    while (stmt.step()) {
      total++;
      if (rows.length < maxRows) rows.push(stmt.get().map(toCell));
      else if (total >= COUNT_LIMIT) break;
    }
    return { columns, rows, total };
  } finally {
    stmt.free();
  }
}

function toCell(v: SqlValue): Cell {
  if (v instanceof Uint8Array) return `<${v.length} bytes>`;
  return v;
}

/** The table name for a data file: its base name with anything but letters, digits and `_` replaced. */
export function tableNameFor(file: string): string {
  const base = (file.split(/[\\/]/).pop() ?? 'data').replace(/\.[^.]*$/, '');
  const name = base.replace(/[^A-Za-z0-9_]/g, '_');
  return /^\d/.test(name) || name === '' ? `t_${name}` : name;
}

type Column = { name: string; type: 'INTEGER' | 'REAL' | 'TEXT' };

function inferColumns(header: string[], rows: string[][]): Column[] {
  const seen = new Set<string>();
  return header.map((raw, i) => {
    let name = raw.trim() || `column${i + 1}`;
    while (seen.has(name.toLowerCase())) name += '_';
    seen.add(name.toLowerCase());
    const values = rows.map((r) => r[i] ?? '').filter((v) => v !== '');
    const type = values.length && values.every((v) => /^-?\d+$/.test(v)) ? 'INTEGER' : values.length && values.every((v) => /^-?\d*\.?\d+(e[+-]?\d+)?$/i.test(v)) ? 'REAL' : 'TEXT';
    return { name, type };
  });
}

function loadTable(db: Database, table: string, header: string[], rows: string[][]): void {
  const cols = inferColumns(header, rows);
  db.run(`CREATE TABLE ${quote(table)} (${cols.map((c) => `${quote(c.name)} ${c.type}`).join(', ')})`);
  const stmt = db.prepare(`INSERT INTO ${quote(table)} VALUES (${cols.map(() => '?').join(', ')})`);
  try {
    for (const r of rows) {
      stmt.run(cols.map((c, i): SqlValue => {
        const v = r[i];
        if (v === undefined || v === '') return null;
        return c.type === 'TEXT' ? v : Number(v);
      }));
    }
  } finally {
    stmt.free();
  }
}

export function loadCsv(SQL: SqlJsStatic, file: string, text: string): Database {
  const db = new SQL.Database();
  const [header = [], ...rows] = parseCsv(text);
  loadTable(db, tableNameFor(file), header, rows);
  return db;
}

export function loadJson(SQL: SqlJsStatic, file: string, text: string): Database {
  const db = new SQL.Database();
  let data: unknown = JSON.parse(text);
  if (data && typeof data === 'object' && !Array.isArray(data)) {
    // `{ "rows": [...] }` or any object holding one array of records.
    const arrays = Object.values(data).filter(Array.isArray);
    if (arrays.length === 1) data = arrays[0];
  }
  if (!Array.isArray(data)) throw new Error('JSON data must be an array of objects.');
  const keys: string[] = [];
  for (const r of data) if (r && typeof r === 'object') for (const k of Object.keys(r)) if (!keys.includes(k)) keys.push(k);
  const rows = data.map((r) => keys.map((k) => {
    const v = (r as Record<string, unknown>)?.[k];
    return v === undefined || v === null ? '' : typeof v === 'object' ? JSON.stringify(v) : String(v);
  }));
  loadTable(db, tableNameFor(file), keys, rows);
  return db;
}

export function loadSqlite(SQL: SqlJsStatic, bytes: Uint8Array): Database {
  const db = new SQL.Database(bytes);
  db.run('PRAGMA query_only = ON');
  return db;
}

export type SourceKind = 'csv' | 'json' | 'sqlite';

export function sourceKind(file: string): SourceKind | undefined {
  if (/\.csv$/i.test(file)) return 'csv';
  if (/\.json$/i.test(file)) return 'json';
  if (/\.(sqlite3?|db3?|sdb|s3db)$/i.test(file)) return 'sqlite';
  return undefined;
}
