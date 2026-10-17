import { existsSync, realpathSync, renameSync, writeFileSync } from 'node:fs';
import * as path from 'node:path';
import * as vscode from 'vscode';
import { parse } from '../core';
import type { JobResult, Source } from '../core/db/jobs';
import { databaseAliases, DB_EXTENSIONS, resolveDatabase, SQLITE_EXTENSIONS, ydbTableName } from '../core/db/scope';
import { renderResult } from '../core/db/views';
import { addRow, deleteRow, loadYdb, setCell } from '../core/db/ydb';
import type { Row, YdbEdit } from '../core/db/ydb';
import { setProperty } from '../core/properties';
import { globToRegExp } from '../workspace/index';
import type { DatabaseService } from './databases';
import { CONSOLE_BODY, sidebarHtml } from './webviewShell';

const fsAccess = {
  exists: (p: string) => existsSync(p),
  realpath: (p: string) => {
    try {
      return realpathSync.native(p);
    } catch {
      return p;
    }
  },
};

// ---- Diagnostics ----

/** Y850–Y854 and Y950–Y952 in notes (from running their views and queries) and in `.ydb` files. */
export class DatabaseDiagnostics implements vscode.Disposable {
  private readonly collection = vscode.languages.createDiagnosticCollection('yamd-db');
  private readonly timers = new Map<string, ReturnType<typeof setTimeout>>();
  private readonly disposables: vscode.Disposable[] = [this.collection];

  constructor(private readonly db: DatabaseService) {
    this.disposables.push(
      vscode.workspace.onDidOpenTextDocument((d) => this.schedule(d, 0)),
      vscode.workspace.onDidChangeTextDocument((e) => this.schedule(e.document)),
      vscode.workspace.onDidCloseTextDocument((d) => this.collection.delete(d.uri)),
      vscode.workspace.onDidGrantWorkspaceTrust(() => this.all()),
      // Only notes whose queries read the changed data are checked again.
      db.onDidChange((path) => {
        for (const d of vscode.workspace.textDocuments) if (d.languageId === 'yamd' && db.affects(d, path)) this.schedule(d);
      }),
    );
    this.all();
  }

  private all() {
    for (const d of vscode.workspace.textDocuments) this.schedule(d);
  }

  private schedule(doc: vscode.TextDocument, delay = 800) {
    const isYdb = doc.uri.fsPath.endsWith('.ydb');
    if (doc.languageId !== 'yamd' && !isYdb) return;
    const key = doc.uri.toString();
    clearTimeout(this.timers.get(key));
    this.timers.set(
      key,
      setTimeout(() => {
        this.timers.delete(key);
        void (isYdb ? this.ydb(doc) : this.note(doc));
      }, delay),
    );
  }

  private ydb(doc: vscode.TextDocument) {
    const out = loadYdb(doc.getText()).diagnostics.map((d) => {
      const diag = new vscode.Diagnostic(
        new vscode.Range(doc.positionAt(d.range.start), doc.positionAt(Math.max(d.range.end, d.range.start))),
        d.message,
        d.severity === 'error' ? vscode.DiagnosticSeverity.Error : vscode.DiagnosticSeverity.Warning,
      );
      diag.code = d.code;
      diag.source = 'yamd';
      return diag;
    });
    this.collection.set(doc.uri, out);
  }

  private async note(doc: vscode.TextDocument) {
    if (!vscode.workspace.isTrusted || doc.uri.scheme !== 'file' || doc.isClosed) {
      this.collection.delete(doc.uri);
      return;
    }
    const version = doc.version;
    const parsed = parse(doc.getText());
    const diags: vscode.Diagnostic[] = [];
    const add = (code: string, message: string, range: vscode.Range, severity = vscode.DiagnosticSeverity.Error) => {
      const d = new vscode.Diagnostic(range, message, severity);
      d.code = code;
      d.source = 'yamd';
      diags.push(d);
    };
    // Aliases in the front matter are checked even when nothing uses them yet.
    const fm = parsed.frontMatter;
    const aliases = databaseAliases(fm?.data);
    for (const alias of Object.keys(aliases)) {
      const r = resolveDatabase(doc.uri.fsPath, alias, aliases, fsAccess);
      if (r.ok) continue;
      const line = fm ? parsed.lines.findIndex((l, i) => i > fm.line && i < fm.endLine && new RegExp(`^\\s+${alias.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}\\s*:`).test(l)) : -1;
      add(r.code, r.message, doc.lineAt(Math.max(line, 0)).range);
    }
    for (const r of await this.db.runDocument(doc, parsed, vscode.workspace.isTrusted)) {
      if (!r.problem) continue;
      const start = doc.positionAt(r.node.range.start);
      const range = r.node.kind === 'inline' ? new vscode.Range(start, doc.positionAt(r.node.range.end)) : doc.lineAt(start.line).range;
      add(r.problem.code, r.problem.message, range, r.problem.code === 'Y952' ? vscode.DiagnosticSeverity.Warning : vscode.DiagnosticSeverity.Error);
    }
    if (!doc.isClosed && doc.version === version) this.collection.set(doc.uri, diags);
  }

  dispose() {
    for (const t of this.timers.values()) clearTimeout(t);
    for (const d of this.disposables) d.dispose();
  }
}

// ---- Applying console writes to .ydb text ----

/** Line edits that turn the rows in `text` into `after`, one row at a time. */
function rowEdits(text: string, after: Row[]): YdbEdit[] | null {
  const before = loadYdb(text).db;
  if (!before) return null;
  let current = text;
  const apply = (e: YdbEdit | null) => {
    if (!e) return;
    const lines = current.split('\n');
    if (e.endLine < e.startLine) lines.splice(e.startLine, 0, ...e.text.split('\n'));
    else lines.splice(e.startLine, e.endLine - e.startLine + 1, ...(e.text === '' ? [] : e.text.split('\n')));
    current = lines.join('\n');
  };
  const old = new Map(before.rows.map((r) => [r.id, r]));
  const next = new Map(after.map((r) => [r.id, r]));
  for (const r of before.rows) if (!next.has(r.id)) apply(deleteRow(current, r.id));
  for (const r of after) {
    const prev = old.get(r.id);
    if (!prev) {
      const { id, ...values } = r;
      apply(addRow(current, values, undefined, id)?.edit ?? null);
      continue;
    }
    const keys = new Set([...Object.keys(prev), ...Object.keys(r)]);
    for (const k of keys) {
      if (k === 'id' || JSON.stringify(prev[k]) === JSON.stringify(r[k])) continue;
      apply(setCell(current, r.id, k, r[k]));
    }
  }
  const lines = text.split('\n');
  return [{ startLine: 0, endLine: lines.length - 1, text: current }];
}

// ---- SQL console ----

type ConsoleMessage =
  | { type: 'ready' }
  | { type: 'pick' }
  | { type: 'run'; sql: string; readOnly: boolean }
  | { type: 'openViewer' };

const HISTORY = 'yamd.console.history';
const CHOICE = 'yamd.console.database';
const BROWSED = 'yamd.console.browsed';

class SqlConsole implements vscode.WebviewViewProvider {
  private view: vscode.WebviewView | undefined;
  private readonly confirmed = new Set<string>();

  constructor(
    private readonly context: vscode.ExtensionContext,
    private readonly db: DatabaseService,
  ) {}

  private get file(): string | undefined {
    return this.context.workspaceState.get<string>(CHOICE);
  }

  resolveWebviewView(view: vscode.WebviewView) {
    this.view = view;
    view.webview.options = { enableScripts: true, localResourceRoots: [vscode.Uri.joinPath(this.context.extensionUri, 'dist'), vscode.Uri.joinPath(this.context.extensionUri, 'media')] };
    view.webview.html = sidebarHtml(view.webview, this.context.extensionUri, 'console.js', CONSOLE_BODY);
    view.webview.onDidReceiveMessage((m: ConsoleMessage) => this.onMessage(m));
  }

  private post(message: Record<string, unknown>) {
    void this.view?.webview.postMessage(message);
  }

  private state() {
    this.post({
      type: 'state',
      database: this.file ? vscode.workspace.asRelativePath(this.file) : null,
      sqlite: this.file ? SQLITE_EXTENSIONS.test(this.file) : false,
      history: this.context.workspaceState.get<string[]>(HISTORY, []),
      trusted: vscode.workspace.isTrusted,
    });
  }

  private async onMessage(m: ConsoleMessage) {
    if (m.type === 'ready') return this.state();
    if (m.type === 'pick') return this.pick();
    if (m.type === 'openViewer') return vscode.commands.executeCommand('yamd.openInSqliteViewer', this.file ? vscode.Uri.file(this.file) : undefined);
    if (m.type === 'run') return this.run(m.sql, m.readOnly);
  }

  async pick() {
    const files = await vscode.workspace.findFiles('**/*.{ydb,sqlite,sqlite3,db}', '**/node_modules/**', 500);
    const items: (vscode.QuickPickItem & { file?: string; browse?: boolean })[] = [];
    const doc = vscode.window.activeTextEditor?.document;
    if (doc?.languageId === 'yamd') {
      const aliases = databaseAliases(parse(doc.getText()).frontMatter?.data);
      for (const alias of Object.keys(aliases)) {
        const r = resolveDatabase(doc.uri.fsPath, alias, aliases, fsAccess);
        if (r.ok) items.push({ label: alias, description: `alias in ${path.basename(doc.uri.fsPath)}`, detail: vscode.workspace.asRelativePath(r.ref.file), file: r.ref.file });
      }
    }
    const browsed = this.context.workspaceState.get<string[]>(BROWSED, []);
    for (const f of [...files.map((u) => u.fsPath), ...browsed.filter(existsSync)]) {
      if (!items.some((i) => i.file === f)) items.push({ label: path.basename(f), description: vscode.workspace.asRelativePath(f), file: f });
    }
    items.push({ label: '$(folder-opened) Browse…', browse: true });
    const choice = await vscode.window.showQuickPick(items, { placeHolder: 'Choose a database for the SQL console' });
    if (!choice) return;
    let file = choice.file;
    if (choice.browse) {
      const picked = await vscode.window.showOpenDialog({ canSelectMany: false, filters: { Databases: ['ydb', 'sqlite', 'sqlite3', 'db'] } });
      file = picked?.[0]?.fsPath;
      if (!file) return;
      await this.context.workspaceState.update(BROWSED, [...new Set([file, ...browsed])].slice(0, 20));
    }
    await this.context.workspaceState.update(CHOICE, file);
    this.state();
  }

  private async run(sql: string, readOnly: boolean) {
    const file = this.file;
    if (!vscode.workspace.isTrusted) return this.post({ type: 'result', error: 'The SQL console is disabled in Restricted Mode.' });
    if (!file || !existsSync(file) || !DB_EXTENSIONS.test(file)) return this.post({ type: 'result', error: 'Choose a database first.' });
    if (!sql.trim()) return;
    const history = [sql, ...this.context.workspaceState.get<string[]>(HISTORY, []).filter((h) => h !== sql)].slice(0, 50);
    await this.context.workspaceState.update(HISTORY, history);
    const ref = { file, kind: SQLITE_EXTENSIONS.test(file) ? ('sqlite' as const) : ('ydb' as const), written: file };
    const source = await this.db.source(ref);
    if ('code' in source) return this.post({ type: 'result', error: source.message });
    if (!readOnly && !this.confirmed.has(file)) {
      const ok = await vscode.window.showWarningMessage(
        `Run statements that can change ${path.basename(file)}?`,
        { modal: true, detail: 'Read-only is off. You will not be asked again for this database in this session.' },
        'Run',
      );
      if (ok !== 'Run') return this.post({ type: 'result', error: 'Cancelled.' });
      this.confirmed.add(file);
    }
    const started = Date.now();
    const result: JobResult = await this.db.run({ kind: 'console', source, sql, readOnly, maxRows: 1000 });
    if (result.problem) return this.post({ type: 'result', error: `${result.problem.code}: ${result.problem.message}`, history });
    let note = '';
    if (!readOnly && (result.changes ?? 0) > 0) {
      note = await this.applyWrite(file, source, result);
      this.db.log.appendLine(`${new Date().toISOString()} console wrote ${file}: ${sql.replace(/\s+/g, ' ').slice(0, 200)}`);
    }
    const html = result.result && result.result.columns.length ? renderResult(result.result, 'table') : '';
    this.post({
      type: 'result',
      html,
      summary: `${result.result?.total ?? 0} row(s)${result.changes ? `, ${result.changes} changed` : ''} · ${Date.now() - started} ms${note}`,
      history,
    });
  }

  private async applyWrite(file: string, source: Source, result: JobResult): Promise<string> {
    if (source.type === 'sqlite' && result.bytes) {
      const temp = path.join(path.dirname(file), `.${path.basename(file)}.yamd-${process.pid}.tmp`);
      writeFileSync(temp, result.bytes);
      renameSync(temp, file);
      return '';
    }
    if (source.type === 'ydb' && result.rows) {
      const doc = await vscode.workspace.openTextDocument(vscode.Uri.file(file));
      const edits = rowEdits(doc.getText(), result.rows);
      const e = edits?.[0];
      if (!e) return ' (could not apply to the file)';
      const ws = new vscode.WorkspaceEdit();
      ws.replace(doc.uri, new vscode.Range(0, 0, doc.lineCount - 1, doc.lineAt(doc.lineCount - 1).text.length), e.text);
      await vscode.workspace.applyEdit(ws);
      return ` · applied to ${ydbTableName(file)}.ydb (undo there to revert)`;
    }
    return '';
  }

}

// ---- Commands ----

async function newDatabase() {
  const root = vscode.workspace.workspaceFolders?.[0]?.uri;
  const folder = await vscode.window.showOpenDialog({ canSelectFiles: false, canSelectFolders: true, defaultUri: root, openLabel: 'Create Database Here' });
  const dir = folder?.[0];
  if (!dir) return;
  const name = await vscode.window.showInputBox({ prompt: 'Database name', value: 'tasks', validateInput: (v) => (/^[\w -]+$/.test(v) ? null : 'Use letters, digits, spaces, - and _.') });
  if (!name) return;
  const uri = vscode.Uri.joinPath(dir, `${name}.ydb`);
  if (existsSync(uri.fsPath)) {
    void vscode.window.showErrorMessage(`${name}.ydb already exists.`);
    return;
  }
  const text = `yamdb: 0.1
name: ${name}

properties:
  Name: title
  Status:
    type: status
    options: [Todo, Doing, Done]

views:
  All:
    type: table

rows: []
`;
  await vscode.workspace.fs.writeFile(uri, new TextEncoder().encode(text));
  await vscode.window.showTextDocument(uri);
}

async function addDatabaseToNote(db: DatabaseService) {
  const editor = vscode.window.activeTextEditor;
  const doc = editor?.document;
  if (!doc || doc.languageId !== 'yamd' || doc.uri.scheme !== 'file') {
    void vscode.window.showInformationMessage('YAMD: Open a note to add a database to it.');
    return;
  }
  const dir = path.dirname(doc.uri.fsPath);
  // Only databases in the note's folder and its subfolders are in scope.
  const files = await vscode.workspace.findFiles(new vscode.RelativePattern(dir, '**/*.{ydb,sqlite,sqlite3,db}'), '**/node_modules/**', 500);
  const items: (vscode.QuickPickItem & { ref: string })[] = [];
  for (const f of files) {
    const rel = path.relative(dir, f.fsPath).split(path.sep).join('/');
    if (SQLITE_EXTENSIONS.test(f.fsPath)) {
      if (!vscode.workspace.isTrusted) continue;
      const source = await db.source({ file: f.fsPath, kind: 'sqlite', written: rel });
      if ('code' in source) continue;
      const tables = (await db.run({ kind: 'tables', source })).tables ?? [];
      for (const t of tables) items.push({ label: `${rel}#${t}`, description: 'SQLite table', ref: `${rel}#${t}` });
    } else {
      items.push({ label: rel, description: 'text database', ref: rel });
    }
  }
  if (!items.length) {
    void vscode.window.showInformationMessage("YAMD: There are no databases in this note's folder or its subfolders.");
    return;
  }
  const choice = await vscode.window.showQuickPick(items, { placeHolder: 'Choose a database for this note' });
  if (!choice) return;
  const suggested = (choice.ref.split('#')[1] ?? path.basename(choice.ref).replace(/\.\w+$/, '')).replace(/\W+/g, '_');
  const alias = await vscode.window.showInputBox({ prompt: 'Alias to use in ::db[...] and db=', value: suggested, validateInput: (v) => (/^[\w-]+$/.test(v) ? null : 'Use letters, digits, - and _.') });
  if (!alias) return;
  const existing = databaseAliases(parse(doc.getText()).frontMatter?.data);
  const change = setProperty(doc.getText(), 'databases', { ...existing, [alias]: choice.ref });
  if (!change) {
    void vscode.window.showErrorMessage('YAMD: Fix the front matter first; it is not valid YAML.');
    return;
  }
  const edit = new vscode.WorkspaceEdit();
  if (change.endLine < change.startLine) edit.insert(doc.uri, new vscode.Position(0, 0), `${change.text}\n`);
  else edit.replace(doc.uri, new vscode.Range(change.startLine, 0, change.endLine, doc.lineAt(change.endLine).text.length), change.text);
  await vscode.workspace.applyEdit(edit);
}

interface CustomEditor {
  viewType: string;
  displayName: string;
  extension: string;
}

/** Custom editors from installed extensions whose file patterns match `file`. */
function sqliteEditors(file: string): CustomEditor[] {
  const name = path.basename(file);
  const out: CustomEditor[] = [];
  for (const ext of vscode.extensions.all) {
    const editors = (ext.packageJSON as { contributes?: { customEditors?: { viewType: string; displayName?: string; selector?: { filenamePattern?: string }[] }[] } })
      .contributes?.customEditors;
    for (const e of editors ?? []) {
      const matches = (e.selector ?? []).some((s) => s.filenamePattern && globToRegExp(s.filenamePattern.replace(/^\*\*\//, '')).test(name));
      if (matches) out.push({ viewType: e.viewType, displayName: e.displayName ?? e.viewType, extension: (ext.packageJSON as { displayName?: string }).displayName ?? ext.id });
    }
  }
  return out;
}

async function openInSqliteViewer(uri?: vscode.Uri) {
  const target = uri ?? vscode.window.activeTextEditor?.document.uri;
  if (!target || !SQLITE_EXTENSIONS.test(target.fsPath)) {
    void vscode.window.showInformationMessage('YAMD: Choose a SQLite file (.sqlite, .sqlite3 or .db).');
    return;
  }
  const editors = sqliteEditors(target.fsPath);
  if (!editors.length) {
    const search = await vscode.window.showInformationMessage('No installed extension can open SQLite files. Search the Marketplace for one?', 'Search Marketplace');
    if (search) await vscode.commands.executeCommand('workbench.extensions.search', 'sqlite viewer');
    return;
  }
  const config = vscode.workspace.getConfiguration('yamd.sqlite');
  let chosen = editors.find((e) => e.viewType === config.get<string>('viewer'));
  if (!chosen && editors.length === 1) chosen = editors[0];
  if (!chosen) {
    const pick = await vscode.window.showQuickPick(
      editors.map((e) => ({ label: e.displayName, description: e.extension, editor: e })),
      { placeHolder: 'Open SQLite files with…' },
    );
    if (!pick) return;
    chosen = pick.editor;
    await config.update('viewer', chosen.viewType, vscode.ConfigurationTarget.Global);
  }
  await vscode.commands.executeCommand('vscode.openWith', target, chosen.viewType);
}

export function registerDatabaseFeatures(context: vscode.ExtensionContext, db: DatabaseService): void {
  const console = new SqlConsole(context, db);
  context.subscriptions.push(
    new DatabaseDiagnostics(db),
    vscode.window.registerWebviewViewProvider('yamd.sqlConsole', console),
    vscode.commands.registerCommand('yamd.newDatabase', newDatabase),
    vscode.commands.registerCommand('yamd.addDatabaseToNote', () => addDatabaseToNote(db)),
    vscode.commands.registerCommand('yamd.openInSqliteViewer', openInSqliteViewer),
    vscode.commands.registerCommand('yamd.chooseConsoleDatabase', () => console.pick()),
  );
}
