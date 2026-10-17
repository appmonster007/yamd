import * as vscode from 'vscode';
import { extractFrontMatter } from '../core/frontmatter';
import type { Backlink, Mention } from '../core/notes';
import { PROPERTIES_BODY, sidebarHtml } from '../extension/webviewShell';
import { editProperty } from './features';
import type { WorkspaceIndex } from './index';
import { notePath, noteUri } from './index';

function activeNote(): vscode.TextDocument | undefined {
  const doc = vscode.window.activeTextEditor?.document;
  return doc?.languageId === 'yamd' && doc.uri.scheme === 'file' ? doc : undefined;
}

// ---- Backlinks ----

type BacklinkNode =
  | { kind: 'group'; label: string; linked: boolean; count: number }
  | { kind: 'file'; path: string; linked: boolean; items: (Backlink | Mention)[] }
  | { kind: 'link'; path: string; item: Backlink }
  | { kind: 'mention'; target: string; item: Mention };

/** How long the editor must be idle before unlinked mentions are searched. */
const MENTION_DELAY_MS = 800;

class BacklinksView implements vscode.TreeDataProvider<BacklinkNode> {
  private readonly changed = new vscode.EventEmitter<void>();
  readonly onDidChangeTreeData = this.changed.event;
  private target: string | undefined;
  private linked: Backlink[] = [];
  private mentions: Mention[] = [];
  visible = false;
  private mentionTimer: ReturnType<typeof setTimeout> | undefined;
  /** The note and index state the current mentions were computed for. */
  private mentionKey = '';

  constructor(private readonly index: WorkspaceIndex) {}

  refresh() {
    const doc = activeNote();
    // Keep showing the last note while a non-note editor (or none) is active.
    if (doc) this.target = notePath(doc.uri);
    if (!this.target) return;
    this.linked = this.index.store.backlinks(this.target);
    this.changed.fire();
    this.scheduleMentions();
  }

  /**
   * Unlinked mentions search every note's text, so they run only while the view is visible, a moment
   * after the last change, and not again for the same note until the index changes.
   */
  private scheduleMentions() {
    clearTimeout(this.mentionTimer);
    if (!this.visible || !this.target) {
      this.mentions = [];
      return;
    }
    const target = this.target;
    this.mentionTimer = setTimeout(() => {
      const key = `${target}\n${this.index.store.revision}`;
      if (key === this.mentionKey) return;
      this.mentionKey = key;
      this.mentions = this.index.store.unlinkedMentions(target);
      this.changed.fire();
    }, MENTION_DELAY_MS);
  }

  getChildren(node?: BacklinkNode): BacklinkNode[] {
    if (!this.target) return [];
    if (!node) {
      return [
        { kind: 'group', label: 'Linked mentions', linked: true, count: this.linked.length },
        { kind: 'group', label: 'Unlinked mentions', linked: false, count: this.mentions.length },
      ];
    }
    if (node.kind === 'group') {
      const items: (Backlink | Mention)[] = node.linked ? this.linked : this.mentions;
      const byFile = new Map<string, (Backlink | Mention)[]>();
      for (const item of items) byFile.set(item.from, [...(byFile.get(item.from) ?? []), item]);
      return [...byFile].map(([path, list]) => ({ kind: 'file', path, linked: node.linked, items: list }));
    }
    if (node.kind === 'file') {
      return node.items.map((item) =>
        node.linked ? { kind: 'link', path: node.path, item: item as Backlink } : { kind: 'mention', target: this.target as string, item: item as Mention },
      );
    }
    return [];
  }

  getTreeItem(node: BacklinkNode): vscode.TreeItem {
    switch (node.kind) {
      case 'group': {
        const item = new vscode.TreeItem(node.label, node.count ? vscode.TreeItemCollapsibleState.Expanded : vscode.TreeItemCollapsibleState.None);
        item.description = String(node.count);
        return item;
      }
      case 'file': {
        const item = new vscode.TreeItem(noteUri(node.path), vscode.TreeItemCollapsibleState.Expanded);
        item.description = `${vscode.workspace.asRelativePath(noteUri(node.path))} · ${node.items.length}`;
        return item;
      }
      case 'link': {
        const item = new vscode.TreeItem(node.item.text || node.item.link.target);
        item.tooltip = `Line ${node.item.link.line + 1}`;
        item.command = { command: 'yamd.openAt', title: 'Open', arguments: [node.path, node.item.link.line] };
        return item;
      }
      case 'mention': {
        const item = new vscode.TreeItem(node.item.text);
        item.contextValue = 'unlinkedMention';
        item.tooltip = 'Plain-text mention. Use the link action to turn it into a wikilink.';
        item.command = { command: 'yamd.openAt', title: 'Open', arguments: [node.item.from, node.item.line] };
        return item;
      }
    }
  }
}

// ---- Tags ----

type TagNode = { kind: 'tag'; name: string; label: string } | { kind: 'note'; path: string };

class TagsView implements vscode.TreeDataProvider<TagNode> {
  private readonly changed = new vscode.EventEmitter<void>();
  readonly onDidChangeTreeData = this.changed.event;

  constructor(private readonly index: WorkspaceIndex) {}

  refresh() {
    this.changed.fire();
  }

  private allTags(): string[] {
    const names = new Set<string>();
    for (const tag of this.index.store.tags().keys()) {
      // Parents of nested tags are tags too: `project/web` implies `project`.
      const parts = tag.split('/');
      for (let i = 1; i <= parts.length; i++) names.add(parts.slice(0, i).join('/'));
    }
    return [...names].sort((a, b) => a.localeCompare(b));
  }

  getChildren(node?: TagNode): TagNode[] {
    const all = this.allTags();
    if (!node) return all.filter((t) => !t.includes('/')).map((t) => ({ kind: 'tag', name: t, label: t }));
    if (node.kind !== 'tag') return [];
    const prefix = `${node.name}/`;
    const children: TagNode[] = all
      .filter((t) => t.startsWith(prefix) && !t.slice(prefix.length).includes('/'))
      .map((t) => ({ kind: 'tag', name: t, label: t.slice(prefix.length) }));
    const notes: TagNode[] = this.index.store.notesWithTag(node.name).map((p) => ({ kind: 'note', path: p }));
    return [...children, ...notes];
  }

  getTreeItem(node: TagNode): vscode.TreeItem {
    if (node.kind === 'note') {
      const summary = this.index.store.summary(node.path);
      const item = new vscode.TreeItem(summary?.title ?? node.path);
      item.resourceUri = noteUri(node.path);
      item.description = vscode.workspace.asRelativePath(noteUri(node.path));
      item.command = { command: 'yamd.openAt', title: 'Open', arguments: [node.path] };
      return item;
    }
    const item = new vscode.TreeItem(`#${node.label}`, vscode.TreeItemCollapsibleState.Collapsed);
    item.description = String(this.index.store.notesWithTag(node.name).length);
    item.iconPath = new vscode.ThemeIcon('tag');
    return item;
  }
}

// ---- Properties ----

type PropertyMessage =
  | { type: 'set'; key: string; value: unknown }
  | { type: 'remove'; key: string }
  | { type: 'ready' };

class PropertiesView implements vscode.WebviewViewProvider {
  private view: vscode.WebviewView | undefined;
  private doc: vscode.TextDocument | undefined;

  constructor(private readonly extensionUri: vscode.Uri) {}

  resolveWebviewView(view: vscode.WebviewView) {
    this.view = view;
    view.webview.options = { enableScripts: true, localResourceRoots: [vscode.Uri.joinPath(this.extensionUri, 'dist'), vscode.Uri.joinPath(this.extensionUri, 'media')] };
    view.webview.html = sidebarHtml(view.webview, this.extensionUri, 'properties.js', PROPERTIES_BODY);
    view.webview.onDidReceiveMessage(async (m: PropertyMessage) => {
      if (m.type === 'ready') return this.refresh();
      const doc = this.doc;
      if (!doc || !vscode.workspace.isTrusted) return;
      await editProperty(doc, m.key, m.type === 'remove' ? undefined : m.value);
    });
    view.onDidChangeVisibility(() => this.refresh());
  }

  refresh() {
    const doc = activeNote();
    if (doc) this.doc = doc;
    if (!this.view?.visible) return;
    const fm = this.doc ? parseFrontMatter(this.doc.getText()) : null;
    void this.view.webview.postMessage({
      type: 'update',
      note: this.doc ? vscode.workspace.asRelativePath(this.doc.uri) : null,
      error: fm?.error ?? null,
      properties: fm ? Object.entries(fm.data).map(([key, value]) => ({ key, value: toJson(value) })) : [],
      readonly: !vscode.workspace.isTrusted,
    });
  }

}

function parseFrontMatter(text: string) {
  // Only the front matter is read, not every line of a possibly huge note.
  if (!text.startsWith('---')) return null;
  const end = /\r?\n---[ \t]*(?:\r?\n|$)/.exec(text.slice(3));
  const block = end ? text.slice(0, 3 + end.index + end[0].length) : text.slice(0, 20_000);
  return extractFrontMatter(block.split('\n').map((l) => l.replace(/\r$/, '')));
}

/** Front matter values as JSON-safe data (dates become `YYYY-MM-DD`). */
function toJson(value: unknown): unknown {
  if (value instanceof Date) return value.toISOString().slice(0, 10);
  if (Array.isArray(value)) return value.map(toJson);
  if (value && typeof value === 'object') return Object.fromEntries(Object.entries(value).map(([k, v]) => [k, toJson(v)]));
  return value;
}

export function registerViews(context: vscode.ExtensionContext, index: WorkspaceIndex): void {
  const backlinks = new BacklinksView(index);
  const tags = new TagsView(index);
  const properties = new PropertiesView(context.extensionUri);
  const backlinksTree = vscode.window.createTreeView('yamd.backlinks', { treeDataProvider: backlinks });
  backlinksTree.onDidChangeVisibility((e) => {
    backlinks.visible = e.visible;
    if (e.visible) backlinks.refresh();
  });
  backlinks.visible = backlinksTree.visible;
  const refresh = () => {
    backlinks.refresh();
    tags.refresh();
    properties.refresh();
  };
  context.subscriptions.push(
    backlinksTree,
    vscode.window.createTreeView('yamd.tags', { treeDataProvider: tags }),
    vscode.window.registerWebviewViewProvider('yamd.properties', properties),
    index.onDidChange(refresh),
    vscode.window.onDidChangeActiveTextEditor(refresh),
    vscode.workspace.onDidChangeTextDocument((e) => {
      if (e.document === vscode.window.activeTextEditor?.document) properties.refresh();
    }),
    vscode.commands.registerCommand('yamd.openAt', async (p: string, line?: number) => {
      const doc = await vscode.workspace.openTextDocument(noteUri(p));
      const editor = await vscode.window.showTextDocument(doc);
      if (line !== undefined) {
        const pos = new vscode.Position(line, 0);
        editor.selection = new vscode.Selection(pos, pos);
        editor.revealRange(new vscode.Range(pos, pos), vscode.TextEditorRevealType.InCenter);
      }
    }),
    vscode.commands.registerCommand('yamd.linkMentionFromView', (node: { kind: string; target: string; item: Mention }) => {
      if (node?.kind !== 'mention') return;
      return vscode.commands.executeCommand('yamd.linkMention', { from: node.item.from, start: node.item.start, end: node.item.end, target: node.target });
    }),
  );
  refresh();
}
