import * as path from 'node:path';
import * as vscode from 'vscode';
import { existsSync } from 'node:fs';
import { escapeHtml, parse, render, sanitizeUrl } from '../core';
import { WARM_MIN_CHARS, warmParse } from '../core/parser';
import type { RenderOptions } from '../core';
import { embedResolver } from '../core/embeds';

import { addCard, moveCard, renameCard, toggleTask } from '../core/kanbanEdit';
import type { LineEdit } from '../core/kanbanEdit';
import { resolveNote, splitTarget } from '../core/notes';
import { anchorLine, createNote } from '../workspace/features';
import type { WorkspaceIndex } from '../workspace/index';
import { notePath, noteUri } from '../workspace/index';
import type { DatabaseService, DbMessage } from './databases';
import { fileResolver } from './diagnostics';
import { highlight, renderMath } from './richLoader';
import { bibliographyFor } from '../study/bibliography';

const DEBOUNCE_MS = 150;
/** The most a very large note adds to the wait (about 3 MB of text reaches it). */
const MAX_EXTRA_DEBOUNCE_MS = 1500;

/** A card as the webview saw it: its first line and the hash of its source when rendered. */
interface CardRef {
  line: number;
  hash: string;
}

/** `source` is the path of an embedded note the element came from; without it, the previewed note. */
type FromWebview =
  | { type: 'link'; href: string; source?: string }
  | { type: 'ready' }
  | { type: 'toggleTask'; line: number; hash: string; done: boolean; source?: string }
  | { type: 'kanbanMove'; board: number; card: CardRef; toColumn: number; toIndex: number; source?: string }
  | { type: 'kanbanAdd'; board: number; column: number; text: string; source?: string }
  | { type: 'kanbanRename'; board: number; card: CardRef; title: string; source?: string }
  | DbMessage;

/** Messages that change the document; only accepted in trusted workspaces. */
const EDITS = new Set(['toggleTask', 'kanbanMove', 'kanbanAdd', 'kanbanRename']);

function nonce(): string {
  const chars = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789';
  return Array.from({ length: 32 }, () => chars[Math.floor(Math.random() * chars.length)]).join('');
}

/** A single preview panel that follows the active YAMD editor. */
export class PreviewManager implements vscode.Disposable {
  private panel: vscode.WebviewPanel | undefined;
  private document: vscode.TextDocument | undefined;
  private timer: ReturnType<typeof setTimeout> | undefined;
  private readonly disposables: vscode.Disposable[] = [];

  constructor(
    private readonly extensionUri: vscode.Uri,
    private readonly index?: WorkspaceIndex,
    private readonly db?: DatabaseService,
  ) {
    this.disposables.push(
      // Views and queries re-run when their data changes.
      ...(db
        ? [
            db.onDidChange((changed) => {
              if (this.document && db.affects(this.document, changed)) this.scheduleFill();
            }),
          ]
        : []),
      vscode.workspace.onDidChangeTextDocument((e) => {
        if (e.document === this.document) this.schedule();
      }),
      // Embedded notes may have changed.
      ...(index ? [index.onDidChange(() => this.schedule())] : []),
      vscode.window.onDidChangeActiveTextEditor((editor) => {
        if (this.panel && editor?.document.languageId === 'yamd' && editor.document !== this.document) {
          this.setDocument(editor.document);
        }
      }),
      vscode.workspace.onDidGrantWorkspaceTrust(() => void this.update()),
      vscode.window.onDidChangeTextEditorVisibleRanges((e) => {
        if (e.textEditor.document === this.document && e.visibleRanges[0]) {
          void this.panel?.webview.postMessage({ type: 'scroll', line: e.visibleRanges[0].start.line });
        }
      }),
    );
  }

  show(doc: vscode.TextDocument, toSide: boolean): void {
    const column = toSide ? vscode.ViewColumn.Beside : vscode.ViewColumn.Active;
    if (this.panel) {
      this.panel.reveal(column, toSide);
    } else {
      this.panel = vscode.window.createWebviewPanel(
        'yamd.preview',
        'Preview',
        { viewColumn: column, preserveFocus: toSide },
        { enableScripts: true, retainContextWhenHidden: true, enableFindWidget: true },
      );
      this.panel.onDidDispose(() => {
        this.panel = undefined;
        this.document = undefined;
      });
      this.panel.webview.onDidReceiveMessage((m: FromWebview) => this.onMessage(m));
      this.panel.webview.html = this.shell(this.panel.webview);
    }
    this.setDocument(doc);
  }

  private setDocument(doc: vscode.TextDocument) {
    if (!this.panel) return;
    if (this.document !== doc) this.lastHtml = undefined;
    this.document = doc;
    this.panel.title = `Preview ${path.basename(doc.uri.path)}`;
    this.panel.webview.options = { ...this.panel.webview.options, localResourceRoots: this.resourceRoots(doc) };
    void this.update();
  }

  private resourceRoots(doc: vscode.TextDocument): vscode.Uri[] {
    const roots = [vscode.Uri.joinPath(this.extensionUri, 'dist'), vscode.Uri.joinPath(this.extensionUri, 'media')];
    for (const folder of vscode.workspace.workspaceFolders ?? []) roots.push(folder.uri);
    if (doc.uri.scheme === 'file') roots.push(vscode.Uri.file(path.dirname(doc.uri.fsPath)));
    return roots;
  }

  private schedule() {
    clearTimeout(this.timer);
    // Bigger notes take longer to render and send, so they wait longer after the last keystroke.
    const length = this.document ? this.document.offsetAt(new vscode.Position(this.document.lineCount, 0)) : 0;
    const delay = DEBOUNCE_MS + Math.min(MAX_EXTRA_DEBOUNCE_MS, Math.floor(length / 2000));
    this.timer = setTimeout(() => void this.update(), delay);
  }

  private async update(): Promise<void> {
    const panel = this.panel;
    const doc = this.document;
    if (!panel || !doc) return;
    const text = doc.getText();
    const version = doc.version;

    const limit = vscode.workspace.getConfiguration('yamd.preview').get<number>('maxSizeKB', 8192) * 1024;
    if (text.length > limit) {
      const mb = (text.length / 1048576).toFixed(1);
      this.lastHtml = undefined;
      void panel.webview.postMessage({
        type: 'update',
        full: true,
        html: `<div class="db-error" role="alert"><span class="db-error-code">Large file</span> This note is ${mb} MB, which is over <code>yamd.preview.maxSizeKB</code>. Raise that setting to preview it.</div>`,
      });
      return;
    }
    // A large note is parsed ahead of time in short slices, so the editor stays responsive while it loads.
    if (text.length >= WARM_MIN_CHARS) {
      await warmParse(text, () => doc.version === version);
      // The note changed while that ran; its own update is already on the way.
      if (doc.version !== version || this.document !== doc || this.panel !== panel) return;
    }
    const docResolver = fileResolver(doc);
    const root = vscode.workspace.getWorkspaceFolder(doc.uri)?.uri.fsPath;
    // Images resolve from the folder of the note they appear in, which differs inside embeds.
    const optionsFor = (notePathOrSelf?: string): RenderOptions => {
      const resolve = notePathOrSelf
        ? (p: string) => {
            const candidates = p.startsWith('/') ? [root ? path.join(root, p) : p] : [path.resolve(path.dirname(notePathOrSelf), p), ...(root ? [path.resolve(root, p)] : [])];
            return candidates.find((c) => existsSync(c));
          }
        : docResolver;
      return {
        // Checkboxes and boards are editable only in trusted workspaces and writable files.
        interactive: vscode.workspace.isTrusted && vscode.workspace.fs.isWritableFileSystem(doc.uri.scheme) !== false,
        highlight,
        renderMath,
        quiz: this.quiz,
        resolveImage: (src) => {
          if (/^(https?|data):/i.test(src)) return src;
          const file = resolve?.(decodeURIComponent(src.split(/[?#]/)[0] ?? src));
          // Unresolvable images keep their path; the webview shows their alt text when they fail to load.
          return file ? panel.webview.asWebviewUri(vscode.Uri.file(file)).toString() : src;
        },
      };
    };
    const options = optionsFor();
    if (this.index && doc.uri.scheme === 'file') {
      options.resolveEmbed = embedResolver(this.index.store, notePath(doc.uri), (p) => optionsFor(p));
    }
    const parsed = parse(text);
    if (doc.uri.scheme === 'file') options.bibliography = bibliographyFor(parsed, doc.uri.fsPath, root);
    let html: string;
    try {
      html = render(parsed, options);
    } catch (err) {
      // A note too large or too odd to render shouldn't take the extension host down with it.
      const reason = err instanceof Error ? err.message : String(err);
      html = `<div class="db-error" role="alert"><span class="db-error-code">Error</span> This note could not be rendered: ${escapeHtml(reason)}</div>`;
    }
    // An edit that doesn't change the output (front matter, comments) leaves the page as it is,
    // which also keeps filled database views in place.
    if (html === this.lastHtml && !this.forceNext) return;
    this.lastHtml = html;
    const full = this.forceNext;
    this.forceNext = false;
    void panel.webview.postMessage({ type: 'update', html, full });
    void this.fill(doc, parsed);
  }

  /** The HTML last sent to the webview, so identical renders aren't sent again. */
  private lastHtml: string | undefined;
  /** Whether `:cloze[…]` answers are hidden (quiz mode). */
  private quiz = false;

  toggleQuiz(): boolean {
    this.quiz = !this.quiz;
    this.forceNext = true;
    void this.update();
    return this.quiz;
  }

  /** The next update replaces the whole page, even if its HTML hasn't changed. */
  private forceNext = false;
  private fillTimer: ReturnType<typeof setTimeout> | undefined;
  private fillGeneration = 0;

  private scheduleFill() {
    clearTimeout(this.fillTimer);
    this.fillTimer = setTimeout(() => {
      if (this.document) void this.fill(this.document);
    }, 300);
  }

  /** Runs the document's views and queries and sends their HTML to the placeholders. */
  private async fill(doc: vscode.TextDocument, parsed = parse(doc.getText())) {
    const panel = this.panel;
    if (!this.db || !panel) return;
    const generation = ++this.fillGeneration;
    const results = await this.db.runDocument(doc, parsed, vscode.workspace.isTrusted);
    // A newer render or document switch replaced these placeholders.
    if (generation !== this.fillGeneration || doc !== this.document || !results.length) return;
    const items = results.map((r) => ({
      key: r.key,
      html: this.db?.resolveCovers(r.html, doc, r.key, (file) => panel.webview.asWebviewUri(vscode.Uri.file(file)).toString()) ?? r.html,
    }));
    void panel.webview.postMessage({ type: 'fill', items });
  }

  private async onMessage(m: FromWebview) {
    if (m.type === 'ready') {
      // A new webview has an empty page.
      this.lastHtml = undefined;
      void this.update();
      return;
    }
    if (m.type === 'db') {
      if (this.document && this.db) await this.db.handle(this.document, m);
      return;
    }
    if (EDITS.has(m.type)) {
      await this.applyEdit(m);
      return;
    }
    if (m.type !== 'link') return;
    const doc = this.document;
    const href = sanitizeUrl(m.href);
    if (!doc || !href) return;
    if (/^(https?|mailto|tel):/i.test(href)) {
      await vscode.env.openExternal(vscode.Uri.parse(href));
      return;
    }
    const [target = '', fragment] = href.split('#');
    const decoded = decodeURIComponent(target);
    // Links inside an embed are relative to the embedded note.
    const from = m.source ?? (doc.uri.scheme === 'file' ? notePath(doc.uri) : undefined);
    let file = m.source
      ? [path.resolve(path.dirname(m.source), decoded)].find((c) => existsSync(c))
      : fileResolver(doc)?.(decoded);
    if (!file && this.index && from) {
      // Wikilinks resolve by name and alias anywhere in the workspace.
      file = resolveNote(this.index.store, decoded.replace(/\.yamd$/i, ''), from)?.path;
    }
    if (!file) {
      const name = splitTarget(decoded).file.replace(/\.yamd$/i, '');
      const choice = await vscode.window.showInformationMessage(`YAMD: "${name}" does not exist. Create it?`, 'Create Note');
      if (choice) await createNote(from ? noteUri(from) : doc.uri, name);
      return;
    }
    const opened = await vscode.workspace.openTextDocument(vscode.Uri.file(file));
    const editor = await vscode.window.showTextDocument(opened, vscode.ViewColumn.One);
    if (fragment && opened.languageId === 'yamd') {
      const id = decodeURIComponent(fragment);
      const line = id.startsWith('^') ? anchorLine(opened.getText(), undefined, id.slice(1)) : findIdLine(opened.getText(), id);
      if (line !== undefined) {
        const pos = new vscode.Position(line, 0);
        editor.selection = new vscode.Selection(pos, pos);
        editor.revealRange(new vscode.Range(pos, pos), vscode.TextEditorRevealType.AtTop);
      }
    }
  }

  /** Applies an edit from the preview as one undoable step, or re-renders if the source changed. */
  private async applyEdit(m: FromWebview) {
    if (!this.document || !vscode.workspace.isTrusted || m.type === 'link' || m.type === 'ready' || m.type === 'db') return;
    // Edits to embedded content go to the embedded note.
    const doc = m.source ? await vscode.workspace.openTextDocument(noteUri(m.source)) : this.document;
    if (vscode.workspace.fs.isWritableFileSystem(doc.uri.scheme) === false) return;
    const source = doc.getText();
    let edit: LineEdit | null = null;
    switch (m.type) {
      case 'toggleTask':
        edit = toggleTask(source, m.line, m.hash, m.done);
        break;
      case 'kanbanMove':
        edit = moveCard(source, m.board, m.card, m.toColumn, m.toIndex);
        break;
      case 'kanbanAdd':
        edit = addCard(source, m.board, m.column, m.text);
        break;
      case 'kanbanRename':
        edit = renameCard(source, m.board, m.card, m.title);
        break;
      default:
        return;
    }
    if (!edit) {
      // The text changed since the preview rendered it; show the current state instead.
      this.forceUpdate();
      return;
    }
    const end = doc.lineAt(Math.min(edit.endLine, doc.lineCount - 1)).range.end;
    const workspaceEdit = new vscode.WorkspaceEdit();
    workspaceEdit.replace(doc.uri, new vscode.Range(edit.startLine, 0, end.line, end.character), edit.text);
    if (!(await vscode.workspace.applyEdit(workspaceEdit))) this.forceUpdate();
  }

  /**
   * Sends the page even if it is the same as the last one. The webview may have changed its page
   * ahead of the source (a dragged card, a ticked box), and a refused edit must undo that.
   */
  private forceUpdate() {
    this.forceNext = true;
    void this.update();
  }

  private shell(webview: vscode.Webview): string {
    const n = nonce();
    const script = webview.asWebviewUri(vscode.Uri.joinPath(this.extensionUri, 'dist', 'preview.js'));
    const style = webview.asWebviewUri(vscode.Uri.joinPath(this.extensionUri, 'media', 'preview.css'));
    const katex = webview.asWebviewUri(vscode.Uri.joinPath(this.extensionUri, 'dist', 'katex', 'katex.min.css'));
    const csp = [
      "default-src 'none'",
      `img-src ${webview.cspSource} https: http: data:`,
      `style-src ${webview.cspSource} 'unsafe-inline'`,
      // KaTeX's fonts ship with the extension; nothing loads from the network.
      `font-src ${webview.cspSource}`,
      `script-src 'nonce-${n}'`,
    ].join('; ');
    return `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8">
<meta http-equiv="Content-Security-Policy" content="${csp}">
<meta name="viewport" content="width=device-width, initial-scale=1.0">
<link rel="stylesheet" href="${katex}">
<link rel="stylesheet" href="${style}">
</head>
<body>
<main id="root" class="yamd-body"></main>
<svg id="yamd-arrows" aria-hidden="true"><defs><marker id="yamd-arrowhead" markerWidth="8" markerHeight="8" refX="6" refY="3" orient="auto"><path d="M0,0 L6,3 L0,6 Z"></path></marker></defs></svg>
<script nonce="${n}" src="${script}"></script>
</body>
</html>`;
  }

  dispose() {
    clearTimeout(this.timer);
    this.panel?.dispose();
    for (const d of this.disposables) d.dispose();
  }
}

/** Finds the line of the heading or block with the given id. */
function findIdLine(source: string, id: string): number | undefined {
  const doc = parse(source);
  let found: number | undefined;
  const visit = (blocks: typeof doc.blocks) => {
    for (const b of blocks) {
      if (found !== undefined) return;
      if ((b.type === 'heading' && b.id === id) || b.attrs?.id === id) found = b.line;
      if (b.type === 'list') b.items.forEach((it) => visit(it.children));
      else if (b.type === 'blockquote' || b.type === 'container') visit(b.children);
    }
  };
  visit(doc.blocks);
  return found;
}
