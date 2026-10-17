/**
 * The workspace note index: every `.yamd` note, kept fresh from file watchers and unsaved edits.
 * Cross-note logic lives in `NoteStore` (src/core/notes.ts); this file only feeds it.
 */
import { existsSync } from 'node:fs';
import * as path from 'node:path';
import { Worker } from 'node:worker_threads';
import * as vscode from 'vscode';
import { NoteStore } from '../core/notes';
import type { ScanRequest, ScanResponse } from './indexWorker';

/** Notes larger than this are skipped. */
const MAX_BYTES = 2 * 1024 * 1024;
/** Notes loaded between pauses. Parsing is synchronous, so a small batch keeps the editor responsive. */
const BATCH = 10;
/** Notes sent to the index worker at a time. */
const WORKER_CHUNK = 100;
const EDIT_DEBOUNCE_MS = 300;
const CHANGE_DEBOUNCE_MS = 100;

/** The index's path for a URI: the file system path with `/` separators. */
export function notePath(uri: vscode.Uri): string {
  return uri.fsPath.split(path.sep).join('/');
}

export function noteUri(p: string): vscode.Uri {
  return vscode.Uri.file(p);
}

export class WorkspaceIndex implements vscode.Disposable {
  store: NoteStore;
  private readonly changed = new vscode.EventEmitter<void>();
  /** Fires (debounced) whenever notes are added, changed or removed. */
  readonly onDidChange = this.changed.event;
  private readonly disposables: vscode.Disposable[] = [this.changed];
  private readonly editTimers = new Map<string, ReturnType<typeof setTimeout>>();
  private changeTimer: ReturnType<typeof setTimeout> | undefined;
  private ready: Promise<void>;

  constructor(
    private readonly log: vscode.OutputChannel,
    private readonly extensionUri: vscode.Uri,
  ) {
    this.store = this.newStore();
    const watcher = vscode.workspace.createFileSystemWatcher('**/*.yamd');
    this.disposables.push(
      watcher,
      watcher.onDidCreate((uri) => void this.load(uri)),
      watcher.onDidChange((uri) => {
        // Open documents are tracked through their edits instead.
        if (!this.openDocument(uri)) void this.load(uri);
      }),
      watcher.onDidDelete((uri) => this.remove(uri)),
      vscode.workspace.onDidChangeTextDocument((e) => this.scheduleEdit(e.document)),
      vscode.workspace.onDidOpenTextDocument((d) => this.scheduleEdit(d)),
      vscode.workspace.onDidRenameFiles((e) => {
        for (const f of e.files) {
          this.removeTree(f.oldUri);
          void this.load(f.newUri);
        }
      }),
      vscode.workspace.onDidChangeWorkspaceFolders(() => void this.rebuild()),
      vscode.workspace.onDidChangeConfiguration((e) => {
        if (e.affectsConfiguration('yamd.index') || e.affectsConfiguration('yamd.templates') || e.affectsConfiguration('files.exclude')) {
          void this.rebuild();
        }
      }),
    );
    this.ready = this.scan();
  }

  /** Resolves once the first scan has finished. */
  whenReady(): Promise<void> {
    return this.ready;
  }

  private newStore(): NoteStore {
    const roots = (vscode.workspace.workspaceFolders ?? []).map((f) => notePath(f.uri));
    return new NoteStore(roots.length ? roots : [''], (p) => existsSync(p));
  }

  rebuild(): Promise<void> {
    this.store = this.newStore();
    this.ready = this.scan();
    return this.ready;
  }

  private excludeGlob(): string | undefined {
    const patterns: string[] = [];
    const files = vscode.workspace.getConfiguration('files').get<Record<string, boolean>>('exclude', {});
    for (const [glob, on] of Object.entries(files)) if (on) patterns.push(glob);
    patterns.push(...vscode.workspace.getConfiguration('yamd.index').get<string[]>('exclude', []));
    const templates = vscode.workspace.getConfiguration('yamd.templates').get<string>('folder', 'templates');
    if (templates) patterns.push(`**/${templates.replace(/^\/+|\/+$/g, '')}/**`);
    patterns.push('**/node_modules/**');
    return patterns.length ? `{${patterns.join(',')}}` : undefined;
  }

  /** Counts scans, so one that was replaced by a rebuild stops writing into the old store. */
  private scanGeneration = 0;

  private async scan(): Promise<void> {
    if (!vscode.workspace.workspaceFolders?.length) return;
    const generation = ++this.scanGeneration;
    await vscode.window.withProgress(
      { location: vscode.ProgressLocation.Window, title: 'YAMD: Indexing notes' },
      async (progress) => {
        const found = await vscode.workspace.findFiles('**/*.yamd', this.excludeGlob());
        const uris = found.filter((u) => u.scheme === 'file' && !this.excluded(u));
        // Open notes may have unsaved edits that only the editor knows about, so the host loads those.
        const open = new Set(vscode.workspace.textDocuments.map((d) => d.uri.toString()));
        const fromEditor = uris.filter((u) => open.has(u.toString()));
        const fromDisk = uris.filter((u) => !open.has(u.toString())).map(notePath);
        const total = uris.length;
        let done = 0;
        const report = (n: number) => {
          done += n;
          progress.report({ message: `${done}/${total}` });
        };
        const rest = await this.scanInWorker(fromDisk, generation, report);
        // Anything the worker couldn't do (or all of it, if it couldn't start) runs here, in small batches.
        const hostWork = [...fromEditor, ...rest.map((p) => noteUri(p))];
        for (let i = 0; i < hostWork.length && generation === this.scanGeneration; i += BATCH) {
          await Promise.all(hostWork.slice(i, i + BATCH).map((u) => this.load(u, false)));
          report(Math.min(BATCH, hostWork.length - i));
          // Let the extension host handle other work between batches.
          await new Promise((resolve) => setImmediate(resolve));
        }
        if (generation === this.scanGeneration) this.log.appendLine(`Indexed ${this.store.size} notes.`);
      },
    );
    this.fire();
  }

  /**
   * Reads and parses notes in a worker thread, so a large workspace doesn't stall the editor.
   * Returns the paths that still need loading (those after a worker failure).
   */
  private scanInWorker(paths: string[], generation: number, report: (n: number) => void): Promise<string[]> {
    if (!paths.length) return Promise.resolve([]);
    const store = this.store;
    return new Promise((resolve) => {
      let worker: Worker;
      try {
        worker = new Worker(vscode.Uri.joinPath(this.extensionUri, 'dist', 'indexWorker.js').fsPath);
      } catch {
        resolve(paths);
        return;
      }
      let next = 0;
      let finished = false;
      const inFlight = new Map<number, string[]>();
      const finish = (remaining: string[]) => {
        if (finished) return;
        finished = true;
        void worker.terminate();
        resolve(remaining);
      };
      const send = () => {
        if (next >= paths.length) return;
        const chunk = paths.slice(next, next + WORKER_CHUNK);
        next += chunk.length;
        const id = next;
        inFlight.set(id, chunk);
        worker.postMessage({ id, paths: chunk } satisfies ScanRequest);
      };
      worker.on('message', (m: ScanResponse) => {
        inFlight.delete(m.id);
        if (generation !== this.scanGeneration) return finish([]);
        for (const item of m.items) {
          if ('summary' in item) store.setSummarized(item.path, item.text, item.summary);
          else if (item.skipped === 'large') this.log.appendLine(`Skipped ${item.path}: larger than 2 MB.`);
        }
        report(m.items.length);
        if (next < paths.length) {
          // Keep one chunk queued behind the one being parsed, and let the host breathe between them.
          setImmediate(send);
        } else if (inFlight.size === 0) finish([]);
      });
      // If the worker dies, the notes it hadn't returned are loaded on the host instead.
      worker.on('error', (err) => {
        this.log.appendLine(`Index worker failed (${err.message}); continuing on the main thread.`);
        finish([...[...inFlight.values()].flat(), ...paths.slice(next)]);
      });
      worker.on('exit', () => finish([...[...inFlight.values()].flat(), ...paths.slice(next)]));
      send();
      send();
    });
  }

  private openDocument(uri: vscode.Uri): vscode.TextDocument | undefined {
    return vscode.workspace.textDocuments.find((d) => d.uri.toString() === uri.toString());
  }

  private excluded(uri: vscode.Uri): boolean {
    if (!vscode.workspace.getWorkspaceFolder(uri)) return true;
    const rel = vscode.workspace.asRelativePath(uri, false);
    const templates = vscode.workspace.getConfiguration('yamd.templates').get<string>('folder', 'templates');
    if (templates && (rel === templates || rel.startsWith(`${templates.replace(/\/+$/, '')}/`) || rel.includes(`/${templates}/`))) return true;
    const globs = vscode.workspace.getConfiguration('yamd.index').get<string[]>('exclude', []);
    return globs.some((g) => globToRegExp(g).test(rel));
  }

  private async load(uri: vscode.Uri, notify = true): Promise<void> {
    if (uri.scheme !== 'file' || !uri.path.endsWith('.yamd') || this.excluded(uri)) return;
    const doc = this.openDocument(uri);
    let text: string;
    if (doc) {
      text = doc.getText();
    } else {
      try {
        const stat = await vscode.workspace.fs.stat(uri);
        if (stat.size > MAX_BYTES) {
          this.log.appendLine(`Skipped ${uri.fsPath}: larger than 2 MB.`);
          return;
        }
        text = new TextDecoder().decode(await vscode.workspace.fs.readFile(uri));
      } catch {
        return;
      }
    }
    if (text.length > MAX_BYTES) return;
    this.store.set(notePath(uri), text);
    if (notify) this.fire();
  }

  private scheduleEdit(doc: vscode.TextDocument) {
    if (doc.languageId !== 'yamd' || doc.uri.scheme !== 'file' || this.excluded(doc.uri)) return;
    const key = doc.uri.toString();
    clearTimeout(this.editTimers.get(key));
    this.editTimers.set(
      key,
      setTimeout(() => {
        this.editTimers.delete(key);
        if (doc.isClosed) return;
        this.store.set(notePath(doc.uri), doc.getText());
        this.fire();
      }, EDIT_DEBOUNCE_MS),
    );
  }

  private remove(uri: vscode.Uri) {
    this.store.delete(notePath(uri));
    this.fire();
  }

  /** Removes a note, or every note under a folder. */
  private removeTree(uri: vscode.Uri) {
    const p = notePath(uri);
    for (const note of this.store.paths()) if (note === p || note.startsWith(`${p}/`)) this.store.delete(note);
    this.fire();
  }

  private fire() {
    clearTimeout(this.changeTimer);
    this.changeTimer = setTimeout(() => this.changed.fire(), CHANGE_DEBOUNCE_MS);
  }

  dispose() {
    clearTimeout(this.changeTimer);
    for (const t of this.editTimers.values()) clearTimeout(t);
    for (const d of this.disposables) d.dispose();
  }
}

/** Converts a simple glob (`*`, `**`, `?`, `{a,b}`) to a regular expression on relative paths. */
export function globToRegExp(glob: string): RegExp {
  let re = '';
  for (let i = 0; i < glob.length; i++) {
    const c = glob[i] as string;
    if (c === '*') {
      if (glob[i + 1] === '*') {
        re += glob[i + 2] === '/' ? '(?:.*/)?' : '.*';
        i += glob[i + 2] === '/' ? 2 : 1;
      } else re += '[^/]*';
    } else if (c === '?') re += '[^/]';
    else if (c === '{') re += '(?:';
    else if (c === '}') re += ')';
    else if (c === ',') re += '|';
    else re += c.replace(/[.+^$()|[\]\\]/g, '\\$&');
  }
  return new RegExp(`^${re}$`);
}
