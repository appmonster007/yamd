import * as vscode from 'vscode';
import type { GraphEdge, GraphNode } from '../core/notes';
import { GRAPH_BODY } from '../graph/markup';
import type { WorkspaceIndex } from './index';
import { notePath, noteUri } from './index';

type FromGraph =
  | { type: 'ready' }
  | { type: 'open'; id: string }
  | { type: 'settings'; mode: 'global' | 'local'; depth: number };

/** The graph view: a canvas drawn by `dist/graph.js`, fed with nodes and edges from the index. */
export class GraphPanel implements vscode.Disposable {
  private panel: vscode.WebviewPanel | undefined;
  private mode: 'global' | 'local' = 'global';
  private depth = 1;
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

  /** The notes and links to draw, each note with the path and folder the view groups and describes it by. */
  private data(): { nodes: (GraphNode & { path: string; folder: string })[]; edges: GraphEdge[] } {
    const store = this.index.store;
    const graph = this.mode === 'local' && this.focus ? store.localGraph(this.focus, this.depth) : store.graph();
    const nodes = graph.nodes.map((n) => {
      // Notes that don't exist yet have no path.
      const path = n.missing ? '' : vscode.workspace.asRelativePath(noteUri(n.id), false).split('\\').join('/');
      const slash = path.lastIndexOf('/');
      return { ...n, path, folder: slash === -1 ? '' : path.slice(0, slash) };
    });
    return { nodes, edges: graph.edges };
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
    });
  }

  private html(webview: vscode.Webview): string {
    const nonce = Array.from({ length: 24 }, () => Math.random().toString(36)[2]).join('');
    const script = webview.asWebviewUri(vscode.Uri.joinPath(this.extensionUri, 'dist', 'graph.js'));
    const css = webview.asWebviewUri(vscode.Uri.joinPath(this.extensionUri, 'media', 'graph.css'));
    // No network origins: the graph works fully offline.
    const csp = `default-src 'none'; style-src ${webview.cspSource} 'unsafe-inline'; script-src 'nonce-${nonce}'`;
    return `<!DOCTYPE html><html lang="en"><head><meta charset="UTF-8">
<meta http-equiv="Content-Security-Policy" content="${csp}">
<meta name="viewport" content="width=device-width, initial-scale=1.0">
<link rel="stylesheet" href="${css}">
</head><body>${GRAPH_BODY}<script nonce="${nonce}" src="${script}"></script></body></html>`;
  }

  dispose() {
    this.panel?.dispose();
    for (const d of this.disposables) d.dispose();
  }
}
