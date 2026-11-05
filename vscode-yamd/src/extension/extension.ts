import * as vscode from 'vscode';
import { registerBlockCommands } from './blockCommands';
import { registerEditingCommands } from './commands';
import { DatabaseService } from './databases';
import { registerDatabaseFeatures } from './dbFeatures';
import { registerDatabaseWizard } from './databaseWizard';
import { DiagnosticsProvider } from './diagnostics';
import { registerInsertCommands } from './insertCommands';
import { registerQueryCommands } from './queryCommands';
import { registerWidgetDiagnostics } from './widgetDiagnostics';
import { registerWidgetPanels } from './widgetPanel';
import { registerMigration } from './migration';
import { LivePreview } from './livePreview';
import { PreviewManager } from './preview';
import { registerDailyNotes } from '../workspace/daily';
import { registerNoteFeatures } from '../workspace/features';
import { GraphPanel } from '../workspace/graph';
import { WorkspaceIndex } from '../workspace/index';
import { registerNavigation } from '../workspace/navigation';
import { registerNewNote } from '../workspace/newNote';
import { registerViews } from '../workspace/views';
import { DashboardPanel } from '../study/dashboard';
import { ReviewPanel } from '../study/review';
import { StudyTimer } from '../study/timer';
import { registerStudyCommands } from '../study/commands';

export function activate(context: vscode.ExtensionContext): void {
  const log = vscode.window.createOutputChannel('YAMD');
  const index = new WorkspaceIndex(log, context.extensionUri);
  const db = new DatabaseService(context.extensionUri, index);
  const preview = new PreviewManager(context.extensionUri, index, db);
  const livePreview = new LivePreview();
  const graph = new GraphPanel(context.extensionUri, index);
  const reviewPanel = new ReviewPanel(context.extensionUri, index);
  const dashboard = new DashboardPanel(index);
  const timer = new StudyTimer();
  const diagnostics = new DiagnosticsProvider(index);
  context.subscriptions.push(log, index, db, preview, livePreview, graph, diagnostics, reviewPanel, dashboard, timer);
  registerDatabaseFeatures(context, db);
  registerDatabaseWizard(context);
  registerNoteFeatures(context, index);
  registerViews(context, index);
  registerDailyNotes(context);
  registerNewNote(context);
  registerNavigation(context, index);
  registerInsertCommands(context, index);
  registerBlockCommands(context);
  registerStudyCommands(context, index, reviewPanel, dashboard, timer);
  context.subscriptions.push(
    vscode.commands.registerCommand('yamd.validateDocument', async () => {
      const doc = vscode.window.activeTextEditor?.document;
      if (!doc || doc.languageId !== 'yamd') {
        void vscode.window.showInformationMessage('YAMD: Open a .yamd file first.');
        return;
      }
      await diagnostics.refreshNow(doc);
      await vscode.commands.executeCommand('workbench.actions.view.problems');
    }),
  );

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
    vscode.commands.registerCommand('yamd.openPreviewInEditor', (uri?: vscode.Uri) => preview.showPreviewInTab(uri)),
    vscode.commands.registerCommand('yamd.showSource', (uri?: vscode.Uri, line?: number) => preview.showSource(uri, line)),
    vscode.commands.registerCommand('yamd.toggleEditorMode', () => preview.toggleMode()),
    vscode.commands.registerCommand('yamd.toggleLivePreview', () => livePreview.toggle()),
    vscode.commands.registerCommand('yamd.lockPreview', () => preview.setLocked(true)),
    vscode.commands.registerCommand('yamd.unlockPreview', () => preview.setLocked(false)),
    vscode.commands.registerCommand('yamd.togglePreviewLock', () => preview.setLocked()),
    vscode.commands.registerCommand('yamd.openGraph', () => graph.show('global')),
    vscode.commands.registerCommand('yamd.openLocalGraph', () => graph.show('local')),
    vscode.commands.registerCommand('yamd.toggleQuizInternal', () => preview.toggleQuiz()),
  );
  registerEditingCommands(context);
  registerMigration(context);
  registerWidgetDiagnostics(context);
  registerWidgetPanels(context);
  registerQueryCommands(context);
}

export function deactivate(): void {}
