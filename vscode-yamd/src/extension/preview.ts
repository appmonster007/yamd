import * as path from 'node:path';
import * as vscode from 'vscode';
import { existsSync } from 'node:fs';
import { escapeHtml, parse, render } from '../core';
import { WARM_MIN_CHARS, warmParse } from '../core/parser';
import type { RenderOptions } from '../core';
import { embedResolver } from '../core/embeds';

import { computeBoardEdit } from '../core/boardEdit';
import type { BoardEditMessage } from '../core/boardEdit';
import type { LineEdit } from '../core/kanbanEdit';
import type { WorkspaceIndex } from '../workspace/index';
import { notePath, noteUri } from '../workspace/index';
import { lastLines, openPreviewLink, pendingLines, SYNC_QUIET_MS, YAMD_EDITOR } from './previewLinks';
import { nonce } from './webviewShell';
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
  | { type: 'reveal'; line: number }
  | { type: 'editAt'; line: number }
  | BoardEditMessage
  | DbMessage;

export interface SessionOptions {
  /** Panel mode: the preview follows whichever YAMD editor is active. Custom-editor mode stays on its own note. */
  follow: boolean;
  /** Whether `:cloze[…]` answers are hidden (quiz mode), shared by every preview. */
  quiz: () => boolean;
  /** Locked previews are read-only: nothing in them edits the note. */
  locked: () => boolean;
  onDispose?: () => void;
}

/** One preview webview (a side panel or a custom editor tab) showing one note. */
export class PreviewSession implements vscode.Disposable {
  private panel: vscode.WebviewPanel | undefined;
  /** True when the webview is the note's editor tab itself, not a companion panel. */
  private isEditor = false;
  private initialLine: number | undefined;
  private lastReveal = 0;
  private lastSent = 0;
  private document: vscode.TextDocument | undefined;
  private timer: ReturnType<typeof setTimeout> | undefined;
  private readonly disposables: vscode.Disposable[] = [];

  constructor(
    private readonly extensionUri: vscode.Uri,
    private readonly index: WorkspaceIndex | undefined,
    private readonly db: DatabaseService | undefined,
    private readonly opts: SessionOptions,
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
        if (this.opts.follow && this.panel && editor?.document.languageId === 'yamd' && editor.document !== this.document) {
          this.setDocument(editor.document);
        }
      }),
      vscode.workspace.onDidGrantWorkspaceTrust(() => void this.update()),
      vscode.window.onDidChangeTextEditorVisibleRanges((e) => {
        if (e.textEditor.document === this.document && e.visibleRanges[0] && Date.now() - this.lastReveal > SYNC_QUIET_MS) {
          this.lastSent = Date.now();
          void this.panel?.webview.postMessage({ type: 'scroll', line: e.visibleRanges[0].start.line });
        }
      }),
    );
  }

  /** Binds this session to a webview VS Code created for the note's custom editor. */
  attach(panel: vscode.WebviewPanel, doc: vscode.TextDocument): void {
    this.panel = panel;
    this.isEditor = true;
    this.initialLine = pendingLines.get(doc.uri.toString());
    pendingLines.delete(doc.uri.toString());
    panel.webview.options = { enableScripts: true };
    panel.onDidDispose(() => this.dispose());
    panel.webview.onDidReceiveMessage((m: FromWebview) => this.onMessage(m));
    panel.webview.html = this.shell(panel.webview);
    this.setDocument(doc);
  }

  /** Re-renders now, e.g. after quiz mode flips. */
  refresh(): void {
    this.forceNext = true;
    void this.update();
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
        this.opts.onDispose?.();
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
    this.initialLine ??= undefined;
    if (!this.isEditor) this.panel.title = `Preview ${path.basename(doc.uri.path)}`;
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
        interactive: !this.opts.locked() && vscode.workspace.isTrusted && vscode.workspace.fs.isWritableFileSystem(doc.uri.scheme) !== false,
        highlight,
        renderMath,
        quiz: this.opts.quiz(),
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
    this.sendInitialLine(panel);
    void this.fill(doc, parsed);
  }

  /** The HTML last sent to the webview, so identical renders aren't sent again. */
  private lastHtml: string | undefined;

  /** Scrolls a freshly opened preview to the position carried over from the editor or a link. */
  private sendInitialLine(panel: vscode.WebviewPanel) {
    if (this.initialLine === undefined) return;
    const line = this.initialLine;
    this.initialLine = undefined;
    this.lastSent = Date.now();
    void panel.webview.postMessage({ type: 'scroll', line });
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
    const results = await this.db.runDocument(doc, parsed, vscode.workspace.isTrusted && !this.opts.locked());
    // A newer render or document switch replaced these placeholders.
    if (generation !== this.fillGeneration || doc !== this.document || !results.length) return;
    const items = results.map((r) => ({
      key: r.key,
      html: this.db?.resolveCovers(r.html, doc, r.key, (file) => panel.webview.asWebviewUri(vscode.Uri.file(file)).toString()) ?? r.html,
    }));
    void panel.webview.postMessage({ type: 'fill', items });
  }

  /** Opens the note's source with the cursor on `line`: this tab switches to Source, or a source editor takes focus. */
  private async editAt(line: number) {
    const doc = this.document;
    if (!doc) return;
    if (this.isEditor) {
      await vscode.commands.executeCommand('yamd.showSource', doc.uri, line);
      return;
    }
    const pos = new vscode.Position(Math.min(line, doc.lineCount - 1), 0);
    const existing = vscode.window.visibleTextEditors.find((e) => e.document === doc);
    await vscode.window.showTextDocument(doc, {
      viewColumn: existing?.viewColumn ?? vscode.ViewColumn.One,
      selection: new vscode.Range(pos, pos),
    });
  }

  /** The user scrolled the preview: remember where, and scroll the note's source editor to match. */
  private onPreviewScrolled(line: number) {
    const doc = this.document;
    if (!doc) return;
    lastLines.set(doc.uri.toString(), line);
    if (this.isEditor || Date.now() - this.lastSent < SYNC_QUIET_MS) return;
    for (const editor of vscode.window.visibleTextEditors) {
      if (editor.document !== doc) continue;
      this.lastReveal = Date.now();
      const pos = new vscode.Position(Math.min(line, doc.lineCount - 1), 0);
      editor.revealRange(new vscode.Range(pos, pos), vscode.TextEditorRevealType.AtTop);
    }
  }

  private async onMessage(m: FromWebview) {
    if (m.type === 'editAt') {
      await this.editAt(m.line);
      return;
    }
    if (m.type === 'reveal') {
      this.onPreviewScrolled(m.line);
      return;
    }
    if (m.type === 'ready') {
      // A new webview has an empty page.
      this.lastHtml = undefined;
      void this.update();
      return;
    }
    if (m.type === 'db') {
      if (this.document && this.db && (!this.opts.locked() || m.op === 'month')) await this.db.handle(this.document, m);
      return;
    }
    if (m.type === 'boardEdit') {
      await this.applyEdit(m);
      return;
    }
    if (m.type !== 'link' || !this.document) return;
    await openPreviewLink({ doc: this.document, index: this.index, inEditorTab: this.isEditor, column: this.panel?.viewColumn }, m);
  }

  /** Applies an edit from the preview as one undoable step, or re-renders if the source changed. */
  private async applyEdit(m: BoardEditMessage) {
    if (!this.document || this.opts.locked() || !vscode.workspace.isTrusted) return;
    // Edits to embedded content go to the embedded note.
    const doc = m.source ? await vscode.workspace.openTextDocument(noteUri(m.source)) : this.document;
    if (vscode.workspace.fs.isWritableFileSystem(doc.uri.scheme) === false) return;
    const edit: LineEdit | null = computeBoardEdit(doc.getText(), m);
    if (!edit) {
      // The text changed since the preview rendered it; show the current state instead.
      this.forceUpdate();
      return;
    }
    const end = doc.lineAt(Math.min(edit.endLine, doc.lineCount - 1)).range.end;
    const workspaceEdit = new vscode.WorkspaceEdit();
    workspaceEdit.replace(doc.uri, new vscode.Range(edit.startLine, 0, end.line, end.character), edit.text);
    if (await vscode.workspace.applyEdit(workspaceEdit)) {
      // A drag, toggle, add or rename is a completed action, not an in-progress typing session to
      // leave uncommitted — auto-save so it isn't silently lost (this matters most for an embedded
      // note, which the user may never open directly).
      await doc.save();
    } else {
      this.forceUpdate();
    }
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
<script nonce="${n}" src="${script}"></script>
</body>
</html>`;
  }

  dispose() {
    if (this.disposed) return;
    this.disposed = true;
    clearTimeout(this.timer);
    clearTimeout(this.fillTimer);
    const panel = this.panel;
    this.panel = undefined;
    panel?.dispose();
    for (const d of this.disposables) d.dispose();
    this.opts.onDispose?.();
  }
  private disposed = false;
}

/** Owns the side-panel preview and every preview-mode editor tab, and the switching between Source and Preview. */
export class PreviewManager implements vscode.Disposable, vscode.CustomTextEditorProvider {
  private panelSession: PreviewSession | undefined;
  private readonly editors = new Set<PreviewSession>();
  private quiz = false;
  /** Locked: previews show the note but can't change it. Starts from `yamd.preview.startLocked`. */
  private locked = vscode.workspace.getConfiguration('yamd.preview').get<boolean>('startLocked', false);
  private readonly disposables: vscode.Disposable[] = [];

  constructor(
    private readonly extensionUri: vscode.Uri,
    private readonly index?: WorkspaceIndex,
    private readonly db?: DatabaseService,
  ) {
    this.publishLock();
    this.disposables.push(
      vscode.window.registerCustomEditorProvider(YAMD_EDITOR, this, {
        webviewOptions: { retainContextWhenHidden: true },
        supportsMultipleEditorsPerDocument: true,
      }),
    );
  }

  private session(follow: boolean, onDispose?: () => void): PreviewSession {
    return new PreviewSession(this.extensionUri, this.index, this.db, { follow, quiz: () => this.quiz, locked: () => this.locked, onDispose });
  }

  /** Companion preview panel (Markdown's "Open Preview" / "Open Preview to the Side"). */
  show(doc: vscode.TextDocument, toSide: boolean): void {
    if (!this.panelSession) this.panelSession = this.session(true, () => (this.panelSession = undefined));
    this.panelSession.show(doc, toSide);
  }

  resolveCustomTextEditor(document: vscode.TextDocument, webviewPanel: vscode.WebviewPanel): void {
    const s = this.session(false, () => this.editors.delete(s));
    this.editors.add(s);
    s.attach(webviewPanel, document);
  }

  /** Switches the current tab to the rendered editor, landing on the same part of the note. */
  async showPreviewInTab(uri?: vscode.Uri): Promise<void> {
    const editor = vscode.window.activeTextEditor;
    const target = uri ?? editor?.document.uri;
    if (!target) return;
    if (editor && editor.document.uri.toString() === target.toString() && editor.visibleRanges[0]) {
      pendingLines.set(target.toString(), editor.visibleRanges[0].start.line);
    }
    await vscode.commands.executeCommand('vscode.openWith', target, YAMD_EDITOR);
  }

  /** Switches the current preview tab back to the source text editor. */
  async showSource(uri?: vscode.Uri, cursorLine?: number): Promise<void> {
    const target = uri ?? vscode.window.tabGroups.activeTabGroup.activeTab?.input;
    const resource = target instanceof vscode.Uri ? target : (target as { uri?: vscode.Uri } | undefined)?.uri;
    if (!resource) return;
    await vscode.commands.executeCommand('vscode.openWith', resource, 'default');
    const line = cursorLine ?? lastLines.get(resource.toString());
    const active = vscode.window.activeTextEditor;
    if (line !== undefined && active && active.document.uri.toString() === resource.toString()) {
      const pos = new vscode.Position(Math.min(line, active.document.lineCount - 1), 0);
      if (cursorLine !== undefined) active.selection = new vscode.Selection(pos, pos);
      active.revealRange(new vscode.Range(pos, pos), vscode.TextEditorRevealType.InCenterIfOutsideViewport);
    }
  }

  /** Flips the active tab between Source and Preview. */
  async toggleMode(): Promise<void> {
    const input = vscode.window.tabGroups.activeTabGroup.activeTab?.input;
    if (input instanceof vscode.TabInputCustom && input.viewType === YAMD_EDITOR) await this.showSource(input.uri);
    else if (vscode.window.activeTextEditor?.document.languageId === 'yamd') await this.showPreviewInTab();
  }

  private publishLock() {
    void vscode.commands.executeCommand('setContext', 'yamd.previewLocked', this.locked);
  }

  /** Locks (read-only) or unlocks (editable) every preview. Omit `locked` to flip it. */
  setLocked(locked = !this.locked): boolean {
    this.locked = locked;
    this.publishLock();
    this.panelSession?.refresh();
    for (const s of this.editors) s.refresh();
    return this.locked;
  }

  toggleQuiz(): boolean {
    this.quiz = !this.quiz;
    this.panelSession?.refresh();
    for (const s of this.editors) s.refresh();
    return this.quiz;
  }

  dispose() {
    this.panelSession?.dispose();
    for (const s of [...this.editors]) s.dispose();
    for (const d of this.disposables) d.dispose();
  }
}
