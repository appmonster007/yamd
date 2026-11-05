import * as vscode from 'vscode';
import { expandPlaceholders } from '../../core/templates/placeholders';
import { buildNote } from '../../core/build/build';
import type { NoteTemplate } from '../../core/templates/notes';

/** The folder a new note goes in: the one clicked, else the active note's, else the first workspace folder. */
export async function chooseFolder(clicked?: vscode.Uri): Promise<vscode.Uri | undefined> {
  if (clicked?.scheme === 'file') {
    try {
      const stat = await vscode.workspace.fs.stat(clicked);
      return stat.type & vscode.FileType.Directory ? clicked : vscode.Uri.joinPath(clicked, '..');
    } catch {
      /* fall through */
    }
  }
  const active = vscode.window.activeTextEditor?.document.uri;
  if (active?.scheme === 'file') return vscode.Uri.joinPath(active, '..');
  const root = vscode.workspace.workspaceFolders?.[0]?.uri;
  if (!root) void vscode.window.showInformationMessage('YAMD: Open a folder first.');
  return root;
}

export const slugFor = (title: string) => title.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '') || 'note';

async function exists(uri: vscode.Uri): Promise<boolean> {
  try {
    await vscode.workspace.fs.stat(uri);
    return true;
  } catch {
    return false;
  }
}

/**
 * Creates a note from a template in `folder` (never overwriting: `name-2.md`, `name-3.md` …), fills the
 * generated sections, creates the files it needs, opens it and puts the cursor at `{{@cursor}}`.
 */
export async function createNote(folder: vscode.Uri, title: string, template: NoteTemplate, vars: Record<string, string> = {}): Promise<vscode.Uri> {
  const base = slugFor(title);
  let uri = vscode.Uri.joinPath(folder, `${base}.md`);
  for (let n = 2; await exists(uri); n++) uri = vscode.Uri.joinPath(folder, `${base}-${n}.md`);
  const expanded = expandPlaceholders(template.text, { now: new Date(), title, vars });
  const built = buildNote(expanded.text.split('\n')).lines.join('\n');
  // Build can change the length before the cursor (a table of contents); find the cursor's line again.
  const cursorLine = expanded.cursor === undefined ? undefined : expanded.text.slice(0, expanded.cursor).split('\n').length - 1;
  await vscode.workspace.fs.writeFile(uri, new TextEncoder().encode(built));
  for (const f of template.files ?? []) {
    const file = vscode.Uri.joinPath(folder, f.name);
    if (!(await exists(file))) await vscode.workspace.fs.writeFile(file, new TextEncoder().encode(f.text));
  }
  const doc = await vscode.workspace.openTextDocument(uri);
  const editor = await vscode.window.showTextDocument(doc);
  if (cursorLine !== undefined) {
    const line = Math.min(doc.lineCount - 1, cursorLine);
    const pos = new vscode.Position(line, Math.min(doc.lineAt(line).text.length, expanded.cursor === undefined ? 0 : expanded.cursor - expanded.text.lastIndexOf('\n', expanded.cursor - 1) - 1));
    editor.selection = new vscode.Selection(pos, pos);
    editor.revealRange(new vscode.Range(pos, pos));
  }
  return uri;
}
