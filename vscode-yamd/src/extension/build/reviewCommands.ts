import * as vscode from 'vscode';
import { findReviewSpans, resolveReview, spanAt } from '../../core/build/review';
import type { ReviewMode } from '../../core/build/review';

function active(): vscode.TextEditor | undefined {
  const editor = vscode.window.activeTextEditor;
  if (!editor || editor.document.languageId !== 'markdown') {
    void vscode.window.showInformationMessage('YAMD: Open a Markdown note first.');
    return undefined;
  }
  return editor;
}

/** Accepts or rejects the change under the cursor, or every change inside the selection. */
async function resolveHere(mode: ReviewMode): Promise<void> {
  const editor = active();
  if (!editor) return;
  const doc = editor.document;
  const text = doc.getText();
  const sel = editor.selection;
  const from = doc.offsetAt(sel.start);
  const to = doc.offsetAt(sel.end);
  const hit = sel.isEmpty ? spanAt(text, from) : undefined;
  const spans = sel.isEmpty ? (hit ? [hit] : []) : findReviewSpans(text).filter((s) => s.end > from && s.start < to);
  if (!spans.length) {
    void vscode.window.showInformationMessage('YAMD: No change (<ins> or <del>) at the cursor.');
    return;
  }
  const edit = new vscode.WorkspaceEdit();
  for (const s of [...spans].reverse()) {
    const keep = (s.kind === 'ins') === (mode === 'accept') ? s.inner : '';
    edit.replace(doc.uri, new vscode.Range(doc.positionAt(s.start), doc.positionAt(s.end)), keep);
  }
  await vscode.workspace.applyEdit(edit);
}

async function resolveAll(mode: ReviewMode): Promise<void> {
  const editor = active();
  if (!editor) return;
  const doc = editor.document;
  const text = doc.getText();
  const next = resolveReview(text, mode);
  if (next === text) {
    void vscode.window.showInformationMessage('YAMD: This note has no changes to resolve.');
    return;
  }
  const edit = new vscode.WorkspaceEdit();
  edit.replace(doc.uri, new vscode.Range(doc.positionAt(0), doc.positionAt(text.length)), next);
  await vscode.workspace.applyEdit(edit);
}

export function registerReviewCommands(context: vscode.ExtensionContext): void {
  context.subscriptions.push(
    vscode.commands.registerCommand('yamd.acceptChange', () => resolveHere('accept')),
    vscode.commands.registerCommand('yamd.rejectChange', () => resolveHere('reject')),
    vscode.commands.registerCommand('yamd.acceptAllChanges', () => resolveAll('accept')),
    vscode.commands.registerCommand('yamd.rejectAllChanges', () => resolveAll('reject')),
  );
}
