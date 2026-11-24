import * as vscode from 'vscode';
import { computeBoardEdit } from '../../core/widgets/boardEdit';
import type { BoardEditMessage } from '../../core/widgets/boardEdit';
import type { WidgetBlock } from '../../core/widgets/fences';
import { bodyEdit } from '../../core/widgets/widgetBody';
import { folderImages } from './widgets';

/** The note's block as a one-container document, so the board renderer and its edit logic apply unchanged. */
export function syntheticSource(doc: vscode.TextDocument, block: WidgetBlock): string {
  const body: string[] = [];
  for (let l = block.bodyStartLine; l <= block.bodyEndLine; l++) body.push(doc.lineAt(l).text);
  if (block.type === 'gallery' && block.attrs['source'] && body.every((l) => l.trim() === '')) body.push(...folderImages(doc, block.attrs['source']));
  return [`:::${block.type}`, ...body, ':::'].join('\n');
}

/**
 * Applies a board edit (add, move, rename…) to a widget block of the note as one undoable change, and saves.
 * Returns false when the block is unwritable, the edit is refused (the note moved on), or it could not be applied.
 */
export async function applyBlockEdit(doc: vscode.TextDocument, block: WidgetBlock, m: Pick<BoardEditMessage, 'kind' | 'op' | 'board' | 'card' | 'args'>): Promise<boolean> {
  if (!block.closed || vscode.workspace.fs.isWritableFileSystem(doc.uri.scheme) === false) return false;
  const synthetic = syntheticSource(doc, block);
  const edit = computeBoardEdit(synthetic, m);
  const change = edit ? bodyEdit(synthetic, edit, block.bodyStartLine) : null;
  if (!change) return false;
  const workspaceEdit = new vscode.WorkspaceEdit();
  workspaceEdit.replace(doc.uri, new vscode.Range(change.startLine, 0, change.startLine + change.removeCount, 0), change.lines.map((l) => `${l}\n`).join(''));
  if (!(await vscode.workspace.applyEdit(workspaceEdit))) return false;
  if (!doc.isUntitled) await doc.save();
  return true;
}
