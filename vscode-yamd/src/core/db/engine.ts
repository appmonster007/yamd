/**
 * The SQL engine (sql.js, SQLite compiled to WASM). Everything here is synchronous and runs inside
 * the database worker; tests call it directly.
 */
import type { Database, SqlJsStatic, SqlValue } from 'sql.js';
import { parseView, PROPERTY_TYPES } from './ydb';
import type { Property, PropertyType, Row, Schema, SavedView, YdbDatabase } from './ydb';

export type Cell = string | number | null;

export interface QueryResult {
  columns: string[];
  rows: Cell[][];
  /** Rows the query produced in total (counted up to `COUNT_LIMIT`). */
  total: number;
}

const COUNT_LIMIT = 100_000;

export const quoteId = (name: string) => `"${name.replace(/"/g, '""')}"`;

// ---- Read-only check ----

/** Statements and functions documents may never use. */
const BLOCKED = /\b(ATTACH|DETACH|PRAGMA|VACUUM|LOAD_EXTENSION|READFILE|WRITEFILE|EDIT|FTS3_TOKENIZER)\b/i;
/**
 * Bytecode that writes to the database file; SQLite uses the same information for
 * `sqlite3_stmt_readonly`. `Insert` and `Delete` alone aren't listed, because queries also use them
 * on temporary tables (recursive CTEs, DISTINCT); writing to a real table needs `OpenWrite`.
 */
const WRITE_OPCODES = new Set(['OpenWrite', 'Clear', 'Destroy', 'CreateBtree', 'ParseSchema', 'VCreate', 'VDestroy', 'VUpdate']);

/** Removes string literals, quoted identifiers and comments, so keyword checks only see SQL. */
export function stripSql(sql: string): string {
  return sql.replace(/'(?:[^']|'')*'|"(?:[^"]|"")*"|`[^`]*`|\[[^\]]*\]|--[^\n]*|\/\*[\s\S]*?(?:\*\/|$)/g, ' ');
}

export interface SqlProblem {
  /** Y950: refused as unsafe. Y851: not valid SQL. */
  code: 'Y950' | 'Y851';
  message: string;
}

const READ_ONLY_MESSAGE = 'Only read-only queries can run in documents.';

/** Returns why `sql` can't run as a document query, or null if it is a single read-only statement. */
export function readOnlyProblem(db: Database, sql: string): SqlProblem | null {
  const stripped = stripSql(sql);
  const blocked = BLOCKED.exec(stripped);
  if (blocked) return { code: 'Y950', message: `${blocked[1]?.toUpperCase()} isn't allowed in document queries.` };
  if (/;\s*\S/.test(stripped)) return { code: 'Y950', message: 'Only one statement can run in a document query.' };
  if (/^\s*(INSERT|UPDATE|DELETE|REPLACE|CREATE|DROP|ALTER|REINDEX|ANALYZE|BEGIN|COMMIT|ROLLBACK|SAVEPOINT|RELEASE)\b/i.test(stripped)) {
    return { code: 'Y950', message: READ_ONLY_MESSAGE };
  }
  let count = 0;
  try {
    for (const stmt of db.iterateStatements(sql)) {
      count++;
      stmt.free();
    }
  } catch (err) {
    return { code: 'Y851', message: `SQL error: ${(err as Error).message}` };
  }
  if (count === 0) return { code: 'Y851', message: 'The query is empty.' };
  try {
    const plan = db.exec(`EXPLAIN ${sql.trim().replace(/;\s*$/, '')}`);
    const col = plan[0]?.columns.indexOf('opcode') ?? -1;
    for (const row of plan[0]?.values ?? []) {
      if (WRITE_OPCODES.has(String(row[col]))) return { code: 'Y950', message: READ_ONLY_MESSAGE };
    }
  } catch (err) {
    return { code: 'Y851', message: `SQL error: ${(err as Error).message}` };
  }
  return null;
}

// ---- Running ----

export function runQuery(db: Database, sql: string, params: SqlValue[] = [], maxRows = 500): QueryResult {
  const stmt = db.prepare(sql);
  try {
    stmt.bind(params);
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

// ---- Building databases ----

/** The SQL value stored for a `.ydb` value: JSON for lists, 0/1 for checkboxes. */
export function toSqlValue(type: PropertyType, v: unknown): SqlValue {
  if (v === undefined || v === null || v === '') return null;
  if (type === 'multi_select' || type === 'relation') return JSON.stringify(Array.isArray(v) ? v : [v]);
  if (type === 'checkbox') return v === true || v === 'true' || v === 1 ? 1 : 0;
  if (type === 'number') return typeof v === 'number' ? v : Number.isNaN(Number(v)) ? String(v) : Number(v);
  if (typeof v === 'object') return JSON.stringify(v);
  return String(v);
}

/** The `.ydb` value for a SQL value read back (inverse of `toSqlValue`). */
export function fromSqlValue(type: PropertyType, v: Cell): unknown {
  if (v === null) return undefined;
  if (type === 'multi_select' || type === 'relation') {
    try {
      const parsed: unknown = JSON.parse(String(v));
      return Array.isArray(parsed) ? parsed : [parsed];
    } catch {
      return [String(v)];
    }
  }
  if (type === 'checkbox') return v === 1 || v === '1' || v === 'true';
  if (type === 'number') return typeof v === 'number' ? v : Number(v);
  return String(v);
}

const BASE = '__yamd_base';

/**
 * Loads a `.ydb` database as table `name` (a view when it has formulas, so they're computed
 * columns). The underlying table is `__yamd_base`, with an `id` column first.
 */
export function buildYdb(SQL: SqlJsStatic, ydb: YdbDatabase, name: string): Database {
  const db = new SQL.Database();
  const stored = ydb.properties.filter((p) => p.type !== 'formula');
  const columns = ['id', ...stored.map((p) => p.name)];
  db.run(`CREATE TABLE ${quoteId(BASE)} (${columns.map((c) => `${quoteId(c)}${c === 'id' ? ' TEXT PRIMARY KEY' : ''}`).join(', ')})`);
  const insert = db.prepare(`INSERT INTO ${quoteId(BASE)} VALUES (${columns.map(() => '?').join(', ')})`);
  for (const row of ydb.rows) insert.run([row.id, ...stored.map((p) => toSqlValue(p.type, row[p.name]))]);
  insert.free();
  const formulas = ydb.properties.filter((p) => p.type === 'formula' && p.expression);
  const select = [
    '*',
    ...formulas.map((f) => `(${f.expression}) AS ${quoteId(f.name)}`),
  ].join(', ');
  try {
    db.run(`CREATE VIEW ${quoteId(name)} AS SELECT ${select} FROM ${quoteId(BASE)}`);
  } catch {
    // A broken formula leaves it out rather than losing the whole database.
    db.run(`CREATE VIEW ${quoteId(name)} AS SELECT * FROM ${quoteId(BASE)}`);
  }
  return db;
}

/** The rows of a `.ydb` database after a statement ran on its copy, for applying writes to the text. */
export function ydbRowsAfter(db: Database, schema: Schema, table = schema.name ?? BASE): Row[] {
  const stored = schema.properties.filter((p) => p.type !== 'formula');
  const res = runQuery(db, `SELECT * FROM ${quoteId(table)}`, [], Number.MAX_SAFE_INTEGER);
  return res.rows.map((cells) => {
    const row: Row = { id: String(cells[res.columns.indexOf('id')]) };
    for (const p of stored) {
      const v = fromSqlValue(p.type, cells[res.columns.indexOf(p.name)] ?? null);
      if (v !== undefined) row[p.name] = v;
    }
    return row;
  });
}

export interface NotesTables {
  notes: Record<string, unknown>[];
  tags: { path: string; tag: string }[];
  links: { source: string; target: string }[];
  tasks: { path: string; line: number; text: string; done: number }[];
}

/** The notes tables for queries without `db`: `notes`, `tags`, `links` and `tasks`. */
export function buildNotes(SQL: SqlJsStatic, t: NotesTables): Database {
  const db = new SQL.Database();
  const fixed = ['path', 'title', 'folder', 'created', 'modified', 'properties'];
  const extra = [...new Set(t.notes.flatMap((n) => Object.keys(n)))].filter((k) => !fixed.includes(k) && !/^\s*$/.test(k));
  const noteCols = [...fixed, ...extra.filter((k) => !fixed.some((f) => f.toLowerCase() === k.toLowerCase()))];
  const unique = [...new Map(noteCols.map((c) => [c.toLowerCase(), c])).values()];
  const table = (name: string, cols: string[], rows: Record<string, unknown>[]) => {
    db.run(`CREATE TABLE ${quoteId(name)} (${cols.map(quoteId).join(', ')})`);
    const insert = db.prepare(`INSERT INTO ${quoteId(name)} VALUES (${cols.map(() => '?').join(', ')})`);
    for (const r of rows) insert.run(cols.map((c) => sqlOf(r[c])));
    insert.free();
  };
  table('notes', unique, t.notes);
  table('tags', ['path', 'tag'], t.tags);
  table('links', ['source', 'target'], t.links);
  table('tasks', ['path', 'line', 'text', 'done'], t.tasks);
  return db;
}

function sqlOf(v: unknown): SqlValue {
  if (v === undefined || v === null) return null;
  if (typeof v === 'boolean') return v ? 1 : 0;
  if (typeof v === 'number' || typeof v === 'string') return v;
  if (v instanceof Date) return v.toISOString().slice(0, 10);
  return JSON.stringify(v);
}

// ---- SQLite schema ----

export interface SqliteTable {
  schema: Schema;
  /** Whether rows have a rowid, used to address them for writes. */
  hasRowid: boolean;
}

export function sqliteTables(db: Database): string[] {
  const res = runQuery(db, "SELECT name FROM sqlite_master WHERE type IN ('table','view') AND name NOT LIKE 'sqlite_%' AND name <> '_yamd_meta' ORDER BY name");
  return res.rows.map((r) => String(r[0]));
}

/**
 * `_yamd_meta` holds one JSON object per table: `{ properties, views, order }`, where `properties`
 * maps column names to a type or `{ type, options, ... }`.
 */
function meta(db: Database, key: string): unknown {
  try {
    const res = runQuery(db, 'SELECT value FROM _yamd_meta WHERE key = ?', [key]);
    const v = res.rows[0]?.[0];
    return typeof v === 'string' ? JSON.parse(v) : undefined;
  } catch {
    return undefined;
  }
}

function inferType(declared: string): PropertyType {
  const t = declared.toUpperCase();
  if (/INT|REAL|FLOA|DOUB|NUM|DEC/.test(t)) return 'number';
  if (/BOOL/.test(t)) return 'checkbox';
  if (/DATE|TIME/.test(t)) return 'date';
  return 'text';
}

/** Property types from `_yamd_meta` (`types:<table>`, `views:<table>`), or inferred from columns. */
export function sqliteSchema(db: Database, table: string): SqliteTable | null {
  if (!sqliteTables(db).includes(table)) return null;
  const info = db.exec(`PRAGMA table_info(${quoteId(table)})`)[0];
  const tableMeta = (meta(db, table) ?? {}) as Record<string, unknown>;
  const types = (tableMeta['properties'] ?? {}) as Record<string, unknown>;
  const properties: Property[] = (info?.values ?? []).map((r) => {
    const name = String(r[1]);
    const declared = types[name];
    const spec = typeof declared === 'string' ? { type: declared } : declared && typeof declared === 'object' ? (declared as Record<string, unknown>) : {};
    const type = (PROPERTY_TYPES as readonly string[]).includes(String(spec['type'])) ? (spec['type'] as PropertyType) : inferType(String(r[2]));
    const p: Property = { name, type };
    if (Array.isArray(spec['options'])) p.options = spec['options'].map(String);
    if (typeof spec['expression'] === 'string') p.expression = spec['expression'];
    if (typeof spec['database'] === 'string') p.database = spec['database'];
    return p;
  });
  if (!properties.some((p) => p.type === 'title')) {
    const first = properties.find((p) => p.type === 'text' && p.name.toLowerCase() !== 'id');
    if (first) first.type = 'title';
  }
  const rawViews = (tableMeta['views'] ?? {}) as Record<string, unknown>;
  const views: Record<string, SavedView> = Object.fromEntries(Object.entries(rawViews).map(([k, v]) => [k, parseView(v)]));
  let hasRowid = true;
  try {
    db.exec(`SELECT rowid FROM ${quoteId(table)} LIMIT 0`);
  } catch {
    hasRowid = false;
  }
  return { schema: { name: table, properties, views }, hasRowid };
}

/** Merges `patch` into a table's `_yamd_meta` entry, creating the table when needed. */
export function updateTableMeta(db: Database, table: string, patch: Record<string, unknown>): void {
  const current = (meta(db, table) ?? {}) as Record<string, unknown>;
  db.run('CREATE TABLE IF NOT EXISTS _yamd_meta (key TEXT PRIMARY KEY, value TEXT)');
  db.run('INSERT INTO _yamd_meta (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value', [
    table,
    JSON.stringify({ ...current, ...patch }),
  ]);
}

export function tableMeta(db: Database, table: string): Record<string, unknown> {
  return (meta(db, table) ?? {}) as Record<string, unknown>;
}
