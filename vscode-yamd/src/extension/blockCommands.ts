import * as vscode from 'vscode';
import { allFences, blockSnippet, findEnclosingFence, findUnclosedFence, knownDirectives, matchingFenceLine } from './blocks';

function docLines(doc: vscode.TextDocument): string[] {
  return Array.from({ length: doc.lineCount }, (_, i) => doc.lineAt(i).text);
}

/** "YAMD: Insert Block…": picks a directive and inserts an opening/closing fence (or a leaf line). */
async function insertBlock(editor: vscode.TextEditor): Promise<void> {
  const items = knownDirectives().map((d) => ({
    label: d.name,
    description: d.isContainer ? 'container' : 'leaf',
    d,
  }));
  const pick = await vscode.window.showQuickPick(items, { title: 'YAMD: Insert Block', placeHolder: 'Choose a directive' });
  if (!pick) return;
  const { text, cursorOffset } = blockSnippet(pick.d);
  const s = new vscode.SnippetString();
  s.appendText(text.slice(0, cursorOffset));
  s.appendTabstop(0);
  s.appendText(text.slice(cursorOffset));
  await editor.insertSnippet(s);
}

/** "YAMD: Close Current Block": inserts `:::` to close the nearest unclosed container. */
async function closeBlock(editor: vscode.TextEditor): Promise<void> {
  const line = editor.selection.active.line;
  const fence = findUnclosedFence(docLines(editor.document), line);
  if (!fence) {
    void vscode.window.showInformationMessage('YAMD: No open block to close here.');
    return;
  }
  const pos = editor.selection.active;
  await editor.edit((b) => b.insert(pos, pos.character === 0 ? ':::\n' : '\n:::'));
}

/** "YAMD: Jump to Matching Fence": moves the cursor to the other end of the current `:::` line. */
async function jumpToMatchingFence(editor: vscode.TextEditor): Promise<void> {
  const line = editor.selection.active.line;
  const match = matchingFenceLine(docLines(editor.document), line);
  if (match === undefined) {
    void vscode.window.showInformationMessage('YAMD: Place the cursor on a ::: fence line.');
    return;
  }
  const pos = new vscode.Position(match, 0);
  editor.selection = new vscode.Selection(pos, pos);
  editor.revealRange(new vscode.Range(pos, pos));
}

/** "YAMD: Select Block": selects the fence under the cursor and everything between. */
async function selectBlock(editor: vscode.TextEditor): Promise<void> {
  const fence = findEnclosingFence(docLines(editor.document), editor.selection.active.line);
  if (!fence) {
    void vscode.window.showInformationMessage('YAMD: Place the cursor inside a ::: block.');
    return;
  }
  const end = editor.document.lineAt(fence.closeLine).range.end;
  editor.selection = new vscode.Selection(new vscode.Position(fence.openLine, 0), end);
}

/** "YAMD: Unwrap Block": removes the opening/closing fence lines, keeping the content between them. */
async function unwrapBlock(editor: vscode.TextEditor): Promise<void> {
  const fence = findEnclosingFence(docLines(editor.document), editor.selection.active.line);
  if (!fence) {
    void vscode.window.showInformationMessage('YAMD: Place the cursor inside a ::: block.');
    return;
  }
  const doc = editor.document;
  await editor.edit((b) => {
    b.delete(doc.lineAt(fence.closeLine).rangeIncludingLineBreak);
    b.delete(doc.lineAt(fence.openLine).rangeIncludingLineBreak);
  });
}

/** "YAMD: Duplicate Block": copies the fence under the cursor, fences included, right after it. */
async function duplicateBlock(editor: vscode.TextEditor): Promise<void> {
  const doc = editor.document;
  const fence = findEnclosingFence(docLines(editor.document), editor.selection.active.line);
  if (!fence) {
    void vscode.window.showInformationMessage('YAMD: Place the cursor inside a ::: block.');
    return;
  }
  const range = new vscode.Range(fence.openLine, 0, fence.closeLine, doc.lineAt(fence.closeLine).text.length);
  const text = doc.getText(range);
  const insertAt = doc.lineAt(fence.closeLine).rangeIncludingLineBreak.end;
  await editor.edit((b) => b.insert(insertAt, `${text}\n`));
}

/** "YAMD: Change Block Type…": swaps the directive name on the opening fence. */
async function changeBlockType(editor: vscode.TextEditor): Promise<void> {
  const doc = editor.document;
  const fence = findEnclosingFence(docLines(editor.document), editor.selection.active.line);
  if (!fence) {
    void vscode.window.showInformationMessage('YAMD: Place the cursor inside a ::: block.');
    return;
  }
  const items = knownDirectives()
    .filter((d) => d.isContainer)
    .map((d) => ({ label: d.name, d }));
  const pick = await vscode.window.showQuickPick(items, { title: 'YAMD: Change Block Type', placeHolder: 'New directive name' });
  if (!pick) return;
  const openRange = doc.lineAt(fence.openLine).range;
  await editor.edit((b) => b.replace(openRange, `:::${pick.d.name}`));
}

/** Folding for `:::name ... :::` containers, built on the same fence scanner the block commands use. */
class DirectiveFoldingProvider implements vscode.FoldingRangeProvider {
  provideFoldingRanges(document: vscode.TextDocument): vscode.FoldingRange[] {
    const lines = Array.from({ length: document.lineCount }, (_, i) => document.lineAt(i).text);
    return allFences(lines).map((f) => new vscode.FoldingRange(f.openLine, f.closeLine));
  }
}

function wrap(fn: (editor: vscode.TextEditor) => Promise<void>) {
  return (editor: vscode.TextEditor) => void fn(editor);
}

export function registerBlockCommands(context: vscode.ExtensionContext): void {
  context.subscriptions.push(
    vscode.commands.registerTextEditorCommand('yamd.insertBlock', wrap(insertBlock)),
    vscode.commands.registerTextEditorCommand('yamd.closeBlock', wrap(closeBlock)),
    vscode.commands.registerTextEditorCommand('yamd.jumpToMatchingFence', wrap(jumpToMatchingFence)),
    vscode.commands.registerTextEditorCommand('yamd.selectBlock', wrap(selectBlock)),
    vscode.commands.registerTextEditorCommand('yamd.unwrapBlock', wrap(unwrapBlock)),
    vscode.commands.registerTextEditorCommand('yamd.duplicateBlock', wrap(duplicateBlock)),
    vscode.commands.registerTextEditorCommand('yamd.changeBlockType', wrap(changeBlockType)),
    vscode.languages.registerFoldingRangeProvider('yamd', new DirectiveFoldingProvider()),
  );
}
