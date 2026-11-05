import * as path from 'node:path';
import { readFile } from 'node:fs/promises';
import initSqlJs from 'sql.js';
import type { Database, SqlJsStatic } from 'sql.js';
import * as vscode from 'vscode';
import type { WidgetBlock } from '../../core/widgets/fences';
import { loadCsv, loadJson, loadSqlite, MAX_ROWS, readOnlyProblem, runQuery, sourceKind } from '../../core/query/engine';
import type { QueryProblem, QueryResult } from '../../core/query/engine';
import { renderQueryResult } from '../../core/query/views';
import { errorBox } from '../../core/query/views';
import { linesOf } from '../widgets/widgets';

let sql: Promise<SqlJsStatic> | undefined;
function engine(): Promise<SqlJsStatic> {
  return (sql ??= initSqlJs({ locateFile: () => path.join(__dirname, 'sql-wasm.wasm') }));
}

/** The query text of a block: its body without the attribute comment on the first line. */
export function querySql(doc: vscode.TextDocument, block: WidgetBlock): string {
  const lines = linesOf(doc).slice(block.bodyStartLine, block.bodyEndLine + 1);
  if (/^\s*--/.test(lines[0] ?? '')) lines.shift();
  return lines.join('\n').trim();
}

/** The data file a query block names, resolved against the note; undefined for a missing or unreadable path. */
export function querySource(doc: vscode.TextDocument, block: WidgetBlock): vscode.Uri | undefined {
  const source = block.attrs['source'];
  if (!source || doc.uri.scheme !== 'file') return undefined;
  const file = path.resolve(path.dirname(doc.uri.fsPath), source);
  return vscode.Uri.file(file);
}

/** In an untrusted workspace, queries may only read files inside it. */
function allowed(doc: vscode.TextDocument, file: vscode.Uri): boolean {
  if (vscode.workspace.isTrusted) return true;
  const folder = vscode.workspace.getWorkspaceFolder(doc.uri);
  return folder !== undefined && !path.relative(folder.uri.fsPath, file.fsPath).startsWith('..');
}

type QueryOutcome = { ok: true; result: QueryResult } | { ok: false; problem: QueryProblem };

/** Runs a block's query against its source and returns the result or the reason it couldn't run. */
export async function runBlockQuery(doc: vscode.TextDocument, block: WidgetBlock, maxRows = MAX_ROWS): Promise<QueryOutcome> {
  const file = querySource(doc, block);
  if (!file) return { ok: false, problem: { code: 'Q004', message: 'This query block needs source="file" naming a CSV, JSON or SQLite file next to the note.' } };
  if (!allowed(doc, file)) return { ok: false, problem: { code: 'Q004', message: 'Queries on files outside the workspace are blocked until the workspace is trusted.' } };
  const kind = sourceKind(file.fsPath);
  if (!kind) return { ok: false, problem: { code: 'Q004', message: `Unsupported source "${path.basename(file.fsPath)}". Use .csv, .json or a SQLite file.` } };
  const statement = querySql(doc, block);
  let db: Database | undefined;
  try {
    const SQL = await engine();
    const bytes = await readFile(file.fsPath);
    db = kind === 'csv' ? loadCsv(SQL, file.fsPath, bytes.toString('utf8')) : kind === 'json' ? loadJson(SQL, file.fsPath, bytes.toString('utf8')) : loadSqlite(SQL, new Uint8Array(bytes));
    const problem = readOnlyProblem(db, statement);
    if (problem) return { ok: false, problem };
    return { ok: true, result: runQuery(db, statement, maxRows) };
  } catch (err) {
    const code = (err as NodeJS.ErrnoException).code;
    return { ok: false, problem: { code: 'Q004', message: code === 'ENOENT' ? `Cannot find ${path.basename(file.fsPath)}.` : `Cannot read ${path.basename(file.fsPath)}: ${err instanceof Error ? err.message : String(err)}` } };
  } finally {
    db?.close();
  }
}

/** The HTML for a query widget panel. */
export async function renderQueryWidget(doc: vscode.TextDocument, block: WidgetBlock): Promise<string> {
  const outcome = await runBlockQuery(doc, block);
  if (!outcome.ok) return errorBox(outcome.problem.code, outcome.problem.message);
  return renderQueryResult(outcome.result, { view: block.attrs['view'] ?? 'table', group: block.attrs['group'], type: block.attrs['type'], x: block.attrs['x'], y: block.attrs['y'] });
}
