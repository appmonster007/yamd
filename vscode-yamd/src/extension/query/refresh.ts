import * as vscode from 'vscode';
import { diffLines } from '../../core/build/diff';
import { findRegions } from '../../core/build/markers';
import { writeSnapshot } from '../../core/query/snapshot';
import { lineDiffEdit } from '../build/buildCommands';
import { linesOf, widgetsOf } from '../widgets/widgets';
import { runBlockQuery } from './queryWidget';

/**
 * The edit that brings the snapshots of a note's named query blocks up to date. With `onlyExisting`, only
 * blocks that already have a snapshot are touched; otherwise every named query gets one.
 */
export async function refreshSnapshots(doc: vscode.TextDocument, onlyExisting: boolean): Promise<{ edit?: vscode.TextEdit; lines: string[]; refreshed: number; failed: string[] }> {
  const before = linesOf(doc);
  let lines = before;
  let refreshed = 0;
  const failed: string[] = [];
  // From the bottom up, so a snapshot added below doesn't move the blocks still to do.
  const queries = widgetsOf(doc).filter((w) => w.type === 'sql' && w.closed && w.id !== undefined).reverse();
  for (const w of queries) {
    const id = w.id as string;
    if (onlyExisting && !findRegions(lines).some((r) => r.name === `query:${id}`)) continue;
    const outcome = await runBlockQuery(doc, w);
    if (!outcome.ok) {
      failed.push(`${id}: ${outcome.problem.message}`);
      continue;
    }
    lines = writeSnapshot(lines, id, w.endLine, outcome.result, new Date());
    refreshed++;
  }
  const diff = diffLines(before, lines);
  return { ...(diff ? { edit: lineDiffEdit(doc, diff) } : {}), lines, refreshed, failed };
}

/** `YAMD: Run All Queries`, and the opt-in refresh of existing snapshots when a note is saved. */
export function registerRefresh(context: vscode.ExtensionContext): void {
  context.subscriptions.push(
    vscode.commands.registerCommand('yamd.runAllQueries', async () => {
      const editor = vscode.window.activeTextEditor;
      if (!editor || editor.document.languageId !== 'markdown') {
        void vscode.window.showInformationMessage('YAMD: Open a Markdown note first.');
        return;
      }
      if (!vscode.workspace.isTrusted) {
        void vscode.window.showWarningMessage('YAMD: Trust this workspace to write query results into the note.');
        return;
      }
      const { edit, refreshed, failed } = await refreshSnapshots(editor.document, false);
      if (edit) await editor.edit((b) => b.replace(edit.range, edit.newText));
      const note = refreshed ? `${refreshed} snapshot${refreshed === 1 ? '' : 's'} ${edit ? 'updated' : 'already current'}.` : 'No named query blocks to run. Give each an id first.';
      if (failed.length) void vscode.window.showWarningMessage(`YAMD: ${note} ${failed.join(' ')}`);
      else void vscode.window.setStatusBarMessage(`YAMD: ${note}`, 4000);
    }),
    vscode.workspace.onWillSaveTextDocument((e) => {
      if (e.document.languageId !== 'markdown' || !vscode.workspace.isTrusted || !vscode.workspace.getConfiguration('yamd.queries').get<boolean>('refreshOnSave', false)) return;
      e.waitUntil(refreshSnapshots(e.document, true).then((r) => (r.edit ? [r.edit] : [])));
    }),
  );
}
