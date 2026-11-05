import * as path from 'node:path';
import * as vscode from 'vscode';
import { escapeHtml, parse, render } from '../../core/markdown';
import type { RenderOptions } from '../../core/markdown';
import type { BoardEditMessage } from '../../core/widgets/boardEdit';
import type { WidgetBlock } from '../../core/widgets/fences';
import { scanWidgets } from '../../core/widgets/fences';
import { applyBlockEdit, syntheticSource } from './editBlock';
import { highlight, renderMath } from '../shared/richLoader';
import { querySource, renderQueryWidget } from '../query/queryWidget';
import { nonce } from '../shared/webviewShell';
import { fileResolver, linesOf, MARKDOWN, widgetsOf } from './widgets';

const BOARD_TYPES = new Set(['kanban', 'calendar', 'timeline', 'gallery']);

interface Entry {
  panel: vscode.WebviewPanel;
  uri: vscode.Uri;
  type: string;
  id: string | undefined;
  ordinal: number;
  ready: boolean;
  timer?: ReturnType<typeof setTimeout>;
  watcher?: vscode.FileSystemWatcher;
  /** The month a calendar panel is showing; undefined means its default. */
  month?: string;
}

/** One widget preview per (note, block): shows a block with the fixed widget design and edits the note through it. */
class WidgetPanels implements vscode.Disposable {
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
    // A query widget follows its data file: it refreshes whenever the file changes (nothing in it is editable).
    const source = block.type === 'sql' ? querySource(doc, block) : undefined;
    if (source) {
      const watcher = vscode.workspace.createFileSystemWatcher(new vscode.RelativePattern(vscode.Uri.file(path.dirname(source.fsPath)), path.basename(source.fsPath)));
      const again = () => this.schedule(entry);
      watcher.onDidChange(again);
      watcher.onDidCreate(again);
      watcher.onDidDelete(again);
      entry.watcher = watcher;
    }
    panel.onDidDispose(() => {
      clearTimeout(entry.timer);
      entry.watcher?.dispose();
      this.entries.delete(key);
    });
    panel.webview.onDidReceiveMessage((m: { type: string }) => void this.onMessage(entry, m));
    panel.webview.html = this.shell(panel.webview);
  }

  private find(entry: Entry, doc: vscode.TextDocument): WidgetBlock | undefined {
    const all = scanWidgets(linesOf(doc));
    return (entry.id !== undefined ? all.find((w) => w.id === entry.id) : undefined) ?? all.find((w) => w.type === entry.type && w.ordinal === entry.ordinal);
  }

  private schedule(entry: Entry, doc?: vscode.TextDocument) {
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
      ...(entry.month ? { month: entry.month } : {}),
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
    } else if (m.type === 'calendarMonth') {
      const month = (m as unknown as { month: string }).month;
      entry.month = /^\d{4}-\d{2}$/.test(month) ? month : undefined;
      await this.refresh(entry, true);
    } else if (m.type === 'link') {
      const href = (m as unknown as { href: string }).href;
      if (/^https?:/i.test(href)) await vscode.env.openExternal(vscode.Uri.parse(href));
    }
  }

  private async applyEdit(entry: Entry, m: BoardEditMessage) {
    if (!vscode.workspace.isTrusted) return;
    const doc = await vscode.workspace.openTextDocument(entry.uri);
    const block = this.find(entry, doc);
    if (!block) return;
    // If the note changed since the widget rendered it, or the edit was refused, show the current state instead.
    if (!(await applyBlockEdit(doc, block, m))) await this.refresh(entry, true, doc);
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
      e.watcher?.dispose();
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
    const extra: Record<string, { title: string; command: string }> = {
      kanban: { title: '$(add) Add card', command: 'yamd.addCard' },
      calendar: { title: '$(add) Add event', command: 'yamd.addEvent' },
      timeline: { title: '$(add) Add item', command: 'yamd.addTimelineItem' },
      gallery: { title: '$(add) Add image', command: 'yamd.addImage' },
      sql: { title: '$(play) Run query', command: 'yamd.runQuery' },
    };
    return widgetsOf(doc).flatMap((w) => {
      const range = new vscode.Range(w.startLine, 0, w.startLine, 0);
      const lenses = [new vscode.CodeLens(range, { title: `$(layout) Open ${w.type}: ${w.label}`, command: 'yamd.openWidget', arguments: [doc.uri, w.startLine] })];
      const more = extra[w.type];
      if (more) lenses.push(new vscode.CodeLens(range, { title: more.title, command: more.command, arguments: [doc.uri, w.startLine] }));
      return lenses;
    });
  }
}

/** The palette commands that mirror the CodeLens above each kind of block. */
const OPEN_COMMANDS: { command: string; type: string }[] = [
  { command: 'yamd.openKanban', type: 'kanban' },
  { command: 'yamd.openCalendar', type: 'calendar' },
  { command: 'yamd.openTimeline', type: 'timeline' },
  { command: 'yamd.openGallery', type: 'gallery' },
  { command: 'yamd.openQuery', type: 'sql' },
];

/**
 * Opens a widget from the Command Palette: the block under the cursor if there is one, else the only
 * block of that type, else a picker. With no `type`, every widget in the note is a choice.
 */
async function openFromPalette(panels: WidgetPanels, type?: string): Promise<void> {
  const editor = vscode.window.activeTextEditor;
  const doc = editor?.document;
  if (!editor || !doc || doc.languageId !== 'markdown') {
    void vscode.window.showInformationMessage('YAMD: Open a Markdown note first.');
    return;
  }
  const all = widgetsOf(doc);
  const here = all.find((w) => w.startLine <= editor.selection.active.line && editor.selection.active.line <= w.endLine && (!type || w.type === type));
  if (here) return panels.open(doc.uri, here.startLine);
  const widgets = type ? all.filter((w) => w.type === type) : all;
  const name = type === 'sql' ? 'query' : (type ?? 'widget');
  if (!widgets.length) {
    void vscode.window.showInformationMessage(`YAMD: This note has no ${name} blocks. Use "YAMD: Insert Widget" to add one.`);
    return;
  }
  if (widgets.length === 1 && type) return panels.open(doc.uri, (widgets[0] as { startLine: number }).startLine);
  const pick = await vscode.window.showQuickPick(widgets.map((w) => ({ label: w.label, description: w.type, detail: `line ${w.startLine + 1}`, w })), { placeHolder: `Open which ${name}?` });
  if (pick) await panels.open(doc.uri, pick.w.startLine);
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
      await openFromPalette(panels);
    }),
    // One command per CodeLens action, so each is also in the Command Palette: Open Kanban, Open Query, …
    ...OPEN_COMMANDS.map(({ command, type }) => vscode.commands.registerCommand(command, () => openFromPalette(panels, type))),
  );
}
