import * as path from 'node:path';
import { readdirSync } from 'node:fs';
import * as vscode from 'vscode';
import { escapeHtml, parse, render } from '../core';
import type { RenderOptions } from '../core';
import { computeBoardEdit } from '../core/boardEdit';
import type { BoardEditMessage } from '../core/boardEdit';
import type { WidgetBlock } from '../core/fences';
import { scanWidgets } from '../core/fences';
import { bodyEdit } from '../core/widgetBody';
import { highlight, renderMath } from './richLoader';
import { renderQueryWidget } from './queryWidget';
import { nonce } from './webviewShell';
import { fileResolver, linesOf, MARKDOWN, widgetsOf } from './widgets';

const BOARD_TYPES = new Set(['kanban', 'calendar', 'timeline', 'gallery']);
const IMAGE_FILE = /\.(png|jpe?g|gif|webp|svg|avif|bmp)$/i;

/** The note's block as a one-container document, so the board renderer and its edit logic apply unchanged. */
export function syntheticSource(doc: vscode.TextDocument, block: WidgetBlock): string {
  const body: string[] = [];
  for (let l = block.bodyStartLine; l <= block.bodyEndLine; l++) body.push(doc.lineAt(l).text);
  if (block.type === 'gallery' && block.attrs['source'] && body.every((l) => l.trim() === '')) body.push(...folderImages(doc, block.attrs['source']));
  return [`:::${block.type}`, ...body, ':::'].join('\n');
}

/** Markdown image lines for the images in a folder next to the note. */
function folderImages(doc: vscode.TextDocument, source: string): string[] {
  if (doc.uri.scheme !== 'file') return [];
  const dir = path.resolve(path.dirname(doc.uri.fsPath), source);
  try {
    return readdirSync(dir)
      .filter((f) => IMAGE_FILE.test(f))
      .sort()
      .map((f) => `- ![${f.replace(/\.[^.]+$/, '')}](${path.posix.join(source.replace(/\\/g, '/'), f)})`);
  } catch {
    return [];
  }
}

interface Entry {
  panel: vscode.WebviewPanel;
  uri: vscode.Uri;
  type: string;
  id: string | undefined;
  ordinal: number;
  ready: boolean;
  timer?: ReturnType<typeof setTimeout>;
}

/** One widget preview per (note, block): shows a block with the fixed widget design and edits the note through it. */
export class WidgetPanels implements vscode.Disposable {
  private readonly entries = new Map<string, Entry>();
  private readonly disposables: vscode.Disposable[] = [];

  constructor(private readonly extensionUri: vscode.Uri) {
    this.disposables.push(
      vscode.workspace.onDidChangeTextDocument((e) => {
        for (const entry of this.entries.values()) if (entry.uri.toString() === e.document.uri.toString()) this.schedule(entry, e.document);
      }),
      vscode.workspace.onDidGrantWorkspaceTrust(() => {
        for (const entry of this.entries.values()) void this.refresh(entry, true);
      }),
    );
  }

  async open(uri: vscode.Uri, startLine: number): Promise<void> {
    const doc = await vscode.workspace.openTextDocument(uri);
    const block = widgetsOf(doc).find((w) => w.startLine === startLine);
    if (!block) return;
    const key = `${uri.toString()}#${block.id ?? `${block.type}:${block.ordinal}`}`;
    const existing = this.entries.get(key);
    if (existing) {
      existing.panel.reveal(vscode.ViewColumn.Beside, true);
      return;
    }
    const roots = [vscode.Uri.joinPath(this.extensionUri, 'dist'), vscode.Uri.joinPath(this.extensionUri, 'media')];
    for (const f of vscode.workspace.workspaceFolders ?? []) roots.push(f.uri);
    if (uri.scheme === 'file') roots.push(vscode.Uri.file(path.dirname(uri.fsPath)));
    const panel = vscode.window.createWebviewPanel('yamd.widget', block.label, { viewColumn: vscode.ViewColumn.Beside, preserveFocus: true }, { enableScripts: true, retainContextWhenHidden: true, localResourceRoots: roots });
    const entry: Entry = { panel, uri, type: block.type, id: block.id, ordinal: block.ordinal, ready: false };
    this.entries.set(key, entry);
    panel.onDidDispose(() => {
      clearTimeout(entry.timer);
      this.entries.delete(key);
    });
    panel.webview.onDidReceiveMessage((m: { type: string }) => void this.onMessage(entry, m));
    panel.webview.html = this.shell(panel.webview);
  }

  private find(entry: Entry, doc: vscode.TextDocument): WidgetBlock | undefined {
    const all = scanWidgets(linesOf(doc));
    return (entry.id !== undefined ? all.find((w) => w.id === entry.id) : undefined) ?? all.find((w) => w.type === entry.type && w.ordinal === entry.ordinal);
  }

  private schedule(entry: Entry, doc: vscode.TextDocument) {
    clearTimeout(entry.timer);
    entry.timer = setTimeout(() => void this.refresh(entry, false, doc), 150);
  }

  private async refresh(entry: Entry, full: boolean, known?: vscode.TextDocument) {
    const doc = known ?? (await vscode.workspace.openTextDocument(entry.uri));
    const block = this.find(entry, doc);
    if (!block) {
      void entry.panel.webview.postMessage({ type: 'update', full: true, html: '<div class="db-error" role="alert"><span class="db-error-code">Gone</span> This block no longer exists in the note.</div>' });
      return;
    }
    entry.id = block.id;
    entry.ordinal = block.ordinal;
    entry.panel.title = block.label;
    const html = await this.renderBody(entry, doc, block);
    void entry.panel.webview.postMessage({ type: 'update', html, full });
  }

  private async renderBody(entry: Entry, doc: vscode.TextDocument, block: WidgetBlock): Promise<string> {
    if (block.type === 'sql') return renderQueryWidget(doc, block);
    const folderGallery = block.type === 'gallery' && block.attrs['source'] !== undefined && block.bodyEndLine < block.bodyStartLine;
    const resolve = fileResolver(doc);
    const options: RenderOptions = {
      interactive: vscode.workspace.isTrusted && block.closed && !folderGallery && vscode.workspace.fs.isWritableFileSystem(doc.uri.scheme) !== false,
      highlight,
      renderMath,
      resolveImage: (src) => {
        if (/^(https?|data):/i.test(src)) return src;
        const file = resolve?.(decodeURIComponent(src.split(/[?#]/)[0] ?? src));
        return file ? entry.panel.webview.asWebviewUri(vscode.Uri.file(file)).toString() : src;
      },
    };
    try {
      return render(parse(syntheticSource(doc, block)), options);
    } catch (err) {
      return `<div class="db-error" role="alert"><span class="db-error-code">Error</span> ${escapeHtml(err instanceof Error ? err.message : String(err))}</div>`;
    }
  }

  private async onMessage(entry: Entry, m: { type: string }) {
    if (m.type === 'ready') {
      entry.ready = true;
      await this.refresh(entry, true);
    } else if (m.type === 'boardEdit') {
      await this.applyEdit(entry, m as unknown as BoardEditMessage);
    } else if (m.type === 'link') {
      const href = (m as unknown as { href: string }).href;
      if (/^https?:/i.test(href)) await vscode.env.openExternal(vscode.Uri.parse(href));
    }
  }

  private async applyEdit(entry: Entry, m: BoardEditMessage) {
    if (!vscode.workspace.isTrusted) return;
    const doc = await vscode.workspace.openTextDocument(entry.uri);
    const block = this.find(entry, doc);
    if (!block || !block.closed || vscode.workspace.fs.isWritableFileSystem(doc.uri.scheme) === false) return;
    const synthetic = syntheticSource(doc, block);
    const edit = computeBoardEdit(synthetic, m);
    const change = edit ? bodyEdit(synthetic, edit, block.bodyStartLine) : null;
    if (!change) {
      // The note changed since the widget rendered it; show the current state instead.
      await this.refresh(entry, true, doc);
      return;
    }
    const range = new vscode.Range(change.startLine, 0, change.startLine + change.removeCount, 0);
    const text = change.lines.map((l) => `${l}\n`).join('');
    const workspaceEdit = new vscode.WorkspaceEdit();
    workspaceEdit.replace(doc.uri, range, text);
    if (await vscode.workspace.applyEdit(workspaceEdit)) {
      if (!doc.isUntitled) await doc.save();
    } else {
      await this.refresh(entry, true, doc);
    }
  }

  private shell(webview: vscode.Webview): string {
    const n = nonce();
    const script = webview.asWebviewUri(vscode.Uri.joinPath(this.extensionUri, 'dist', 'preview.js'));
    const style = webview.asWebviewUri(vscode.Uri.joinPath(this.extensionUri, 'media', 'preview.css'));
    const katex = webview.asWebviewUri(vscode.Uri.joinPath(this.extensionUri, 'dist', 'katex', 'katex.min.css'));
    const csp = ["default-src 'none'", `img-src ${webview.cspSource} https: http: data:`, `style-src ${webview.cspSource} 'unsafe-inline'`, `font-src ${webview.cspSource}`, `script-src 'nonce-${n}'`].join('; ');
    return `<!DOCTYPE html>
<html lang="en"><head><meta charset="UTF-8"><meta http-equiv="Content-Security-Policy" content="${csp}">
<meta name="viewport" content="width=device-width, initial-scale=1.0">
<link rel="stylesheet" href="${katex}"><link rel="stylesheet" href="${style}">
</head><body><main id="root" class="yamd-body"></main><script nonce="${n}" src="${script}"></script></body></html>`;
  }

  dispose() {
    for (const e of [...this.entries.values()]) {
      clearTimeout(e.timer);
      e.panel.dispose();
    }
    for (const d of this.disposables) d.dispose();
  }
}

/** A CodeLens above every widget fence: "Open kanban: sprint-12". */
class WidgetLensProvider implements vscode.CodeLensProvider {
  private readonly changed = new vscode.EventEmitter<void>();
  readonly onDidChangeCodeLenses = this.changed.event;

  refresh() {
    this.changed.fire();
  }

  provideCodeLenses(doc: vscode.TextDocument): vscode.CodeLens[] {
    return widgetsOf(doc).map(
      (w) => new vscode.CodeLens(new vscode.Range(w.startLine, 0, w.startLine, 0), { title: `$(layout) Open ${w.type}: ${w.label}`, command: 'yamd.openWidget', arguments: [doc.uri, w.startLine] }),
    );
  }
}

export function registerWidgetPanels(context: vscode.ExtensionContext): void {
  const panels = new WidgetPanels(context.extensionUri);
  const lens = new WidgetLensProvider();
  context.subscriptions.push(
    panels,
    vscode.languages.registerCodeLensProvider(MARKDOWN, lens),
    vscode.workspace.onDidChangeTextDocument((e) => {
      if (e.document.languageId === 'markdown') lens.refresh();
    }),
    vscode.commands.registerCommand('yamd.openWidget', async (uri?: vscode.Uri, startLine?: number) => {
      if (uri && startLine !== undefined) return panels.open(uri, startLine);
      const doc = vscode.window.activeTextEditor?.document;
      if (!doc || doc.languageId !== 'markdown') {
        void vscode.window.showInformationMessage('YAMD: Open a Markdown note first.');
        return;
      }
      const widgets = widgetsOf(doc);
      if (!widgets.length) {
        void vscode.window.showInformationMessage('YAMD: This note has no widget blocks. Use "YAMD: Insert Widget" to add one.');
        return;
      }
      const pick = await vscode.window.showQuickPick(widgets.map((w) => ({ label: w.label, description: w.type, detail: `line ${w.startLine + 1}`, w })), { placeHolder: 'Open which widget?' });
      if (pick) await panels.open(doc.uri, pick.w.startLine);
    }),
  );
}
