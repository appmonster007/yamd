import * as path from 'node:path';
import * as vscode from 'vscode';
import { applyBlockEdit } from './editBlock';
import { targetBlock } from './target';
import { linesOf } from './widgets';

const today = () => {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
};

const validDate = (v: string) => (/^\d{4}-\d{2}-\d{2}$/.test(v) && !Number.isNaN(Date.parse(v)) ? undefined : 'Use YYYY-MM-DD.');

/** The headings inside a block, in order: a board's columns or a timeline's lanes. */
function headings(doc: vscode.TextDocument, from: number, to: number): string[] {
  return linesOf(doc)
    .slice(from, to + 1)
    .flatMap((l) => {
      const m = /^#{1,6}[ \t]+(.+?)[ \t]*#*[ \t]*$/.exec(l);
      return m ? [m[1] as string] : [];
    });
}

async function done(ok: boolean, what: string) {
  if (ok) void vscode.window.setStatusBarMessage(`YAMD: Added ${what}.`, 3000);
  else void vscode.window.showWarningMessage('YAMD: Could not add that. The block may be unclosed, read-only, or the note has changed.');
}

/** Add a card, event, timeline item or image to a widget without opening its panel. */
export function registerAddCommands(context: vscode.ExtensionContext): void {
  context.subscriptions.push(
    vscode.commands.registerCommand('yamd.addCard', async (uri?: unknown, line?: unknown) => {
      const t = await targetBlock(['kanban'], 'board', uri, line);
      if (!t) return;
      const columns = headings(t.doc, t.block.bodyStartLine, t.block.bodyEndLine);
      if (!columns.length) {
        void vscode.window.showInformationMessage('YAMD: Give the board a column first, a heading such as "## Todo".');
        return;
      }
      const column = columns.length === 1 ? 0 : (await vscode.window.showQuickPick(columns.map((c, i) => ({ label: c, i })), { placeHolder: 'Add to which column?' }))?.i;
      if (column === undefined) return;
      const text = await vscode.window.showInputBox({ prompt: `New card in "${columns[column]}"`, validateInput: (v) => (v.trim() ? undefined : 'Type the card.') });
      if (!text) return;
      await done(await applyBlockEdit(t.doc, t.block, { kind: 'kanban', op: 'add', board: 0, args: { column, text } }), 'the card');
    }),

    vscode.commands.registerCommand('yamd.addEvent', async (uri?: unknown, line?: unknown) => {
      const t = await targetBlock(['calendar'], 'calendar', uri, line);
      if (!t) return;
      const text = await vscode.window.showInputBox({ prompt: 'New event', validateInput: (v) => (v.trim() ? undefined : 'Type the event.') });
      if (!text) return;
      const date = await vscode.window.showInputBox({ prompt: 'Date', value: today(), validateInput: validDate });
      if (!date) return;
      await done(await applyBlockEdit(t.doc, t.block, { kind: 'calendar', op: 'add', board: 0, args: { date, text } }), 'the event');
    }),

    vscode.commands.registerCommand('yamd.addTimelineItem', async (uri?: unknown, line?: unknown) => {
      const t = await targetBlock(['timeline'], 'timeline', uri, line);
      if (!t) return;
      const lanes = headings(t.doc, t.block.bodyStartLine, t.block.bodyEndLine);
      let group: number | null = null;
      if (lanes.length) {
        const pick = await vscode.window.showQuickPick(lanes.map((l, i) => ({ label: l, i })), { placeHolder: 'Add to which lane?' });
        if (!pick) return;
        group = pick.i;
      }
      const text = await vscode.window.showInputBox({ prompt: 'New item', validateInput: (v) => (v.trim() ? undefined : 'Type the item.') });
      if (!text) return;
      const start = await vscode.window.showInputBox({ prompt: 'Start date', value: today(), validateInput: validDate });
      if (!start) return;
      await done(await applyBlockEdit(t.doc, t.block, { kind: 'timeline', op: 'add', board: 0, args: { group, text, today: start } }), 'the item');
    }),

    vscode.commands.registerCommand('yamd.addImage', async (uri?: unknown, line?: unknown) => {
      const t = await targetBlock(['gallery'], 'gallery', uri, line);
      if (!t) return;
      const picked = await vscode.window.showOpenDialog({ canSelectMany: true, filters: { Images: ['png', 'jpg', 'jpeg', 'gif', 'webp', 'svg', 'avif'] }, defaultUri: vscode.Uri.file(path.dirname(t.doc.uri.fsPath)), openLabel: 'Add to gallery' });
      if (!picked?.length) return;
      for (const file of picked) {
        const rel = path.relative(path.dirname(t.doc.uri.fsPath), file.fsPath).split(path.sep).join('/');
        const caption = picked.length === 1 ? ((await vscode.window.showInputBox({ prompt: 'Caption', value: path.basename(file.fsPath).replace(/\.[^.]+$/, '') })) ?? '') : path.basename(file.fsPath).replace(/\.[^.]+$/, '');
        // The block's position can change as images are added, so find it again each time.
        const again = (await targetBlock(['gallery'], 'gallery', t.doc.uri, t.block.startLine)) ?? t;
        if (!(await applyBlockEdit(again.doc, again.block, { kind: 'gallery', op: 'add', board: 0, args: { image: rel, caption } }))) return done(false, 'the image');
      }
      await done(true, picked.length === 1 ? 'the image' : `${picked.length} images`);
    }),
  );
}
