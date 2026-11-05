import * as path from 'node:path';
import * as vscode from 'vscode';
import { convertFromMarkdown, joinParagraphLines } from '../core';
import { stripNoteExt } from '../core/notes';

/** "YAMD: Convert from Markdown": rewrites the active document in one undoable edit. */
async function convertActive(): Promise<void> {
  const editor = vscode.window.activeTextEditor;
  if (!editor) {
    void vscode.window.showInformationMessage('YAMD: Open a file to convert it.');
    return;
  }
  const doc = editor.document;
  const result = convertFromMarkdown(doc.getText());
  if (result.text === doc.getText()) {
    void vscode.window.showInformationMessage('YAMD: Nothing to convert; this file already renders as it does on GitHub.');
    return;
  }
  const edit = new vscode.WorkspaceEdit();
  edit.replace(doc.uri, new vscode.Range(doc.positionAt(0), doc.positionAt(doc.getText().length)), result.text);
  await vscode.workspace.applyEdit(edit);
  void vscode.window.showInformationMessage(
    `YAMD: Converted from Markdown (${result.escaped} escapes, ${result.joined} joined lines).`,
  );
}

/** "YAMD: Open Markdown as YAMD": writes a converted `.yamd` copy next to a `.md` file and opens it. */
async function openMarkdownAsYamd(uri?: vscode.Uri): Promise<void> {
  const source = uri ?? vscode.window.activeTextEditor?.document.uri;
  if (!source || !/\.(md|markdown)$/i.test(source.path)) {
    void vscode.window.showInformationMessage('YAMD: Choose a Markdown (.md) file to open as YAMD.');
    return;
  }
  const bytes = await vscode.workspace.fs.readFile(source);
  const { text } = convertFromMarkdown(new TextDecoder().decode(bytes));
  let target = source.with({ path: source.path.replace(/\.(md|markdown)$/i, '.yamd') });
  if (await exists(target)) {
    const overwrite = 'Overwrite';
    const other = 'Choose Another Name';
    const choice = await vscode.window.showWarningMessage(
      `${path.basename(target.path)} already exists.`,
      { modal: true },
      overwrite,
      other,
    );
    if (choice === undefined) return;
    if (choice === other) {
      const picked = await vscode.window.showSaveDialog({ defaultUri: target, filters: { YAMD: ['yamd'] } });
      if (!picked) return;
      target = picked;
    }
  }
  await vscode.workspace.fs.writeFile(target, new TextEncoder().encode(text));
  await vscode.window.showTextDocument(target);
}

/** A front-matter block auto-filled from the file name and today's date, for a note that lacks one. */
function autoFrontMatter(fileName: string): string {
  const title = stripNoteExt(fileName);
  const date = new Date().toISOString().slice(0, 10);
  const lang = vscode.workspace.getConfiguration('yamd.newNote').get<string>('lang', 'en');
  return `---\ntitle: ${JSON.stringify(title)}\ndate: ${date}\nlang: ${lang}\n---\n\n`;
}

/** "YAMD: Add Front Matter": inserts an auto-filled front-matter block if the active note doesn't have one. */
async function addFrontMatter(): Promise<void> {
  const editor = vscode.window.activeTextEditor;
  if (!editor || editor.document.languageId !== 'yamd') {
    void vscode.window.showInformationMessage('YAMD: Open a YAMD note to add front matter to it.');
    return;
  }
  const doc = editor.document;
  if (/^---\r?\n/.test(doc.getText())) {
    void vscode.window.showInformationMessage('YAMD: This note already has front matter.');
    return;
  }
  await editor.edit((b) => b.insert(new vscode.Position(0, 0), autoFrontMatter(path.basename(doc.uri.fsPath))));
}

/**
 * "YAMD: Convert Markdown File to YAMD": renames a `.md`/`.markdown` file to `.yamd` in place,
 * converts its body, and adds front matter if it doesn't already have one.
 */
async function convertMarkdownToYamdFile(uri?: vscode.Uri): Promise<void> {
  const source = uri ?? vscode.window.activeTextEditor?.document.uri;
  if (!source || !/\.(md|markdown)$/i.test(source.path)) {
    void vscode.window.showInformationMessage('YAMD: Choose a Markdown (.md) file to convert.');
    return;
  }
  const target = source.with({ path: source.path.replace(/\.(md|markdown)$/i, '.yamd') });
  if (await exists(target)) {
    void vscode.window.showErrorMessage(`YAMD: ${path.basename(target.path)} already exists.`);
    return;
  }
  const bytes = await vscode.workspace.fs.readFile(source);
  const { text } = convertFromMarkdown(new TextDecoder().decode(bytes));
  const withFrontMatter = /^---\r?\n/.test(text) ? text : autoFrontMatter(path.basename(target.path)) + text;
  await vscode.workspace.fs.rename(source, target);
  await vscode.workspace.fs.writeFile(target, new TextEncoder().encode(withFrontMatter));
  await vscode.window.showTextDocument(target);
}

async function exists(uri: vscode.Uri): Promise<boolean> {
  try {
    await vscode.workspace.fs.stat(uri);
    return true;
  } catch {
    return false;
  }
}

/** Quick fix for Y210: joins a hard-wrapped paragraph into one line. */
class JoinWrappedLines implements vscode.CodeActionProvider {
  static readonly kinds = [vscode.CodeActionKind.QuickFix];

  provideCodeActions(doc: vscode.TextDocument, _range: vscode.Range, context: vscode.CodeActionContext) {
    return context.diagnostics
      .filter((d) => d.source === 'yamd' && d.code === 'Y210')
      .map((d) => {
        const lines: string[] = [];
        for (let l = d.range.start.line; l <= d.range.end.line; l++) lines.push(doc.lineAt(l).text);
        const range = new vscode.Range(d.range.start.line, 0, d.range.end.line, doc.lineAt(d.range.end.line).text.length);
        const action = new vscode.CodeAction('Join wrapped lines', vscode.CodeActionKind.QuickFix);
        action.edit = new vscode.WorkspaceEdit();
        action.edit.replace(doc.uri, range, joinParagraphLines(lines));
        action.diagnostics = [d];
        action.isPreferred = true;
        return action;
      });
  }
}

export function registerMigration(context: vscode.ExtensionContext): void {
  context.subscriptions.push(
    vscode.commands.registerCommand('yamd.convertFromMarkdown', convertActive),
    vscode.commands.registerCommand('yamd.openMarkdownAsYamd', openMarkdownAsYamd),
    vscode.commands.registerCommand('yamd.addFrontMatter', addFrontMatter),
    vscode.commands.registerCommand('yamd.convertMarkdownToYamdFile', convertMarkdownToYamdFile),
    vscode.languages.registerCodeActionsProvider('yamd', new JoinWrappedLines(), {
      providedCodeActionKinds: JoinWrappedLines.kinds,
    }),
  );
}
