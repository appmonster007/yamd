import { existsSync, readFileSync } from 'node:fs';
import * as path from 'node:path';
import * as vscode from 'vscode';
import { lint, parse } from '../core';
import { WARM_MIN_CHARS, warmParse } from '../core/parser';
import type { LintOptions, Severity } from '../core';
import type { WorkspaceIndex } from '../workspace/index';
import { notePath } from '../workspace/index';
import { nodeFsAccess } from './fsAccess';

const SEVERITY: Record<Severity, vscode.DiagnosticSeverity> = {
  error: vscode.DiagnosticSeverity.Error,
  warning: vscode.DiagnosticSeverity.Warning,
  info: vscode.DiagnosticSeverity.Information,
};

const DEBOUNCE_MS = 300;
/** Most diagnostics shown for one note. */
const MAX_DIAGNOSTICS = 1000;
/** Checks against other notes can wait: they only change when some other note does. */
const CROSS_NOTE_DELAY_MS = 800;

/**
 * Builds the `fileExists` callback for a document: relative paths resolve from its folder first,
 * then from the workspace root; paths starting with `/` resolve from the workspace root.
 */
export function fileResolver(doc: vscode.TextDocument): ((p: string) => string | undefined) | undefined {
  if (doc.uri.scheme !== 'file') return undefined;
  const dir = path.dirname(doc.uri.fsPath);
  const root = vscode.workspace.getWorkspaceFolder(doc.uri)?.uri.fsPath;
  return (p: string) => {
    const candidates = p.startsWith('/')
      ? [root ? path.join(root, p) : p]
      : [path.resolve(dir, p), ...(root ? [path.resolve(root, p)] : [])];
    return candidates.find((c) => existsSync(c));
  };
}

export class DiagnosticsProvider implements vscode.Disposable {
  private readonly collection = vscode.languages.createDiagnosticCollection('yamd');
  private readonly timers = new Map<string, ReturnType<typeof setTimeout>>();
  /** When each waiting note will be checked (ms since the epoch). */
  private readonly due = new Map<string, number>();
  private readonly disposables: vscode.Disposable[] = [this.collection];

  constructor(private readonly index?: WorkspaceIndex) {
    this.disposables.push(
      // Links into other notes can break or heal when those notes change.
      // They're rechecked after things settle, once for all the changes in a burst.
      ...(index ? [index.onDidChange(() => this.scheduleAll())] : []),
      vscode.workspace.onDidOpenTextDocument((d) => void this.update(d)),
      vscode.workspace.onDidChangeTextDocument((e) => this.schedule(e.document)),
      vscode.workspace.onDidCloseTextDocument((d) => this.clear(d)),
      vscode.workspace.onDidChangeConfiguration((e) => {
        if (e.affectsConfiguration('yamd.diagnostics')) this.updateAll();
      }),
    );
    this.updateAll();
  }

  private updateAll() {
    for (const d of vscode.workspace.textDocuments) void this.update(d);
  }

  private scheduleAll() {
    for (const d of vscode.workspace.textDocuments) this.schedule(d, CROSS_NOTE_DELAY_MS);
  }

  private schedule(doc: vscode.TextDocument, delay = DEBOUNCE_MS) {
    if (doc.languageId !== 'yamd') return;
    const key = doc.uri.toString();
    const due = Date.now() + delay;
    const waiting = this.due.get(key);
    // Typing restarts the wait; a slower request (another note changed) never delays an earlier one.
    if (waiting !== undefined && waiting <= due && delay !== DEBOUNCE_MS) return;
    clearTimeout(this.timers.get(key));
    this.due.set(key, due);
    this.timers.set(
      key,
      setTimeout(() => {
        this.timers.delete(key);
        this.due.delete(key);
        void this.update(doc);
      }, delay),
    );
  }

  private async update(doc: vscode.TextDocument): Promise<void> {
    if (doc.languageId !== 'yamd' || doc.isClosed) return;
    const config = vscode.workspace.getConfiguration('yamd.diagnostics', doc.uri);
    if (!config.get<boolean>('enabled', true)) {
      this.collection.delete(doc.uri);
      return;
    }
    const ignore = new Set(config.get<string[]>('ignore', []));
    const text = doc.getText();
    const version = doc.version;
    // A large note is parsed ahead of time in short slices, so checking it doesn't freeze the editor.
    if (text.length >= WARM_MIN_CHARS) {
      await warmParse(text, () => doc.version === version);
      if (doc.version !== version || doc.isClosed) return;
    }
    const resolve = fileResolver(doc);
    const options: LintOptions = resolve ? { fileExists: (p) => resolve(p) !== undefined } : {};
    if (this.index && doc.uri.scheme === 'file') options.notes = { lookup: this.index.store, path: notePath(doc.uri) };
    if (doc.uri.scheme === 'file') {
      options.databases = {
        docPath: doc.uri.fsPath,
        fs: nodeFsAccess,
        readFile: (p) => {
          try {
            return readFileSync(p, 'utf8');
          } catch {
            return undefined;
          }
        },
      };
    }
    const results = lint(parse(text), options)
      .filter((d) => !ignore.has(d.code))
      // A huge note can have thousands of findings; the Problems panel stays usable with the first ones.
      .slice(0, MAX_DIAGNOSTICS)
      .map((d) => {
        const range = new vscode.Range(doc.positionAt(d.range.start), doc.positionAt(Math.max(d.range.end, d.range.start)));
        const diag = new vscode.Diagnostic(range, d.message, SEVERITY[d.severity]);
        diag.code = d.code;
        diag.source = 'yamd';
        return diag;
      });
    this.collection.set(doc.uri, results);
  }

  private clear(doc: vscode.TextDocument) {
    const key = doc.uri.toString();
    clearTimeout(this.timers.get(key));
    this.timers.delete(key);
    this.due.delete(key);
    this.collection.delete(doc.uri);
  }

  dispose() {
    for (const t of this.timers.values()) clearTimeout(t);
    for (const d of this.disposables) d.dispose();
  }
}
