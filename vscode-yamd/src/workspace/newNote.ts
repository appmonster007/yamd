import * as vscode from 'vscode';
import { formatDate, newNoteText } from '../core/templates';

/** Characters that can't appear in a file name on common file systems. */
const INVALID = /[\\/:*?"<>|\u0000-\u001f]/;

async function exists(uri: vscode.Uri): Promise<boolean> {
  try {
    await vscode.workspace.fs.stat(uri);
    return true;
  } catch {
    return false;
  }
}

/**
 * Where a new note goes: the folder that was right-clicked in the Explorer, the folder of a file
 * that was right-clicked or of the active editor, or the workspace root.
 */
async function targetFolder(clicked?: vscode.Uri): Promise<vscode.Uri | undefined> {
  if (clicked?.scheme === 'file') {
    try {
      const stat = await vscode.workspace.fs.stat(clicked);
      return stat.type & vscode.FileType.Directory ? clicked : vscode.Uri.joinPath(clicked, '..');
    } catch {
      // Fall through to the active editor.
    }
  }
  const active = vscode.window.activeTextEditor?.document.uri;
  if (active?.scheme === 'file' && vscode.workspace.getWorkspaceFolder(active)) return vscode.Uri.joinPath(active, '..');
  const folders = vscode.workspace.workspaceFolders ?? [];
  if (folders.length <= 1) return folders[0]?.uri;
  const pick = await vscode.window.showWorkspaceFolderPick({ placeHolder: 'Create the note in which folder?' });
  return pick?.uri;
}

async function create(folder: vscode.Uri, fileName: string, title: string): Promise<void> {
  const uri = vscode.Uri.joinPath(folder, `${fileName}.yamd`);
  const lang = vscode.workspace.getConfiguration('yamd.newNote').get<string>('lang', 'en');
  await vscode.workspace.fs.writeFile(uri, new TextEncoder().encode(newNoteText(title, new Date(), lang)));
  const editor = await vscode.window.showTextDocument(uri);
  // Put the cursor on the empty line after the heading, ready to type.
  const end = editor.document.lineAt(editor.document.lineCount - 1).range.end;
  editor.selection = new vscode.Selection(end, end);
}

/** "YAMD: New Note…": asks for a name. */
async function newNote(clicked?: vscode.Uri): Promise<void> {
  const folder = await targetFolder(clicked);
  if (!folder) {
    void vscode.window.showInformationMessage('YAMD: Open a folder to create notes in it.');
    return;
  }
  const where = vscode.workspace.asRelativePath(folder, true);
  const name = await vscode.window.showInputBox({
    title: 'New YAMD Note',
    prompt: `The note's title; it is also the file name. Creates it in ${where}.`,
    placeHolder: 'Meeting notes',
    validateInput: async (value) => {
      const v = value.trim();
      if (!v) return 'Enter a name.';
      if (INVALID.test(v)) return 'A name can’t contain / \\ : * ? " < > |';
      if (await exists(vscode.Uri.joinPath(folder, `${v.replace(/\.yamd$/i, '')}.yamd`))) return `${v}.yamd already exists here.`;
      return null;
    },
  });
  if (name === undefined) return;
  const title = name.trim().replace(/\.yamd$/i, '');
  await create(folder, title, title);
}

/** "YAMD: New Timestamped Note": named after the current time, no questions asked. */
async function newTimestampNote(clicked?: vscode.Uri): Promise<void> {
  const folder = await targetFolder(clicked);
  if (!folder) {
    void vscode.window.showInformationMessage('YAMD: Open a folder to create notes in it.');
    return;
  }
  const now = new Date();
  const format = vscode.workspace.getConfiguration('yamd.newNote').get<string>('timestampFormat', 'YYYY-MM-DD-HHmm');
  const base = formatDate(now, format).replace(/[\\/:*?"<>|]/g, '-');
  let name = base;
  // Two notes in the same minute get -2, -3 and so on.
  for (let n = 2; await exists(vscode.Uri.joinPath(folder, `${name}.yamd`)); n++) name = `${base}-${n}`;
  await create(folder, name, formatDate(now, 'YYYY-MM-DD HH:mm'));
}

export function registerNewNote(context: vscode.ExtensionContext): void {
  context.subscriptions.push(
    vscode.commands.registerCommand('yamd.newNote', (uri?: vscode.Uri) => newNote(uri instanceof vscode.Uri ? uri : undefined)),
    vscode.commands.registerCommand('yamd.newTimestampNote', (uri?: vscode.Uri) => newTimestampNote(uri instanceof vscode.Uri ? uri : undefined)),
  );
}
