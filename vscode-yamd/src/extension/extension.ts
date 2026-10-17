import * as vscode from 'vscode';
import { registerEditingCommands } from './commands';
import { DatabaseService } from './databases';
import { registerDatabaseFeatures } from './dbFeatures';
import { DiagnosticsProvider } from './diagnostics';
import { registerMigration } from './migration';
import { PreviewManager } from './preview';
import { registerDailyNotes } from '../workspace/daily';
import { registerNoteFeatures } from '../workspace/features';
import { GraphPanel } from '../workspace/graph';
import { WorkspaceIndex } from '../workspace/index';
import { registerNewNote } from '../workspace/newNote';
import { registerViews } from '../workspace/views';

export function activate(context: vscode.ExtensionContext): void {
  const log = vscode.window.createOutputChannel('YAMD');
  const index = new WorkspaceIndex(log, context.extensionUri);
  const db = new DatabaseService(context.extensionUri, index);
  const preview = new PreviewManager(context.extensionUri, index, db);
  const graph = new GraphPanel(context.extensionUri, index);
  context.subscriptions.push(log, index, db, preview, graph, new DiagnosticsProvider(index));
  registerDatabaseFeatures(context, db);
  registerNoteFeatures(context, index);
  registerViews(context, index);
  registerDailyNotes(context);
  registerNewNote(context);

  const openPreview = (toSide: boolean) => (uri?: vscode.Uri) => {
    const editor = vscode.window.activeTextEditor;
    const doc =
      (uri && vscode.workspace.textDocuments.find((d) => d.uri.toString() === uri.toString())) ?? editor?.document;
    if (doc?.languageId !== 'yamd') {
      void vscode.window.showInformationMessage('YAMD: Open a .yamd file to preview it.');
      return;
    }
    preview.show(doc, toSide);
  };

  context.subscriptions.push(
    vscode.commands.registerCommand('yamd.openPreview', openPreview(false)),
    vscode.commands.registerCommand('yamd.openPreviewToSide', openPreview(true)),
    vscode.commands.registerCommand('yamd.openGraph', () => graph.show('global')),
    vscode.commands.registerCommand('yamd.openLocalGraph', () => graph.show('local')),
  );
  registerEditingCommands(context);
  registerMigration(context);
}

export function deactivate(): void {}
