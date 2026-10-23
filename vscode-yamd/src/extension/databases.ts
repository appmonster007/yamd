/**
 * Databases in the extension host: loading files inside the document's scope, running jobs in the
 * worker with a timeout, filling preview placeholders, and the write paths for `.ydb` (undoable
 * text edits) and SQLite (confirmed, checked against the file on disk, atomic).
 */
import { existsSync, realpathSync, renameSync, statSync, writeFileSync } from 'node:fs';
import * as path from 'node:path';
import { Worker } from 'node:worker_threads';
import * as vscode from 'vscode';
import { escapeHtml, parse } from '../core';
import { attrString } from '../core/attrs';
import { quoteId, toSqlValue } from '../core/db/engine';
import type { NotesTables } from '../core/db/engine';
import type { Job, JobResult, RelationSource, Source } from '../core/db/jobs';
import { dbNodes } from '../core/db/nodes';
import { buildNotesTables } from '../core/db/notesTables';
import type { DbNode } from '../core/db/nodes';
import { databaseAliases, inside, resolveDatabase, ydbTableName } from '../core/db/scope';
import type { DatabaseRef, FileAccess } from '../core/db/scope';
import { viewError } from '../core/db/views';
import { addRow, deleteRow, loadYdb, moveRow, READ_ONLY_TYPES, saveView, setCell } from '../core/db/ydb';
import type { Property, SavedView, YdbEdit } from '../core/db/ydb';
import type { YamdDocument } from '../core/types';
import type { WorkspaceIndex } from '../workspace/index';
import { notePath } from '../workspace/index';

/** What a note's database results were built from. */
interface Deps {
  files: Set<string>;
  /** The note has queries over the notes in its folder. */
  notes: boolean;
  /** The note names a database that couldn't be found. */
  unresolved: boolean;
}

export interface SlotResult {
  key: string;
  node: DbNode;
  html: string;
  problem?: { code: string; message: string };
}

/** What the last run of a view used, so writes from the preview target the same database. */
interface SlotState {
  ref: DatabaseRef;
  properties: Property[];
  settings: SavedView;
  month?: string;
}

export interface DbMessage {
  type: 'db';
  op: 'set' | 'add' | 'delete' | 'move' | 'saveView' | 'month';
  key: string;
  rowId?: string;
  prop?: string;
  value?: unknown;
  beforeId?: string | null;
  groupValue?: unknown;
  sort?: string[];
  delta?: number;
}

const fsAccess: FileAccess = {
  exists: (p) => existsSync(p),
  realpath: (p) => {
    try {
      return realpathSync.native(p);
    } catch {
      return p;
    }
  },
};

function settings() {
  const q = vscode.workspace.getConfiguration('yamd.queries');
  return {
    timeout: Math.max(100, q.get<number>('timeout', 2) * 1000),
    maxRows: Math.max(1, q.get<number>('maxRows', 500)),
    maxBytes: vscode.workspace.getConfiguration('yamd.databases').get<number>('maxFileSize', 100) * 1024 * 1024,
  };
}

const today = () => new Date().toISOString().slice(0, 10);

export class DatabaseService implements vscode.Disposable {
  readonly log = vscode.window.createOutputChannel('YAMD Databases');
  private worker: Worker | undefined;
  private nextId = 1;
  private readonly pending = new Map<number, { resolve: (r: JobResult) => void; timer: ReturnType<typeof setTimeout> }>();
  private readonly changed = new vscode.EventEmitter<string>();
  /** Fires with a database file path (or `notes:`) when its data may have changed. */
  readonly onDidChange = this.changed.event;
  /** SQLite files the user allowed writes to in this session. */
  private readonly allowedWrites = new Set<string>();
  /** mtime of each SQLite file when it was last loaded, to detect changes on disk before writing. */
  private readonly loadedMtime = new Map<string, number>();
  private readonly slots = new Map<string, Map<string, SlotState>>();
  private readonly disposables: vscode.Disposable[] = [this.changed, this.log];
  private readonly textTimers = new Map<string, ReturnType<typeof setTimeout>>();

  // What each note's results depend on, so a change re-runs only the notes it can affect, and
  // results are reused when neither the note's queries nor their data changed.
  private readonly deps = new Map<string, Deps>();
  private readonly fileVersions = new Map<string, number>();
  private notesVersion = 0;
  /** Counts every database file event, for notes that name a database that doesn't exist yet. */
  private fileEvents = 0;
  private readonly resultCache = new Map<string, { signature: string; stamp: string; results: SlotResult[] }>();

  constructor(
    private readonly extensionUri: vscode.Uri,
    private readonly index?: WorkspaceIndex,
  ) {
    const watcher = vscode.workspace.createFileSystemWatcher('**/*.{ydb,sqlite,sqlite3,db}');
    const fire = (uri: vscode.Uri) => this.fire(uri.fsPath);
    this.disposables.push(
      watcher,
      watcher.onDidChange(fire),
      watcher.onDidCreate(fire),
      watcher.onDidDelete(fire),
      vscode.workspace.onDidChangeTextDocument((e) => {
        const file = e.document.uri.fsPath;
        if (!file.endsWith('.ydb')) return;
        // Typing in a database file is reported once it pauses, per file.
        clearTimeout(this.textTimers.get(file));
        this.textTimers.set(
          file,
          setTimeout(() => {
            this.textTimers.delete(file);
            this.fire(file);
          }, 300),
        );
      }),
      ...(index ? [index.onDidChange(() => this.fire('notes:'))] : []),
    );
  }

  /** Records that data changed, then tells listeners. */
  private fire(path: string) {
    if (path === 'notes:') this.notesVersion++;
    else {
      this.fileVersions.set(path, (this.fileVersions.get(path) ?? 0) + 1);
      this.fileEvents++;
    }
    this.changed.fire(path);
  }

  /** Whether a change to `path` (a database file, or `notes:`) can change this note's results. */
  affects(doc: vscode.TextDocument, path: string): boolean {
    const d = this.deps.get(doc.uri.toString());
    if (!d) return false;
    return d.unresolved || (path === 'notes:' ? d.notes : d.files.has(path));
  }

  /** A string that changes when anything the note's results depend on changes. */
  private stamp(d: Deps): string {
    const files = [...d.files].map((f) => `${f}:${this.fileVersions.get(f) ?? 0}`).join('|');
    return `${files}|${d.notes ? this.notesVersion : ''}|${d.unresolved ? this.fileEvents : ''}`;
  }

  // ---- Worker ----

  private spawn(): Worker {
    const worker = new Worker(vscode.Uri.joinPath(this.extensionUri, 'dist', 'dbWorker.js').fsPath);
    worker.on('message', (m: { id: number; result?: JobResult; error?: string }) => {
      const p = this.pending.get(m.id);
      if (!p) return;
      clearTimeout(p.timer);
      this.pending.delete(m.id);
      p.resolve(m.result ?? { problem: { code: 'Y851', message: m.error ?? 'The database worker failed.' } });
    });
    worker.on('error', (err) => this.log.appendLine(`Worker error: ${err.message}`));
    worker.on('exit', () => {
      if (this.worker === worker) this.worker = undefined;
    });
    return worker;
  }

  /** Runs a job in the worker; past the timeout the worker is stopped and Y952 returned. */
  run(job: Job, timeout = settings().timeout): Promise<JobResult> {
    this.worker ??= this.spawn();
    const worker = this.worker;
    const id = this.nextId++;
    return new Promise((resolve) => {
      const timer = setTimeout(() => {
        this.pending.delete(id);
        // Terminating is the only way to stop sql.js in the middle of a statement.
        void worker.terminate();
        if (this.worker === worker) this.worker = undefined;
        for (const [otherId, other] of this.pending) {
          clearTimeout(other.timer);
          other.resolve({ problem: { code: 'Y952', message: 'Cancelled because another query timed out.' } });
          this.pending.delete(otherId);
        }
        resolve({ problem: { code: 'Y952', message: `The query was stopped after ${timeout / 1000} seconds.` } });
      }, timeout);
      this.pending.set(id, { resolve, timer });
      worker.postMessage({ id, job });
    });
  }

  // ---- Sources ----

  /** Loads a database file. `.ydb` text comes from an open editor when there is one (unsaved edits included). */
  async source(ref: DatabaseRef): Promise<Source | { code: string; message: string }> {
    const stat = statSync(ref.file);
    if (stat.size > settings().maxBytes) {
      return { code: 'Y851', message: `${path.basename(ref.file)} is larger than yamd.databases.maxFileSize, so it isn't loaded for previews.` };
    }
    if (ref.kind === 'ydb') {
      const open = vscode.workspace.textDocuments.find((d) => d.uri.fsPath === ref.file);
      const text = open ? open.getText() : new TextDecoder().decode(await vscode.workspace.fs.readFile(vscode.Uri.file(ref.file)));
      return { type: 'ydb', name: ydbTableName(ref.file), text };
    }
    this.loadedMtime.set(ref.file, stat.mtimeMs);
    const bytes = await vscode.workspace.fs.readFile(vscode.Uri.file(ref.file));
    return { type: 'sqlite', table: ref.table, bytes };
  }

  /** The notes tables for a document: notes in its folder and subfolders. */
  notesTables(docFile: string): NotesTables {
    const store = this.index?.store;
    if (!store) return { notes: [], tags: [], links: [], tasks: [] };
    return buildNotesTables(store, notePath(vscode.Uri.file(path.dirname(docFile))), (p) => {
      try {
        const st = statSync(p);
        return { created: st.birthtime.toISOString(), modified: st.mtime.toISOString() };
      } catch {
        // Unsaved or deleted.
        return { created: null, modified: null };
      }
    });
  }

  /** Relations of a `.ydb` database, each checked against the document's folder. */
  private async relations(ref: DatabaseRef, text: string, docFile: string, deps: Deps): Promise<Record<string, RelationSource>> {
    const out: Record<string, RelationSource> = {};
    const loaded = loadYdb(text).db;
    for (const p of loaded?.properties ?? []) {
      if (p.type !== 'relation' || !p.database) continue;
      const file = path.resolve(path.dirname(ref.file), p.database);
      if (!existsSync(file) || !inside(path.dirname(docFile), file, fsAccess)) continue;
      const [target, table] = p.database.split('#');
      deps.files.add(file);
      const related: DatabaseRef = { file, table, kind: file.endsWith('.ydb') ? 'ydb' : 'sqlite', written: target ?? '' };
      const source = await this.source(related);
      if ('code' in source) continue;
      out[p.name] = { source, href: path.relative(path.dirname(docFile), file).split(path.sep).join('/') };
    }
    return out;
  }

  // ---- Documents ----

  /**
   * Runs every view and query in a document. In Restricted Mode nothing is read. Results are reused
   * while the note's queries and everything they read are unchanged, so typing in a paragraph
   * doesn't re-run its queries.
   */
  async runDocument(doc: vscode.TextDocument, parsed: YamdDocument = parse(doc.getText()), interactive = false): Promise<SlotResult[]> {
    const nodes = dbNodes(parsed);
    if (!nodes.length) {
      this.deps.delete(doc.uri.toString());
      return [];
    }
    if (!vscode.workspace.isTrusted) {
      return nodes.map((node) => ({ key: node.key, node, html: viewError('Queries are disabled in Restricted Mode.', 'Restricted') }));
    }
    const docFile = doc.uri.fsPath;
    const aliases = databaseAliases(parsed.frontMatter?.data);
    const { maxRows } = settings();
    const docKey = doc.uri.toString();
    const cacheKey = `${docKey}|${interactive}`;
    const signature = JSON.stringify([nodes.map((n) => [n.key, n.kind, n.ref, n.sql, n.resultView, n.attrs?.values]), aliases, maxRows, today()]);
    const cached = this.resultCache.get(cacheKey);
    const known = this.deps.get(docKey);
    if (cached && known && cached.signature === signature && cached.stamp === this.stamp(known)) return cached.results;

    const deps: Deps = { files: new Set(), notes: false, unresolved: false };
    // Views of the same database in one note share one read of its file.
    const loads = new Map<string, Promise<Source | { code: string; message: string }>>();
    const load = (ref: DatabaseRef) => {
      const key = `${ref.file}#${ref.table ?? ''}`;
      let p = loads.get(key);
      if (!p) loads.set(key, (p = this.source(ref)));
      return p;
    };
    const relationCache = new Map<string, Promise<Record<string, RelationSource>>>();
    const slots = this.slots.get(docKey) ?? new Map<string, SlotState>();
    this.slots.set(docKey, slots);
    const results: SlotResult[] = [];
    for (const node of nodes) {
      const fail = (code: string, message: string): SlotResult => ({
        key: node.key,
        node,
        html: node.kind === 'inline' ? `<span class="db-error-inline" title="${escapeHtml(message)}">${escapeHtml(code)}</span>` : viewError(message, code),
        problem: { code, message },
      });
      try {
        let source: Source;
        let ref: DatabaseRef | undefined;
        if (node.ref === undefined || node.ref === '') {
          if (node.kind === 'view') {
            results.push(fail('Y850', 'Name a database: ::db[alias or path].'));
            continue;
          }
          deps.notes = true;
          source = { type: 'notes', tables: this.notesTables(docFile) };
        } else {
          const r = resolveDatabase(docFile, node.ref, aliases, fsAccess);
          if (!r.ok) {
            // A missing database may be created later, so any database file event re-runs this note.
            if (r.code === 'Y850') deps.unresolved = true;
            results.push(fail(r.code, r.message));
            continue;
          }
          ref = r.ref;
          deps.files.add(ref.file);
          if (node.kind === 'view' && ref.kind === 'sqlite' && !ref.table) {
            results.push(fail('Y850', `"${node.ref}" is a SQLite file. Name a table for a view, for example "${node.ref}#contacts".`));
            continue;
          }
          const loaded = await load(ref);
          if ('code' in loaded) {
            results.push(fail(loaded.code, loaded.message));
            continue;
          }
          source = loaded;
        }
        let result: JobResult;
        if (node.kind === 'view' && ref) {
          const state = slots.get(node.key);
          const attrs = Object.fromEntries(Object.entries(node.attrs?.values ?? {})) as Record<string, string | boolean>;
          result = await this.run({
            kind: 'view',
            key: node.key,
            ref: node.ref ?? '',
            source,
            attrs,
            relations: source.type === 'ydb' ? await this.cachedRelations(relationCache, ref, source.text, docFile, deps) : undefined,
            interactive: interactive && vscode.workspace.fs.isWritableFileSystem('file') !== false,
            today: today(),
            month: state?.month,
            maxRows,
          });
          // The view job returns its schema; asking for it again is only for views that failed.
          const schema = result.schema ?? (await this.run({ kind: 'schema', source })).schema;
          const merged = schema ? ({ ...(schema.views[attrString(node.attrs, 'view') ?? ''] ?? {}) } as SavedView) : {};
          for (const k of ['filter', 'group', 'type'] as const) {
            const v = attrString(node.attrs, k);
            if (v !== undefined) (merged as Record<string, unknown>)[k] = v;
          }
          const sort = attrString(node.attrs, 'sort');
          if (sort !== undefined) merged.sort = sort.split(',').map((s) => s.trim());
          slots.set(node.key, { ref, properties: schema?.properties ?? [], settings: merged, month: state?.month });
        } else {
          result = await this.run({ kind: 'query', source, sql: node.sql ?? '', resultView: node.resultView ?? 'table', maxRows });
        }
        let html = result.html ?? (result.problem ? viewError(result.problem.message, result.problem.code) : '');
        if (node.kind === 'inline' && result.problem) html = `<span class="db-error-inline" title="${escapeHtml(result.problem.message)}">${escapeHtml(result.problem.code)}</span>`;
        results.push({ key: node.key, node, html, problem: result.problem });
      } catch (err) {
        results.push(fail('Y851', err instanceof Error ? err.message : String(err)));
      }
    }
    this.deps.set(docKey, deps);
    this.resultCache.set(cacheKey, { signature, stamp: this.stamp(deps), results });
    return results;
  }

  private cachedRelations(cache: Map<string, Promise<Record<string, RelationSource>>>, ref: DatabaseRef, text: string, docFile: string, deps: Deps) {
    let p = cache.get(ref.file);
    if (!p) cache.set(ref.file, (p = this.relations(ref, text, docFile, deps)));
    return p;
  }

  // ---- Writes from the preview ----

  async handle(doc: vscode.TextDocument, m: DbMessage): Promise<void> {
    if (!vscode.workspace.isTrusted) return;
    const slot = this.slots.get(doc.uri.toString())?.get(m.key);
    if (!slot) return;
    if (m.op === 'month') {
      const base = slot.month ?? today().slice(0, 7);
      const [y, mo] = base.split('-').map(Number) as [number, number];
      const d = new Date(Date.UTC(y, mo - 1 + (m.delta ?? 0), 1));
      slot.month = d.toISOString().slice(0, 7);
      this.fire(slot.ref.file);
      return;
    }
    const prop = m.prop ? slot.properties.find((p) => p.name === m.prop) : undefined;
    if (m.prop && (!prop || READ_ONLY_TYPES.has(prop.type))) return;
    try {
      if (slot.ref.kind === 'ydb') await this.ydbOp(slot, m, prop);
      else await this.sqliteOp(slot, m, prop);
    } catch (err) {
      void vscode.window.showErrorMessage(`YAMD: ${err instanceof Error ? err.message : String(err)}`);
    }
  }

  /** Converts a value from the preview to the property's type. */
  private coerce(prop: Property | undefined, value: unknown): unknown {
    if (!prop || value === null || value === undefined || value === '') return undefined;
    switch (prop.type) {
      case 'number': {
        const n = Number(value);
        if (Number.isNaN(n)) throw new Error(`"${String(value)}" is not a number.`);
        return n;
      }
      case 'checkbox':
        return value === true || value === 'true';
      case 'multi_select':
      case 'relation':
        return Array.isArray(value) ? value.map(String) : String(value).split(',').map((s) => s.trim()).filter(Boolean);
      case 'date':
        if (!/^\d{4}-\d{2}-\d{2}/.test(String(value))) throw new Error(`"${String(value)}" is not a date.`);
        return String(value);
      default:
        return String(value);
    }
  }

  /** Values for a new row: the board column's value, or `Prop = 'x'` conditions of the view's filter. */
  private defaults(slot: SlotState, m: DbMessage): Record<string, unknown> {
    const values: Record<string, unknown> = {};
    for (const match of (slot.settings.filter ?? '').matchAll(/"?([\p{L}\p{N}_ ]+?)"?\s*=\s*'([^']*)'/gu)) {
      const p = slot.properties.find((x) => x.name === match[1]?.trim());
      if (p && !READ_ONLY_TYPES.has(p.type)) values[p.name] = this.coerce(p, match[2]);
    }
    const group = slot.settings.group ? slot.properties.find((p) => p.name === slot.settings.group) : undefined;
    if (group && m.groupValue !== undefined && m.groupValue !== null) values[group.name] = this.coerce(group, m.groupValue);
    const title = slot.properties.find((p) => p.type === 'title');
    if (title && values[title.name] === undefined) values[title.name] = 'Untitled';
    return values;
  }

  private async applyYdb(file: string, edit: YdbEdit | null): Promise<boolean> {
    if (!edit) {
      void vscode.window.showWarningMessage('YAMD: The database changed; the preview has been refreshed.');
      this.fire(file);
      return false;
    }
    const doc = await vscode.workspace.openTextDocument(vscode.Uri.file(file));
    const wsEdit = new vscode.WorkspaceEdit();
    if (edit.endLine < edit.startLine) {
      const at = edit.startLine >= doc.lineCount ? doc.lineAt(doc.lineCount - 1).range.end : new vscode.Position(edit.startLine, 0);
      wsEdit.insert(doc.uri, at, edit.startLine >= doc.lineCount ? `\n${edit.text}` : `${edit.text}\n`);
    } else {
      const end = doc.lineAt(Math.min(edit.endLine, doc.lineCount - 1)).range.end;
      // Deleting whole lines also removes the line break after them.
      const range =
        edit.text === '' && edit.endLine + 1 < doc.lineCount ? new vscode.Range(edit.startLine, 0, edit.endLine + 1, 0) : new vscode.Range(edit.startLine, 0, end.line, end.character);
      wsEdit.replace(doc.uri, range, edit.text);
    }
    const ok = await vscode.workspace.applyEdit(wsEdit);
    // A .ydb file is rarely opened directly, so leaving the edit unsaved risks it being silently
    // lost; a board move/cell edit/row add is a completed action, not in-progress typing.
    if (ok) await doc.save();
    this.log.appendLine(`${new Date().toISOString()} edited ${file}`);
    return ok;
  }

  private async ydbOp(slot: SlotState, m: DbMessage, prop: Property | undefined) {
    const file = slot.ref.file;
    const text = (await vscode.workspace.openTextDocument(vscode.Uri.file(file))).getText();
    const now = new Date().toISOString().replace(/\.\d+Z$/, 'Z');
    switch (m.op) {
      case 'set':
        if (prop && m.rowId) await this.applyYdb(file, setCell(text, m.rowId, prop.name, this.coerce(prop, m.value), now));
        break;
      case 'add': {
        const added = addRow(text, this.defaults(slot, m), now);
        if (added) await this.applyYdb(file, added.edit);
        break;
      }
      case 'delete': {
        if (!m.rowId) return;
        const ok = await vscode.window.showWarningMessage('Delete this row?', { modal: true }, 'Delete');
        if (ok) await this.applyYdb(file, deleteRow(text, m.rowId));
        break;
      }
      case 'move': {
        // A board move: set the column's value, then reorder when the view has no sort.
        const group = slot.settings.group ? slot.properties.find((p) => p.name === slot.settings.group) : undefined;
        if (!group || !m.rowId) return;
        let current = text;
        const value = this.coerce(group, m.groupValue);
        const set = setCell(current, m.rowId, group.name, value, now);
        if (set && JSON.stringify(loadYdb(current).db?.rows.find((r) => r.id === m.rowId)?.[group.name]) !== JSON.stringify(value)) {
          await this.applyYdb(file, set);
          current = (await vscode.workspace.openTextDocument(vscode.Uri.file(file))).getText();
        }
        if (!slot.settings.sort?.length && m.beforeId !== undefined) await this.applyYdb(file, moveRow(current, m.rowId, m.beforeId));
        break;
      }
      case 'saveView': {
        const name = await vscode.window.showInputBox({ prompt: 'Name for this view', value: 'My view' });
        if (!name) return;
        await this.applyYdb(file, saveView(text, name, { ...slot.settings, ...(m.sort ? { sort: m.sort } : {}) }));
        break;
      }
    }
  }

  /** The SQLite write path: changed-on-disk check, per-session confirmation, temp file and rename. */
  private async writeSqlite(ref: DatabaseRef, job: (source: Source) => Job): Promise<boolean> {
    const name = path.basename(ref.file);
    const loaded = this.loadedMtime.get(ref.file);
    if (loaded !== undefined && statSync(ref.file).mtimeMs !== loaded) {
      const reload = await vscode.window.showWarningMessage(`${name} changed on disk since YAMD loaded it. Reload it before editing.`, 'Reload');
      if (reload) this.fire(ref.file);
      return false;
    }
    if (!this.allowedWrites.has(ref.file)) {
      const allow = await vscode.window.showWarningMessage(`Allow YAMD to modify ${name}?`, { modal: true, detail: 'Writes are allowed for this file until you close VS Code.' }, 'Allow');
      if (allow !== 'Allow') return false;
      this.allowedWrites.add(ref.file);
    }
    const source = await this.source(ref);
    if ('code' in source) throw new Error(source.message);
    const result = await this.run(job(source));
    if (result.problem) throw new Error(result.problem.message);
    if (!result.bytes) return false;
    const temp = path.join(path.dirname(ref.file), `.${name}.yamd-${process.pid}.tmp`);
    writeFileSync(temp, result.bytes);
    renameSync(temp, ref.file);
    this.loadedMtime.set(ref.file, statSync(ref.file).mtimeMs);
    this.log.appendLine(`${new Date().toISOString()} wrote ${ref.file} (${result.changes ?? 0} change(s))`);
    this.fire(ref.file);
    return true;
  }

  private async sqliteOp(slot: SlotState, m: DbMessage, prop: Property | undefined) {
    const ref = slot.ref;
    const table = quoteId(ref.table ?? '');
    const now = new Date().toISOString();
    const touched = slot.properties.filter((p) => p.type === 'updated_time');
    const rowid = Number(m.rowId);
    switch (m.op) {
      case 'set': {
        if (!prop || Number.isNaN(rowid)) return;
        const sets = [`${quoteId(prop.name)} = ?`, ...touched.map((p) => `${quoteId(p.name)} = ?`)];
        const params = [toSqlValue(prop.type, this.coerce(prop, m.value)), ...touched.map(() => now), rowid];
        await this.writeSqlite(ref, (source) => ({ kind: 'write', source, sql: `UPDATE ${table} SET ${sets.join(', ')} WHERE rowid = ?`, params }));
        break;
      }
      case 'move': {
        const group = slot.settings.group ? slot.properties.find((p) => p.name === slot.settings.group) : undefined;
        if (!group || Number.isNaN(rowid)) return;
        await this.writeSqlite(ref, (source) => ({
          kind: 'write',
          source,
          sql: `UPDATE ${table} SET ${quoteId(group.name)} = ? WHERE rowid = ?`,
          params: [toSqlValue(group.type, this.coerce(group, m.groupValue)), rowid],
        }));
        break;
      }
      case 'add': {
        const values = this.defaults(slot, m);
        for (const p of slot.properties) if (p.type === 'created_time' || p.type === 'updated_time') values[p.name] = now;
        const props = slot.properties.filter((p) => values[p.name] !== undefined);
        const sql = props.length
          ? `INSERT INTO ${table} (${props.map((p) => quoteId(p.name)).join(', ')}) VALUES (${props.map(() => '?').join(', ')})`
          : `INSERT INTO ${table} DEFAULT VALUES`;
        await this.writeSqlite(ref, (source) => ({ kind: 'write', source, sql, params: props.map((p) => toSqlValue(p.type, values[p.name])) }));
        break;
      }
      case 'delete': {
        if (Number.isNaN(rowid)) return;
        const ok = await vscode.window.showWarningMessage('Delete this row?', { modal: true }, 'Delete');
        if (ok) await this.writeSqlite(ref, (source) => ({ kind: 'write', source, sql: `DELETE FROM ${table} WHERE rowid = ?`, params: [rowid] }));
        break;
      }
      case 'saveView': {
        const name = await vscode.window.showInputBox({ prompt: 'Name for this view', value: 'My view' });
        if (!name || !ref.table) return;
        const view = { ...slot.settings, ...(m.sort ? { sort: m.sort } : {}) };
        await this.writeSqlite(ref, (source) => ({ kind: 'meta', source, table: ref.table as string, patch: { views: { [name]: view } } }));
        break;
      }
    }
  }

  /** Cover images resolve from the database file's folder, inside the workspace only. */
  resolveCovers(html: string, doc: vscode.TextDocument, slot: string, toUri: (file: string) => string): string {
    const state = this.slots.get(doc.uri.toString())?.get(slot);
    const base = state ? path.dirname(state.ref.file) : path.dirname(doc.uri.fsPath);
    return html.replace(/src="yamd-cover:([^"]*)"/g, (_m, src: string) => {
      const raw = src.replace(/&amp;/g, '&');
      if (/^https?:/i.test(raw) || raw.startsWith('data:image/')) return `src="${src}"`;
      const file = path.resolve(base, decodeURIComponent(raw));
      const root = vscode.workspace.getWorkspaceFolder(vscode.Uri.file(file));
      return root && existsSync(file) ? `src="${escapeHtml(toUri(file))}"` : 'src=""';
    });
  }

  dispose() {
    void this.worker?.terminate();
    for (const t of this.textTimers.values()) clearTimeout(t);
    for (const d of this.disposables) d.dispose();
  }
}
