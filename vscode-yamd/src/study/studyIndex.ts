import { readFile, stat } from 'node:fs/promises';
import * as vscode from 'vscode';
import { toInternal } from '../core/markdown/compat';
import { summarize } from '../core/notes/noteSummary';
import type { NoteSummary } from '../core/notes/noteSummary';

const MAX_BYTES = 2_000_000;
const EXCLUDE = '**/{node_modules,.git,.yamd}/**';

/** The Markdown notes in the workspace, kept fresh from file watchers and unsaved edits, for the study tools. */
export class StudyIndex implements vscode.Disposable {
  private readonly notes = new Map<string, { text: string; summary: NoteSummary }>();
  private readonly emitter = new vscode.EventEmitter<void>();
  private readonly ready: Promise<void>;
  private readonly timers = new Map<string, ReturnType<typeof setTimeout>>();
  private readonly disposables: vscode.Disposable[] = [this.emitter];
  readonly onDidChange = this.emitter.event;

  readonly store = {
    paths: () => [...this.notes.keys()],
    read: (path: string) => this.notes.get(path)?.text,
    summaries: () => [...this.notes.values()].map((n) => n.summary),
  };

  constructor() {
    this.ready = this.scan();
    const watcher = vscode.workspace.createFileSystemWatcher('**/*.md');
    this.disposables.push(
      watcher,
      watcher.onDidCreate((u) => void this.load(u.fsPath)),
      watcher.onDidChange((u) => void this.load(u.fsPath)),
      watcher.onDidDelete((u) => this.remove(u.fsPath)),
      // Unsaved edits count too.
      vscode.workspace.onDidChangeTextDocument((e) => {
        const d = e.document;
        if (d.languageId !== 'markdown' || d.uri.scheme !== 'file') return;
        const key = d.uri.fsPath;
        clearTimeout(this.timers.get(key));
        this.timers.set(key, setTimeout(() => this.set(key, d.getText()), 400));
      }),
    );
  }

  whenReady(): Promise<void> {
    return this.ready;
  }

  private async scan() {
    const files = await vscode.workspace.findFiles('**/*.md', EXCLUDE);
    await Promise.all(files.filter((u) => u.scheme === 'file').map((u) => this.load(u.fsPath, false)));
    this.emitter.fire();
  }

  private async load(path: string, notify = true) {
    try {
      if ((await stat(path)).size > MAX_BYTES) return;
      this.set(path, await readFile(path, 'utf8'), notify);
    } catch {
      this.remove(path);
    }
  }

  private set(path: string, text: string, notify = true) {
    this.notes.set(path, { text, summary: summarize(path, toInternal(text)) });
    if (notify) this.emitter.fire();
  }

  private remove(path: string) {
    if (this.notes.delete(path)) this.emitter.fire();
  }

  dispose() {
    for (const t of this.timers.values()) clearTimeout(t);
    for (const d of this.disposables) d.dispose();
  }
}
