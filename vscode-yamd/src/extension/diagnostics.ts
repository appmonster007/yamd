import { existsSync } from 'node:fs';
import * as path from 'node:path';
import * as vscode from 'vscode';
import { lint, parse } from '../core';
import type { LintOptions, Severity } from '../core';
import type { WorkspaceIndex } from '../workspace/index';
import { notePath } from '../workspace/index';

const SEVERITY: Record<Severity, vscode.DiagnosticSeverity> = {
  error: vscode.DiagnosticSeverity.Error,
  warning: vscode.DiagnosticSeverity.Warning,
  info: vscode.DiagnosticSeverity.Information,
};

const DEBOUNCE_MS = 300;

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
  private readonly disposables: vscode.Disposable[] = [this.collection];

  constructor(private readonly index?: WorkspaceIndex) {
    this.disposables.push(
      // Links into other notes can break or heal when those notes change.
      ...(index ? [index.onDidChange(() => this.updateAll())] : []),
      vscode.workspace.onDidOpenTextDocument((d) => this.update(d)),
      vscode.workspace.onDidChangeTextDocument((e) => this.schedule(e.document)),
      vscode.workspace.onDidCloseTextDocument((d) => this.clear(d)),
      vscode.workspace.onDidChangeConfiguration((e) => {
        if (e.affectsConfiguration('yamd.diagnostics')) this.updateAll();
      }),
    );
    this.updateAll();
  }

  private updateAll() {
    for (const d of vscode.workspace.textDocuments) this.update(d);
  }

  private schedule(doc: vscode.TextDocument) {
    if (doc.languageId !== 'yamd') return;
    const key = doc.uri.toString();
    clearTimeout(this.timers.get(key));
    this.timers.set(
      key,
      setTimeout(() => {
        this.timers.delete(key);
        this.update(doc);
      }, DEBOUNCE_MS),
    );
  }

  private update(doc: vscode.TextDocument) {
    if (doc.languageId !== 'yamd' || doc.isClosed) return;
    const config = vscode.workspace.getConfiguration('yamd.diagnostics', doc.uri);
    if (!config.get<boolean>('enabled', true)) {
      this.collection.delete(doc.uri);
      return;
    }
    const ignore = new Set(config.get<string[]>('ignore', []));
    const resolve = fileResolver(doc);
    const options: LintOptions = resolve ? { fileExists: (p) => resolve(p) !== undefined } : {};
    if (this.index && doc.uri.scheme === 'file') options.notes = { lookup: this.index.store, path: notePath(doc.uri) };
    const results = lint(parse(doc.getText()), options)
      .filter((d) => !ignore.has(d.code))
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
    this.collection.delete(doc.uri);
  }

  dispose() {
    for (const t of this.timers.values()) clearTimeout(t);
    for (const d of this.disposables) d.dispose();
  }
}
