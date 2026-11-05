import * as vscode from 'vscode';
import { scanWidgets } from '../core/fences';
import type { WidgetBlock } from '../core/fences';
import { escapeHtml } from '../core';

const MARKDOWN = { language: 'markdown' } as const;

function widgetsOf(doc: vscode.TextDocument): WidgetBlock[] {
  const lines: string[] = [];
  for (let i = 0; i < doc.lineCount; i++) lines.push(doc.lineAt(i).text);
  return scanWidgets(lines);
}

/** A CodeLens above every widget fence: "Open kanban: sprint-12". */
class WidgetLensProvider implements vscode.CodeLensProvider {
  private readonly changed = new vscode.EventEmitter<void>();
  readonly onDidChangeCodeLenses = this.changed.event;

  refresh() {
    this.changed.fire();
  }

  provideCodeLenses(doc: vscode.TextDocument): vscode.CodeLens[] {
    return widgetsOf(doc).map((w) => {
      const range = new vscode.Range(w.startLine, 0, w.startLine, 0);
      return new vscode.CodeLens(range, {
        title: `$(layout) Open ${w.type}: ${w.label}`,
        command: 'yamd.openWidget',
        arguments: [doc.uri, w.startLine],
      });
    });
  }
}

/** Spike panel: shows one widget block's source beside the note and follows edits to it. */
class WidgetPanels implements vscode.Disposable {
  private readonly panels = new Map<string, { panel: vscode.WebviewPanel; uri: vscode.Uri; startLine: number }>();
  private readonly listener: vscode.Disposable;

  constructor() {
    this.listener = vscode.workspace.onDidChangeTextDocument((e) => {
      for (const entry of this.panels.values()) if (entry.uri.toString() === e.document.uri.toString()) void this.render(entry.panel, e.document, entry.startLine);
    });
  }

  async open(uri: vscode.Uri, startLine: number) {
    const doc = await vscode.workspace.openTextDocument(uri);
    const block = widgetsOf(doc).find((w) => w.startLine === startLine);
    if (!block) return;
    // The key is the block's id (or position label), so reopening finds the same panel.
    const key = `${uri.toString()}#${block.label}`;
    const existing = this.panels.get(key);
    if (existing) {
      existing.startLine = block.startLine;
      existing.panel.reveal(vscode.ViewColumn.Beside, true);
      return;
    }
    const panel = vscode.window.createWebviewPanel('yamd.widget', block.label, { viewColumn: vscode.ViewColumn.Beside, preserveFocus: true }, { enableScripts: false });
    const entry = { panel, uri, startLine: block.startLine };
    this.panels.set(key, entry);
    panel.onDidDispose(() => this.panels.delete(key));
    await this.render(panel, doc, block.startLine);
  }

  private async render(panel: vscode.WebviewPanel, doc: vscode.TextDocument, startLine: number) {
    const block = widgetsOf(doc).find((w) => w.startLine === startLine) ?? widgetsOf(doc).find((w) => w.label === panel.title);
    if (!block) {
      panel.webview.html = '<body><p>This block no longer exists in the note.</p></body>';
      return;
    }
    const entry = [...this.panels.values()].find((p) => p.panel === panel);
    if (entry) entry.startLine = block.startLine;
    const body: string[] = [];
    for (let l = block.bodyStartLine; l <= block.bodyEndLine; l++) body.push(doc.lineAt(l).text);
    panel.title = block.label;
    panel.webview.html = `<!DOCTYPE html><html><body style="font-family: var(--vscode-font-family); padding: 1em">
<h3>${escapeHtml(block.type)}: ${escapeHtml(block.label)}</h3>
<p style="opacity:.7">Spike: lines ${block.startLine + 1}–${block.endLine + 1} of ${escapeHtml(vscode.workspace.asRelativePath(doc.uri))}</p>
<pre>${escapeHtml(body.join('\n'))}</pre></body></html>`;
  }

  dispose() {
    this.listener.dispose();
    for (const { panel } of [...this.panels.values()]) panel.dispose();
  }
}

export function registerWidgetLens(context: vscode.ExtensionContext): void {
  const lens = new WidgetLensProvider();
  const panels = new WidgetPanels();
  context.subscriptions.push(
    panels,
    vscode.languages.registerCodeLensProvider(MARKDOWN, lens),
    vscode.workspace.onDidChangeTextDocument((e) => {
      if (e.document.languageId === 'markdown') lens.refresh();
    }),
    vscode.commands.registerCommand('yamd.openWidget', (uri: vscode.Uri, startLine: number) => panels.open(uri, startLine)),
  );
}
