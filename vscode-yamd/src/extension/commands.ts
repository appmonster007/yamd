import * as vscode from 'vscode';
import { cycleHeadingLevel, onEnter, toggleBlockquote, toggleMarker } from './editing';

const MARKERS: Record<string, string> = {
  'yamd.toggleBold': '**',
  'yamd.toggleItalic': '*',
  'yamd.toggleUnderline': '++',
  'yamd.toggleStrikethrough': '~~',
  'yamd.toggleHighlight': '==',
  'yamd.toggleCode': '`',
};

async function toggle(editor: vscode.TextEditor, marker: string): Promise<void> {
  const doc = editor.document;
  const text = doc.getText();
  // Apply from the last selection backwards so earlier offsets stay valid.
  const ordered = [...editor.selections].sort((a, b) => doc.offsetAt(b.start) - doc.offsetAt(a.start));
  const changes = ordered.map((sel) => toggleMarker(text, doc.offsetAt(sel.start), doc.offsetAt(sel.end), marker));
  await editor.edit((builder) => {
    for (const c of changes) builder.replace(new vscode.Range(doc.positionAt(c.start), doc.positionAt(c.end)), c.text);
  });
  // Map each change's selection into the final text by adding the length deltas of earlier changes.
  const ascending = [...changes].reverse();
  let delta = 0;
  editor.selections = ascending.map((c) => {
    const sel = new vscode.Selection(doc.positionAt(c.selection[0] + delta), doc.positionAt(c.selection[1] + delta));
    delta += c.text.length - (c.end - c.start);
    return sel;
  });
}

async function enter(editor: vscode.TextEditor): Promise<void> {
  const sel = editor.selection;
  const line = editor.document.lineAt(sel.active.line);
  const atEnd = sel.isEmpty && sel.active.character === line.text.length;
  const action = atEnd ? onEnter(line.text) : { kind: 'default' as const };
  if (action.kind === 'continue') {
    await editor.edit((b) => b.insert(sel.active, `\n${action.prefix}`), { undoStopBefore: true, undoStopAfter: false });
    editor.revealRange(editor.selection);
  } else if (action.kind === 'end') {
    await editor.edit((b) => b.delete(line.range));
  } else {
    await vscode.commands.executeCommand('type', { source: 'keyboard', text: '\n' });
  }
}

/** Applies a per-line pure transform to every selected line (or the cursor's line if the selection is empty). */
async function transformLines(editor: vscode.TextEditor, fn: (line: string) => string): Promise<void> {
  const doc = editor.document;
  const lines = new Set<number>();
  for (const sel of editor.selections) for (let l = sel.start.line; l <= sel.end.line; l++) lines.add(l);
  await editor.edit((b) => {
    for (const l of lines) {
      const range = doc.lineAt(l).range;
      b.replace(range, fn(doc.getText(range)));
    }
  });
}

export function registerEditingCommands(context: vscode.ExtensionContext): void {
  for (const [command, marker] of Object.entries(MARKERS)) {
    context.subscriptions.push(vscode.commands.registerTextEditorCommand(command, (editor) => toggle(editor, marker)));
  }
  context.subscriptions.push(
    vscode.commands.registerTextEditorCommand('yamd.onEnter', (editor) => enter(editor)),
    vscode.commands.registerTextEditorCommand('yamd.toggleBlockquote', (editor) => void transformLines(editor, toggleBlockquote)),
    vscode.commands.registerTextEditorCommand('yamd.cycleHeadingLevel', (editor) => void transformLines(editor, cycleHeadingLevel)),
  );
}
