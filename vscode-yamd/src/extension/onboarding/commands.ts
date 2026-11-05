import * as vscode from 'vscode';
import { MENU } from '../../core/onboarding/menu';
import { NOTE_TEMPLATES, SAMPLE_NOTE } from '../../core/templates/notes';
import { chooseFolder, createNote } from '../shared/files';

/** `YAMD: Menu` (and a status-bar button for it), `YAMD: New Note`, the sample note and the walkthrough. */
export function registerOnboarding(context: vscode.ExtensionContext): void {
  const item = vscode.window.createStatusBarItem(vscode.StatusBarAlignment.Right, 90);
  item.text = '$(layout) YAMD';
  item.tooltip = 'YAMD: open the menu';
  item.command = 'yamd.menu';
  const sync = () => {
    const show = vscode.window.activeTextEditor?.document.languageId === 'markdown' && vscode.workspace.getConfiguration('yamd.statusBar').get<boolean>('enabled', true);
    if (show) item.show();
    else item.hide();
  };
  sync();

  context.subscriptions.push(
    item,
    vscode.window.onDidChangeActiveTextEditor(sync),
    vscode.workspace.onDidChangeConfiguration((e) => e.affectsConfiguration('yamd.statusBar') && sync()),

    vscode.commands.registerCommand('yamd.menu', async () => {
      const entries: (vscode.QuickPickItem & { command?: string })[] = MENU.flatMap((g) => [
        { label: g.title, kind: vscode.QuickPickItemKind.Separator },
        ...g.items.map((i) => ({ label: i.label, ...(i.description ? { description: i.description } : {}), command: i.command })),
      ]);
      const pick = await vscode.window.showQuickPick(entries, { placeHolder: 'What do you want to do?', matchOnDescription: true });
      if (pick?.command) await vscode.commands.executeCommand(pick.command);
    }),

    vscode.commands.registerCommand('yamd.newNote', async (clicked?: vscode.Uri) => {
      const pick = await vscode.window.showQuickPick(
        NOTE_TEMPLATES.map((t) => ({ label: t.label, description: t.description, id: t.id })),
        { placeHolder: 'Start the note from…' },
      );
      if (!pick) return;
      const template = NOTE_TEMPLATES.find((t) => t.id === pick.id)!;
      const title = await vscode.window.showInputBox({ prompt: 'Note title', value: template.id === 'empty' ? '' : template.label, validateInput: (v) => (v.trim() ? undefined : 'Give the note a title.') });
      if (!title) return;
      const folder = await chooseFolder(clicked instanceof vscode.Uri ? clicked : undefined);
      if (folder) await createNote(folder, title.trim(), template);
    }),

    vscode.commands.registerCommand('yamd.createSampleNote', async () => {
      const folder = await chooseFolder();
      if (folder) await createNote(folder, 'Welcome to YAMD', SAMPLE_NOTE);
    }),

    vscode.commands.registerCommand('yamd.openSettings', () => vscode.commands.executeCommand('workbench.action.openSettings', '@ext:appmonster007.vscode-yamd-ext')),
    vscode.commands.registerCommand('yamd.openWalkthrough', () => vscode.commands.executeCommand('workbench.action.openWalkthrough', 'appmonster007.vscode-yamd-ext#yamd.start', false)),
  );

  // Offer the walkthrough once, the first time the extension runs.
  if (!context.globalState.get<boolean>('yamd.welcomed')) {
    void context.globalState.update('yamd.welcomed', true);
    void vscode.window.showInformationMessage('YAMD is ready. A short walkthrough shows what it does.', 'Open Walkthrough').then((c) => {
      if (c) void vscode.commands.executeCommand('yamd.openWalkthrough');
    });
  }
}
