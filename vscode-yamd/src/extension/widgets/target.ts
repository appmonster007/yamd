import * as vscode from 'vscode';
import type { WidgetBlock } from '../../core/widgets/fences';
import { widgetsOf } from './widgets';

export interface Target {
  doc: vscode.TextDocument;
  block: WidgetBlock;
}

/**
 * The widget block a command is about. From a CodeLens it is the block named by `uri` and `startLine`;
 * from the palette it is the block under the cursor, else the only block of the allowed type(s), else
 * the one picked from a list.
 */
export async function targetBlock(types: string[] | undefined, noun: string, uri?: unknown, startLine?: unknown): Promise<Target | undefined> {
  if (uri instanceof vscode.Uri && typeof startLine === 'number') {
    const doc = await vscode.workspace.openTextDocument(uri);
    const block = widgetsOf(doc).find((w) => w.startLine === startLine);
    return block ? { doc, block } : undefined;
  }
  const editor = vscode.window.activeTextEditor;
  const doc = editor?.document;
  if (!editor || !doc || doc.languageId !== 'markdown') {
    void vscode.window.showInformationMessage('YAMD: Open a Markdown note first.');
    return undefined;
  }
  const allowed = widgetsOf(doc).filter((w) => !types || types.includes(w.type));
  const line = editor.selection.active.line;
  const here = allowed.find((w) => w.startLine <= line && line <= w.endLine);
  if (here) return { doc, block: here };
  if (!allowed.length) {
    void vscode.window.showInformationMessage(`YAMD: This note has no ${noun} blocks. Use "YAMD: Insert Widget" to add one.`);
    return undefined;
  }
  if (allowed.length === 1) return { doc, block: allowed[0] as WidgetBlock };
  const pick = await vscode.window.showQuickPick(allowed.map((w) => ({ label: w.label, description: w.type, detail: `line ${w.startLine + 1}`, w })), { placeHolder: `Which ${noun}?` });
  return pick ? { doc, block: pick.w } : undefined;
}
