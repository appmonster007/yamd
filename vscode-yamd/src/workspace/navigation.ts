import * as vscode from 'vscode';
import type { WorkspaceIndex } from './index';
import { notePath, noteUri } from './index';

function activeNotePath(): string | undefined {
  const doc = vscode.window.activeTextEditor?.document;
  return doc?.languageId === 'yamd' && doc.uri.scheme === 'file' ? notePath(doc.uri) : undefined;
}

/** The `[[target]]`, `![[target]]` or `[text](target)` link under the cursor, if any. */
function linkUnderCursor(editor: vscode.TextEditor): string | undefined {
  const line = editor.document.lineAt(editor.selection.active.line).text;
  const col = editor.selection.active.character;
  for (const m of line.matchAll(/!?\[\[([^\]|#^]+)[^\]]*\]\]|\[[^\]]*\]\(([^)#\s]+)[^)]*\)/g)) {
    const start = m.index ?? 0;
    const end = start + m[0].length;
    if (col >= start && col <= end) return (m[1] ?? m[2])?.trim();
  }
  return undefined;
}

/** "YAMD: Go to Linked Note": resolves and opens the link under the cursor. */
async function goToLinkedNote(editor: vscode.TextEditor, index: WorkspaceIndex): Promise<void> {
  const target = linkUnderCursor(editor);
  const from = notePath(editor.document.uri);
  if (!target) {
    void vscode.window.showInformationMessage('YAMD: Place the cursor on a link.');
    return;
  }
  await index.whenReady();
  const resolved = index.store.resolve(target, from);
  if (!resolved) {
    void vscode.window.showInformationMessage(`YAMD: "${target}" doesn't resolve to a note.`);
    return;
  }
  await vscode.window.showTextDocument(noteUri(resolved.path));
}

/** "YAMD: Open Random Note". */
async function openRandomNote(index: WorkspaceIndex): Promise<void> {
  await index.whenReady();
  const paths = index.store.paths();
  if (!paths.length) {
    void vscode.window.showInformationMessage('YAMD: No notes in this workspace yet.');
    return;
  }
  const path = paths[Math.floor(Math.random() * paths.length)] as string;
  await vscode.window.showTextDocument(noteUri(path));
}

/** "YAMD: Show Unlinked Mentions": plain-text mentions of the active note elsewhere, as a quick pick. */
async function showUnlinkedMentions(index: WorkspaceIndex): Promise<void> {
  const path = activeNotePath();
  if (!path) {
    void vscode.window.showInformationMessage('YAMD: Open a note first.');
    return;
  }
  await index.whenReady();
  const mentions = index.store.unlinkedMentions(path);
  if (!mentions.length) {
    void vscode.window.showInformationMessage('YAMD: No unlinked mentions found.');
    return;
  }
  const items = mentions.map((m) => ({ label: m.text, description: `${m.from}:${m.line + 1}`, m }));
  const pick = await vscode.window.showQuickPick(items, { placeHolder: 'Unlinked mentions' });
  if (!pick) return;
  const editor = await vscode.window.showTextDocument(noteUri(pick.m.from));
  const pos = new vscode.Position(pick.m.line, 0);
  editor.selection = new vscode.Selection(pos, pos);
  editor.revealRange(new vscode.Range(pos, pos), vscode.TextEditorRevealType.InCenter);
}

/** "YAMD: Show Orphan Notes": notes with no incoming and no outgoing links. */
async function showOrphanNotes(index: WorkspaceIndex): Promise<void> {
  await index.whenReady();
  const orphans = index.store.summaries().filter((s) => s.links.length === 0 && index.store.backlinks(s.path).length === 0);
  if (!orphans.length) {
    void vscode.window.showInformationMessage('YAMD: No orphan notes found.');
    return;
  }
  const items = orphans.map((s) => ({ label: s.title || s.path, description: s.path }));
  const pick = await vscode.window.showQuickPick(items, { placeHolder: 'Orphan notes (no links in or out)' });
  if (!pick) return;
  await vscode.window.showTextDocument(noteUri(pick.description));
}

export function registerNavigation(context: vscode.ExtensionContext, index: WorkspaceIndex): void {
  context.subscriptions.push(
    vscode.commands.registerTextEditorCommand('yamd.goToLinkedNote', (editor) => void goToLinkedNote(editor, index)),
    vscode.commands.registerCommand('yamd.openRandomNote', () => openRandomNote(index)),
    vscode.commands.registerCommand('yamd.showUnlinkedMentions', () => showUnlinkedMentions(index)),
    vscode.commands.registerCommand('yamd.showOrphanNotes', () => showOrphanNotes(index)),
    vscode.commands.registerCommand('yamd.revealBacklinks', () => vscode.commands.executeCommand('yamd.backlinks.focus')),
  );
}
