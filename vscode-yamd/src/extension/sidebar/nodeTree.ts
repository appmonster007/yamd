import * as vscode from 'vscode';
import type { SidebarNode } from '../../core/sidebar/nodes';

/** A tree view over plain `SidebarNode` data: the roots are recomputed on every refresh. */
export class NodeTree implements vscode.TreeDataProvider<SidebarNode>, vscode.Disposable {
  private readonly changed = new vscode.EventEmitter<void>();
  readonly onDidChangeTreeData = this.changed.event;
  private timer: ReturnType<typeof setTimeout> | undefined;

  constructor(private readonly roots: () => SidebarNode[] | Promise<SidebarNode[]>, private readonly toCommand: (n: SidebarNode) => vscode.Command | undefined) {}

  /** Refreshes soon; many edits in a row cause one refresh. */
  refresh(delay = 250): void {
    clearTimeout(this.timer);
    this.timer = setTimeout(() => this.changed.fire(), delay);
  }

  getTreeItem(n: SidebarNode): vscode.TreeItem {
    const item = new vscode.TreeItem(n.label, n.children?.length ? vscode.TreeItemCollapsibleState.Expanded : vscode.TreeItemCollapsibleState.None);
    if (n.description) item.description = n.description;
    if (n.icon) item.iconPath = new vscode.ThemeIcon(n.icon);
    const command = this.toCommand(n);
    if (command) item.command = command;
    return item;
  }

  async getChildren(n?: SidebarNode): Promise<SidebarNode[]> {
    return n ? (n.children ?? []) : this.roots();
  }

  dispose() {
    clearTimeout(this.timer);
    this.changed.dispose();
  }
}
