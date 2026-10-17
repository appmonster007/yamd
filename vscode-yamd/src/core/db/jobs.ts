/**
 * Database jobs: everything that touches SQL, run inside the worker (or directly in tests).
 * The extension host resolves files and scope; jobs only see the data they're given.
 */
import type { Database, SqlJsStatic, SqlValue } from 'sql.js';
import {
  buildNotes,
  buildYdb,
  fromSqlValue,
  quoteId,
  readOnlyProblem,
  runQuery,
  sqliteSchema,
  sqliteTables,
  tableMeta,
  updateTableMeta,
  ydbRowsAfter,
} from './engine';
import type { NotesTables, QueryResult, SqlProblem } from './engine';
import { renderResult, renderView, VIEW_TYPES, viewError, viewSettings } from './views';
import type { RelationTarget, ViewRow } from './views';
import { loadYdb, titleProperty } from './ydb';
import type { Row, Schema } from './ydb';

export type Source =
  | { type: 'ydb'; name: string; text: string }
  | { type: 'sqlite'; table?: string; bytes: Uint8Array }
  | { type: 'notes'; tables: NotesTables };

export interface RelationSource {
  source: Source;
  /** Link to the related database, relative to the document. */
  href: string;
}

export type Job =
  | {
      kind: 'view';
      key: string;
      ref: string;
      source: Source;
      attrs?: Record<string, string | number | boolean>;
      relations?: Record<string, RelationSource>;
      interactive: boolean;
      today: string;
      month?: string;
      maxRows: number;
    }
  | { kind: 'query'; source: Source; sql: string; resultView: string; maxRows: number }
  /** A console statement. With `readOnly`, writes are refused. */
  | { kind: 'console'; source: Source; sql: string; readOnly: boolean; maxRows: number }
  /** A write built by the extension with bound parameters (never document SQL). */
  | { kind: 'write'; source: Source; sql: string; params: SqlValue[] }
  /** Merges settings (such as saved views) into a SQLite table's `_yamd_meta` entry. */
  | { kind: 'meta'; source: Source; table: string; patch: Record<string, unknown> }
  | { kind: 'tables'; source: Source }
  | { kind: 'schema'; source: Source };

export interface JobResult {
  html?: string;
  problem?: SqlProblem | { code: 'Y852' | 'Y855' | 'Y952'; message: string };
  result?: QueryResult;
  /** Rows changed by a write. */
  changes?: number;
  /** New SQLite file contents after a write. */
  bytes?: Uint8Array;
  /** `.ydb` rows after a write, for applying it to the text. */
  rows?: Row[];
  tables?: string[];
  schema?: Schema;
  ms?: number;
}

interface Opened {
  db: Database;
  table: string;
  schema: Schema;
  kind: Source['type'];
  hasRowid: boolean;
}

/** Opens a source as an in-memory database. `writable` loads `.ydb` as a plain table named after it. */
function open(SQL: SqlJsStatic, source: Source, writable = false): Opened | { problem: NonNullable<JobResult['problem']> } {
  if (source.type === 'ydb') {
    const loaded = loadYdb(source.text);
    if (!loaded.db) {
      const first = loaded.diagnostics[0];
      return { problem: { code: 'Y852', message: `The database file is invalid: ${first?.message ?? 'unknown error'}` } };
    }
    const db = writable ? buildYdb(SQL, { ...loaded.db, properties: loaded.db.properties.filter((p) => p.type !== 'formula') }, `${source.name}__v`) : buildYdb(SQL, loaded.db, source.name);
    if (writable) {
      // Statements address the table by the file's name.
      db.run(`DROP VIEW ${quoteId(`${source.name}__v`)}`);
      db.run(`ALTER TABLE "__yamd_base" RENAME TO ${quoteId(source.name)}`);
    }
    return { db, table: source.name, schema: { ...loaded.db, name: loaded.db.name ?? source.name }, kind: 'ydb', hasRowid: false };
  }
  if (source.type === 'sqlite') {
    const db = new SQL.Database(source.bytes);
    const table = source.table ?? '';
    const info = table ? sqliteSchema(db, table) : null;
    if (table && !info) {
      db.close();
      return { problem: { code: 'Y851', message: `There is no table "${table}" in this SQLite file.` } };
    }
    return { db, table, schema: info?.schema ?? { properties: [], views: {} }, kind: 'sqlite', hasRowid: info?.hasRowid ?? false };
  }
  return { db: buildNotes(SQL, source.tables), table: 'notes', schema: { properties: [], views: {} }, kind: 'notes', hasRowid: false };
}

function relationTitles(SQL: SqlJsStatic, rel: RelationSource): Record<string, RelationTarget> {
  const o = open(SQL, rel.source);
  if ('problem' in o) return {};
  try {
    const title = titleProperty(o.schema);
    const idCol = o.kind === 'ydb' ? 'id' : o.hasRowid ? 'rowid' : 'id';
    const res = runQuery(o.db, `SELECT ${idCol}, ${title ? quoteId(title.name) : idCol} FROM ${quoteId(o.table)}`, [], 10_000);
    return Object.fromEntries(res.rows.map((r) => [String(r[0]), { title: String(r[1] ?? r[0]), href: `${rel.href}#${encodeURIComponent(String(r[0]))}` }]));
  } finally {
    o.db.close();
  }
}

function view(SQL: SqlJsStatic, job: Extract<Job, { kind: 'view' }>): JobResult {
  const o = open(SQL, job.source);
  if ('problem' in o) return { problem: o.problem, html: viewError(o.problem.message, o.problem.code) };
  try {
    const settings = viewSettings(o.schema, job.attrs);
    if (!(VIEW_TYPES as readonly string[]).includes(settings.type)) {
      const problem = { code: 'Y851' as const, message: `Unknown view type "${settings.type}". Use ${VIEW_TYPES.join(', ')}.` };
      return { problem, html: viewError(problem.message, problem.code) };
    }
    const byName = new Map(o.schema.properties.map((p) => [p.name, p]));
    const order = (settings.sort ?? [])
      .map((s) => ({ desc: s.startsWith('-'), p: byName.get(s.replace(/^-/, '')) }))
      .filter((s): s is { desc: boolean; p: NonNullable<typeof s.p> } => s.p !== undefined)
      .map(({ desc, p }) => {
        // Selects and statuses sort in option order, not alphabetically.
        const expr = p.options?.length && (p.type === 'select' || p.type === 'status')
          ? `CASE ${quoteId(p.name)} ${p.options.map((opt, i) => `WHEN '${opt.replace(/'/g, "''")}' THEN ${i}`).join(' ')} END`
          : quoteId(p.name);
        return `${expr}${desc ? ' DESC' : ''} NULLS LAST`;
      });
    const idExpr = o.kind === 'ydb' ? 'id' : o.hasRowid ? 'rowid' : 'NULL';
    const limit = Math.min(settings.limit ?? job.maxRows, job.maxRows);
    const sql = `SELECT ${idExpr} AS "__yamd_id", * FROM ${quoteId(o.table)}${settings.filter ? ` WHERE (${settings.filter})` : ''}${order.length ? ` ORDER BY ${order.join(', ')}` : ''}`;
    const problem = readOnlyProblem(o.db, sql);
    if (problem) return { problem, html: viewError(problem.code === 'Y851' ? `Invalid filter: ${problem.message}` : problem.message, problem.code) };
    const result = runQuery(o.db, sql, [], limit);
    const types = new Map(o.schema.properties.map((p) => [p.name, p.type]));
    const rows: ViewRow[] = result.rows.map((cells) => {
      const values: Record<string, unknown> = {};
      result.columns.forEach((c, i) => {
        if (c === '__yamd_id') return;
        const t = types.get(c);
        values[c] = t && o.kind === 'ydb' && t !== 'formula' ? fromSqlValue(t, cells[i] ?? null) : t === 'checkbox' ? cells[i] === 1 : cells[i];
      });
      return { id: String(cells[0]), values };
    });
    const relations: Record<string, Record<string, RelationTarget>> = {};
    for (const [prop, rel] of Object.entries(job.relations ?? {})) relations[prop] = relationTitles(SQL, rel);
    const html = renderView({
      key: job.key,
      ref: job.ref,
      schema: o.schema,
      rows,
      total: result.total,
      settings,
      relations,
      interactive: job.interactive && o.kind !== 'notes',
      today: job.today,
      month: job.month,
      // The extension resolves cover images relative to the database file.
      resolveImage: (src) => `yamd-cover:${src}`,
    });
    const boardProblem = settings.type === 'board' && /class="db-error"/.test(html) ? { code: 'Y855' as const, message: /<\/span> ([^<]*)<\/div>/.exec(html)?.[1] ?? 'Invalid board.' } : undefined;
    return { html, problem: boardProblem, schema: o.schema };
  } finally {
    o.db.close();
  }
}

function query(SQL: SqlJsStatic, job: Extract<Job, { kind: 'query' }>): JobResult {
  const o = open(SQL, job.source);
  if ('problem' in o) return { problem: o.problem, html: viewError(o.problem.message, o.problem.code) };
  try {
    const problem = readOnlyProblem(o.db, job.sql);
    if (problem) return { problem, html: viewError(problem.message, problem.code) };
    const result = runQuery(o.db, job.sql.trim().replace(/;\s*$/, ''), [], job.maxRows);
    return { result, html: renderResult(result, job.resultView) };
  } catch (err) {
    const message = `SQL error: ${(err as Error).message}`;
    return { problem: { code: 'Y851', message }, html: viewError(message, 'Y851') };
  } finally {
    o.db.close();
  }
}

function consoleRun(SQL: SqlJsStatic, job: Extract<Job, { kind: 'console' }>): JobResult {
  const o = open(SQL, job.source, !job.readOnly);
  if ('problem' in o) return { problem: o.problem };
  const started = Date.now();
  try {
    if (job.readOnly) {
      const problem = readOnlyProblem(o.db, job.sql);
      if (problem) {
        return problem.code === 'Y950'
          ? { problem: { code: 'Y950', message: `${problem.message} Turn off read-only to run statements that change data.` } }
          : { problem };
      }
    } else if (/;\s*\S/.test(job.sql.replace(/'(?:[^']|'')*'|--[^\n]*/g, ''))) {
      return { problem: { code: 'Y950', message: 'Run one statement at a time.' } };
    }
    const result = runQuery(o.db, job.sql.trim().replace(/;\s*$/, ''), [], job.maxRows);
    const changes = o.db.getRowsModified();
    const out: JobResult = { result, changes, ms: Date.now() - started };
    if (!job.readOnly && changes > 0) {
      if (o.kind === 'sqlite') out.bytes = o.db.export();
      if (o.kind === 'ydb') out.rows = ydbRowsAfter(o.db, o.schema, o.table);
    }
    return out;
  } catch (err) {
    return { problem: { code: 'Y851', message: `SQL error: ${(err as Error).message}` } };
  } finally {
    o.db.close();
  }
}

function write(SQL: SqlJsStatic, job: Extract<Job, { kind: 'write' }>): JobResult {
  const o = open(SQL, job.source, true);
  if ('problem' in o) return { problem: o.problem };
  try {
    o.db.run(job.sql, job.params);
    const changes = o.db.getRowsModified();
    return { changes, bytes: o.kind === 'sqlite' ? o.db.export() : undefined };
  } catch (err) {
    return { problem: { code: 'Y851', message: `SQL error: ${(err as Error).message}` } };
  } finally {
    o.db.close();
  }
}

export function executeJob(SQL: SqlJsStatic, job: Job): JobResult {
  switch (job.kind) {
    case 'view':
      return view(SQL, job);
    case 'query':
      return query(SQL, job);
    case 'console':
      return consoleRun(SQL, job);
    case 'write':
      return write(SQL, job);
    case 'meta': {
      if (job.source.type !== 'sqlite') return { problem: { code: 'Y851', message: 'Only SQLite tables store settings in _yamd_meta.' } };
      const db = new SQL.Database(job.source.bytes);
      try {
        const current = tableMeta(db, job.table);
        const merged: Record<string, unknown> = { ...job.patch };
        // Saved views merge with the existing ones instead of replacing them.
        if (job.patch['views'] && typeof current['views'] === 'object') merged['views'] = { ...(current['views'] as object), ...(job.patch['views'] as object) };
        updateTableMeta(db, job.table, merged);
        return { changes: 1, bytes: db.export() };
      } finally {
        db.close();
      }
    }
    case 'tables': {
      const o = open(SQL, job.source);
      if ('problem' in o) return { problem: o.problem };
      try {
        return { tables: o.kind === 'sqlite' ? sqliteTables(o.db) : [o.table] };
      } finally {
        o.db.close();
      }
    }
    case 'schema': {
      const o = open(SQL, job.source);
      if ('problem' in o) return { problem: o.problem };
      o.db.close();
      return { schema: o.schema };
    }
  }
}
