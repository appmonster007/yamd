import * as vscode from 'vscode';
import { writeSnapshot } from '../../core/query/snapshot';
import { runBlockQuery } from './queryWidget';
import { linesOf, widgetsOf } from '../widgets/widgets';

/** `YAMD: Run Query`: writes a Markdown snapshot of a query block's result under the block. */
export function registerQueryCommands(context: vscode.ExtensionContext): void {
  context.subscriptions.push(
    vscode.commands.registerCommand('yamd.runQuery', async () => {
      const editor = vscode.window.activeTextEditor;
      if (!editor || editor.document.languageId !== 'markdown') {
        void vscode.window.showInformationMessage('YAMD: Open a Markdown note with a query block first.');
        return;
      }
      if (!vscode.workspace.isTrusted) {
        void vscode.window.showWarningMessage('YAMD: Trust this workspace to write query results into the note.');
        return;
      }
      const doc = editor.document;
      const queries = widgetsOf(doc).filter((w) => w.type === 'sql' && w.closed);
      if (!queries.length) {
        void vscode.window.showInformationMessage('YAMD: This note has no query blocks.');
        return;
      }
      const at = editor.selection.active.line;
      let block = queries.find((w) => w.startLine <= at && at <= w.endLine);
      if (!block) {
        const pick = await vscode.window.showQuickPick(queries.map((w) => ({ label: w.label, description: w.attrs['source'], w })), { placeHolder: 'Run which query?' });
        block = pick?.w;
      }
      if (!block) return;
      if (block.id === undefined) {
        void vscode.window.showWarningMessage('YAMD: Name this query first ("YAMD: Name Block") so its snapshot has a stable marker.');
        return;
      }
      const outcome = await runBlockQuery(doc, block);
      if (!outcome.ok) {
        void vscode.window.showErrorMessage(`YAMD ${outcome.problem.code}: ${outcome.problem.message}`);
        return;
      }
      const before = linesOf(doc);
      const after = writeSnapshot(before, block.id, block.endLine, outcome.result, new Date());
      // Replace the whole region only: find the changed span.
      let a = 0;
      while (a < before.length && a < after.length && before[a] === after[a]) a++;
      let b = 0;
      while (b < before.length - a && b < after.length - a && before[before.length - 1 - b] === after[after.length - 1 - b]) b++;
      const edit = new vscode.WorkspaceEdit();
      const range = new vscode.Range(a, 0, before.length - b, 0);
      edit.replace(doc.uri, range, after.slice(a, after.length - b).map((l) => `${l}\n`).join(''));
      await vscode.workspace.applyEdit(edit);
      void vscode.window.setStatusBarMessage(`YAMD: ${outcome.result.total} row${outcome.result.total === 1 ? '' : 's'} written for "${block.id}".`, 4000);
    }),
  );
}
