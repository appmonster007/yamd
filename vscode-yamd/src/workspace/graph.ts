import * as vscode from 'vscode';
import type { GraphEdge, GraphNode } from '../core/notes';
import type { WorkspaceIndex } from './index';
import { notePath, noteUri } from './index';

type FromGraph =
  | { type: 'ready' }
  | { type: 'open'; id: string }
  | { type: 'settings'; mode: 'global' | 'local'; depth: number; filter: string };

/** The graph view: a canvas drawn by `dist/graph.js`, fed with nodes and edges from the index. */
export class GraphPanel implements vscode.Disposable {
  private panel: vscode.WebviewPanel | undefined;
  private mode: 'global' | 'local' = 'global';
  private depth = 1;
  private filter = '';
  private focus: string | undefined;
  private readonly disposables: vscode.Disposable[] = [];

  constructor(
    private readonly extensionUri: vscode.Uri,
    private readonly index: WorkspaceIndex,
  ) {
    this.disposables.push(
      index.onDidChange(() => this.schedulePost()),
      vscode.window.onDidChangeActiveTextEditor((e) => {
        if (e?.document.languageId === 'yamd' && e.document.uri.scheme === 'file') {
          this.focus = notePath(e.document.uri);
          if (this.mode === 'local') this.post();
        }
      }),
    );
  }

  show(mode?: 'global' | 'local') {
    if (mode) this.mode = mode;
    const doc = vscode.window.activeTextEditor?.document;
    if (doc?.languageId === 'yamd' && doc.uri.scheme === 'file') this.focus = notePath(doc.uri);
    if (this.panel) {
      this.panel.reveal();
      this.post();
      return;
    }
    this.panel = vscode.window.createWebviewPanel('yamd.graph', 'Note Graph', vscode.ViewColumn.Beside, {
      enableScripts: true,
      retainContextWhenHidden: true,
      localResourceRoots: [vscode.Uri.joinPath(this.extensionUri, 'dist'), vscode.Uri.joinPath(this.extensionUri, 'media')],
    });
    this.panel.onDidDispose(() => {
      this.panel = undefined;
      this.postedRevision = -1;
      clearTimeout(this.postTimer);
    });
    this.panel.webview.onDidReceiveMessage((m: FromGraph) => this.onMessage(m));
    this.panel.webview.html = this.html(this.panel.webview);
  }

  private async onMessage(m: FromGraph) {
    if (m.type === 'ready') this.post();
    else if (m.type === 'settings') {
      this.mode = m.mode;
      this.depth = Math.max(1, Math.min(5, Math.round(m.depth) || 1));
      this.filter = m.filter;
      this.post();
    } else if (m.type === 'open') {
      if (m.id.startsWith('missing:')) {
        const name = m.id.slice('missing:'.length);
        const create = await vscode.window.showInformationMessage(`"${name}" doesn't exist yet. Create it?`, 'Create Note');
        if (create) await vscode.commands.executeCommand('yamd.createNote', this.focus ? noteUri(this.focus).toString() : undefined, name);
        return;
      }
      await vscode.window.showTextDocument(noteUri(m.id), { viewColumn: vscode.ViewColumn.One });
    }
  }

  private data(): { nodes: GraphNode[]; edges: GraphEdge[] } {
    const store = this.index.store;
    let graph = this.mode === 'local' && this.focus ? store.localGraph(this.focus, this.depth) : store.graph();
    const f = this.filter.trim().toLowerCase();
    if (f) {
      const keep = (n: GraphNode) =>
        n.id === this.focus ||
        (f.startsWith('#')
          ? n.tags.some((t) => t.toLowerCase() === f.slice(1) || t.toLowerCase().startsWith(`${f.slice(1)}/`))
          : vscode.workspace.asRelativePath(noteUri(n.id)).toLowerCase().includes(f) || n.label.toLowerCase().includes(f));
      const nodes = graph.nodes.filter(keep);
      const ids = new Set(nodes.map((n) => n.id));
      graph = { nodes, edges: graph.edges.filter((e) => ids.has(e.source) && ids.has(e.target)) };
    }
    return graph;
  }

  /** The graph revision last sent, so typing that doesn't change the graph sends nothing. */
  private postedRevision = -1;
  private postTimer: ReturnType<typeof setTimeout> | undefined;

  /** Sends the graph when it changed, at most once in a while: it can hold thousands of notes. */
  private schedulePost() {
    if (!this.panel || this.index.store.graphRevision === this.postedRevision) return;
    clearTimeout(this.postTimer);
    this.postTimer = setTimeout(() => this.post(), 500);
  }

  private post() {
    if (!this.panel) return;
    this.postedRevision = this.index.store.graphRevision;
    void this.panel.webview.postMessage({
      type: 'data',
      ...this.data(),
      focus: this.focus ?? null,
      mode: this.mode,
      depth: this.depth,
      filter: this.filter,
    });
  }

  private html(webview: vscode.Webview): string {
    const nonce = Array.from({ length: 24 }, () => Math.random().toString(36)[2]).join('');
    const script = webview.asWebviewUri(vscode.Uri.joinPath(this.extensionUri, 'dist', 'graph.js'));
    // No network origins: the graph works fully offline.
    const csp = `default-src 'none'; style-src 'unsafe-inline'; script-src 'nonce-${nonce}'`;
    return `<!DOCTYPE html><html lang="en"><head><meta charset="UTF-8">
<meta http-equiv="Content-Security-Policy" content="${csp}">
<style>
html, body { margin: 0; height: 100%; overflow: hidden; background: var(--vscode-editor-background); color: var(--vscode-foreground); font-family: var(--vscode-font-family); font-size: var(--vscode-font-size); }
#bar { position: absolute; top: 8px; left: 8px; display: flex; gap: 6px; align-items: center; padding: 4px 6px; border-radius: 6px; background: var(--vscode-editorWidget-background); border: 1px solid var(--vscode-widget-border, transparent); z-index: 1; }
#bar select, #bar input { font: inherit; color: var(--vscode-input-foreground); background: var(--vscode-input-background); border: 1px solid var(--vscode-input-border, transparent); padding: 2px 4px; }
#depth { width: 3em; }
#count { color: var(--vscode-descriptionForeground); }
canvas { display: block; width: 100vw; height: 100vh; cursor: grab; }
</style></head><body>
<div id="bar">
<select id="mode" aria-label="Graph mode"><option value="global">Whole workspace</option><option value="local">Active note</option></select>
<label id="depthLabel">Depth <input id="depth" type="number" min="1" max="5" value="1"></label>
<input id="filter" placeholder="Filter: #tag or path" aria-label="Filter by tag or path">
<span id="count"></span>
</div>
<canvas id="graph" aria-label="Note graph"></canvas>
<script nonce="${nonce}" src="${script}"></script>
</body></html>`;
  }

  dispose() {
    this.panel?.dispose();
    for (const d of this.disposables) d.dispose();
  }
}
