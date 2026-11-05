import * as path from 'node:path';
import * as vscode from 'vscode';
import { COMPANIONS, companionFor, dataKind } from '../../core/companions';
import type { Companion } from '../../core/companions';
import { querySource, querySql } from '../query/queryWidget';
import { widgetsOf } from '../widgets/widgets';

/** True when `companion` is installed; otherwise offers to install it and returns whether that worked. */
async function ensureCompanion(companion: Companion): Promise<boolean> {
  if (vscode.extensions.getExtension(companion.id)) return true;
  const choice = await vscode.window.showInformationMessage(`YAMD: This uses the "${companion.name}" extension, which isn't installed.`, 'Install');
  if (choice !== 'Install') return false;
  try {
    await vscode.commands.executeCommand('workbench.extensions.installExtension', companion.id);
  } catch {
    void vscode.window.showErrorMessage(`YAMD: Couldn't install "${companion.name}". Install it from the Extensions view.`);
    return false;
  }
  const ext = vscode.extensions.getExtension(companion.id);
  if (!ext) {
    void vscode.window.showInformationMessage(`YAMD: "${companion.name}" was installed. Reload the window, then run the command again.`);
    return false;
  }
  await ext.activate();
  return true;
}

/** The data file of the query block at the cursor, or one the user picks. */
async function pickDataFile(): Promise<{ uri: vscode.Uri; sql?: string } | undefined> {
  const editor = vscode.window.activeTextEditor;
  if (editor?.document.languageId === 'markdown') {
    const doc = editor.document;
    const at = editor.selection.active.line;
    const block = widgetsOf(doc).find((w) => w.type === 'sql' && w.startLine <= at && at <= w.endLine);
    const source = block && querySource(doc, block);
    if (block && source) return { uri: source, sql: querySql(doc, block) };
  }
  const picked = await vscode.window.showOpenDialog({ canSelectMany: false, filters: { Data: ['csv', 'json', 'sqlite', 'sqlite3', 'db'] }, openLabel: 'Open' });
  return picked?.[0] ? { uri: picked[0] } : undefined;
}

async function openData(uri: vscode.Uri, sql?: string): Promise<void> {
  const kind = dataKind(uri.fsPath);
  const companion = kind && companionFor(kind);
  if (!kind || kind === 'json' || !companion) {
    await vscode.commands.executeCommand('vscode.open', uri);
    return;
  }
  if (!(await ensureCompanion(companion))) return;
  if (kind === 'sqlite') {
    await vscode.commands.executeCommand('vscode.openWith', uri, 'sqlite3-editor.editor');
  } else {
    await vscode.window.showTextDocument(await vscode.workspace.openTextDocument(uri));
    await vscode.commands.executeCommand('edit-csv.edit');
  }
  if (sql) {
    // The companion runs the SQL; this puts the query where it can be pasted.
    await vscode.env.clipboard.writeText(sql);
    void vscode.window.setStatusBarMessage(`YAMD: Query copied for ${path.basename(uri.fsPath)}.`, 4000);
  }
}

/** Alias commands: YAMD hands data editing, SQL writes and daily notes to the companion extensions. */
export function registerAliases(context: vscode.ExtensionContext): void {
  context.subscriptions.push(
    vscode.commands.registerCommand('yamd.openInSqlClient', async () => {
      const picked = await pickDataFile();
      if (picked) await openData(picked.uri, picked.sql);
    }),
    vscode.commands.registerCommand('yamd.openInSqliteEditor', async () => {
      const picked = await pickDataFile();
      if (picked) await openData(picked.uri);
    }),
    vscode.commands.registerCommand('yamd.openInCsvEditor', async () => {
      const picked = await pickDataFile();
      if (picked) await openData(picked.uri);
    }),
    vscode.commands.registerCommand('yamd.openDailyNote', async () => {
      if (await ensureCompanion(COMPANIONS.foam)) await vscode.commands.executeCommand('foam-vscode.open-daily-note');
    }),
  );
}
