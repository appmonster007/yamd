import * as vscode from 'vscode';

const VIEW_TYPES = ['table', 'list', 'gallery', 'calendar', 'board'] as const;

function activeYamdEditor(): vscode.TextEditor | undefined {
  const editor = vscode.window.activeTextEditor;
  return editor?.document.languageId === 'yamd' ? editor : undefined;
}

/** "YAMD: Insert Database View…": inserts a `::db[alias]{type=...}` leaf directive for the notes table. */
async function insertDatabaseView(): Promise<void> {
  const editor = activeYamdEditor();
  if (!editor) {
    void vscode.window.showInformationMessage('YAMD: Open a YAMD note to insert a database view.');
    return;
  }
  const type = await vscode.window.showQuickPick([...VIEW_TYPES], { title: 'YAMD: Insert Database View', placeHolder: 'View type' });
  if (!type) return;
  const alias = (await vscode.window.showInputBox({ prompt: 'Alias (blank to query this workspace\'s notes)', placeHolder: 'tasks' })) ?? '';
  const text = `::db${alias ? `[${alias}]` : ''}{type=${type}}`;
  await editor.insertSnippet(new vscode.SnippetString(text));
}

export function registerDatabaseWizard(context: vscode.ExtensionContext): void {
  context.subscriptions.push(vscode.commands.registerCommand('yamd.insertDatabaseView', () => insertDatabaseView()));
}
