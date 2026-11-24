import { readFileSync } from 'node:fs';
import * as path from 'node:path';
import * as vscode from 'vscode';
import { scanCallouts } from '../../core/build/callouts';
import { collectTargets } from '../../core/build/refs';
import { bibSettings } from '../../core/build/build';
import { diffLines } from '../../core/build/diff';
import { CALLOUT_CHOICES, calloutBlock, equationBlock, figureBlock, selectionToWidget, tableBlock } from '../../core/editing/insert';
import type { SelectionWidget } from '../../core/editing/insert';
import { setFrontMatterKey } from '../../core/editing/frontMatter';
import { placeBlock } from '../../core/editing/placeBlock';
import { parseBibtex } from '../../core/citations/bibtex';
import type { BibEntry } from '../../core/citations/bibtex';
import { lineDiffEdit } from '../build/buildCommands';
import { linesOf } from '../widgets/widgets';

function markdownEditor(): vscode.TextEditor | undefined {
  const editor = vscode.window.activeTextEditor;
  if (!editor || editor.document.languageId !== 'markdown') {
    void vscode.window.showInformationMessage('YAMD: Open a Markdown note first.');
    return undefined;
  }
  return editor;
}

/** Puts `block` on lines of its own at the cursor and leaves the cursor at the end of `focus` text inside it. */
async function insertBlock(editor: vscode.TextEditor, block: string, focusAfter?: string): Promise<void> {
  const doc = editor.document;
  const text = doc.getText();
  const at = placeBlock(text, doc.offsetAt(editor.selection.active), block);
  const ok = await editor.edit((b) => b.replace(new vscode.Range(doc.positionAt(at.offset), doc.positionAt(at.offset + at.remove)), at.insert));
  if (!ok) return;
  const start = at.offset + at.insert.indexOf(block);
  const end = start + (focusAfter !== undefined ? block.indexOf(focusAfter) + focusAfter.length : block.length);
  const pos = editor.document.positionAt(end);
  editor.selection = new vscode.Selection(pos, pos);
  editor.revealRange(new vscode.Range(pos, pos));
}

const takenIds = (lines: string[]) => [...collectTargets(lines).map((t) => t.id), ...scanCallouts(lines).flatMap((c) => (c.id ? [c.id] : []))];

/** Entries of the `.bib` file a note names, and where it is; asks for (and records) one when the note has none. */
export async function bibEntries(doc: vscode.TextDocument, askToAdd: boolean): Promise<{ entries: BibEntry[]; file?: string } | undefined> {
  const lines = linesOf(doc);
  const { file: named } = bibSettings(lines);
  const root = vscode.workspace.getWorkspaceFolder(doc.uri)?.uri.fsPath;
  const resolve = (name: string) => [path.resolve(path.dirname(doc.uri.fsPath), name), ...(root ? [path.resolve(root, name)] : [])].find((c) => {
    try {
      readFileSync(c);
      return true;
    } catch {
      return false;
    }
  });
  let file = named ? resolve(named) : undefined;
  if (!file && askToAdd) {
    const found = await vscode.workspace.findFiles('**/*.bib', '**/node_modules/**', 20);
    const items = found.map((u) => ({ label: vscode.workspace.asRelativePath(u), uri: u }));
    const pick = await vscode.window.showQuickPick(items.length ? items : [{ label: 'No .bib file found in the workspace', uri: undefined as unknown as vscode.Uri }], { placeHolder: 'Which bibliography file does this note use?' });
    if (!pick?.uri) return undefined;
    file = pick.uri.fsPath;
    // Record it in the note's front matter, relative to the note.
    const rel = path.relative(path.dirname(doc.uri.fsPath), file).split(path.sep).join('/');
    const next = setFrontMatterKey(lines, 'bibliography', rel);
    const diff = diffLines(lines, next);
    if (diff) {
      const edit = new vscode.WorkspaceEdit();
      edit.set(doc.uri, [lineDiffEdit(doc, diff)]);
      await vscode.workspace.applyEdit(edit);
    }
  }
  if (!file) return undefined;
  try {
    return { entries: parseBibtex(readFileSync(file, 'utf8')), file };
  } catch {
    return { entries: [], file };
  }
}

/** Insert commands that write the markup for you, and turn a selection into a widget. */
export function registerWritingCommands(context: vscode.ExtensionContext): void {
  context.subscriptions.push(
    vscode.commands.registerCommand('yamd.insertCallout', async () => {
      const editor = markdownEditor();
      if (!editor) return;
      const pick = await vscode.window.showQuickPick(CALLOUT_CHOICES.map((c) => ({ label: c.label, description: c.description, type: c.type })), { placeHolder: 'Which callout?' });
      if (!pick) return;
      const title = await vscode.window.showInputBox({ prompt: pick.type === 'card' ? 'The question' : 'Title (optional)', placeHolder: pick.type === 'card' ? 'What is…?' : 'A short title' });
      if (title === undefined) return;
      const block = calloutBlock(pick.type, title, takenIds(linesOf(editor.document)));
      await insertBlock(editor, block, block.slice(0, block.lastIndexOf('\n> ') + 3));
    }),

    vscode.commands.registerCommand('yamd.insertTarget', async () => {
      const editor = markdownEditor();
      if (!editor) return;
      const kind = await vscode.window.showQuickPick(['Figure (an image)', 'Table', 'Equation'], { placeHolder: 'What are you adding?' });
      if (!kind) return;
      const taken = takenIds(linesOf(editor.document));
      let block: string;
      if (kind.startsWith('Figure')) {
        const picked = await vscode.window.showOpenDialog({ canSelectMany: false, filters: { Images: ['png', 'jpg', 'jpeg', 'gif', 'webp', 'svg', 'avif'] }, defaultUri: vscode.Uri.file(path.dirname(editor.document.uri.fsPath)), openLabel: 'Use image' });
        const rel = picked?.[0] ? path.relative(path.dirname(editor.document.uri.fsPath), picked[0].fsPath).split(path.sep).join('/') : 'path/to/image.png';
        const caption = await vscode.window.showInputBox({ prompt: 'Caption (also its alt text)', value: picked?.[0] ? path.basename(picked[0].fsPath).replace(/\.[^.]+$/, '') : '' });
        if (caption === undefined) return;
        block = figureBlock(caption || 'Figure', rel, taken);
      } else if (kind === 'Table') {
        const caption = await vscode.window.showInputBox({ prompt: 'Table caption' });
        if (caption === undefined) return;
        block = tableBlock(caption || 'Table', taken);
      } else {
        const label = await vscode.window.showInputBox({ prompt: 'A short name for the equation', placeHolder: 'energy' });
        if (label === undefined) return;
        block = equationBlock(label || 'equation', taken);
      }
      await insertBlock(editor, block);
      void vscode.window.setStatusBarMessage(`YAMD: Refer to it with [@${/\^(\S+)$/.exec(block)?.[1] ?? ''}], then run Build.`, 5000);
    }),

    vscode.commands.registerCommand('yamd.insertCitation', async () => {
      const editor = markdownEditor();
      if (!editor) return;
      const bib = await bibEntries(editor.document, true);
      if (!bib) return;
      if (!bib.entries.length) {
        void vscode.window.showInformationMessage('YAMD: That bibliography file has no entries yet.');
        return;
      }
      const pick = await vscode.window.showQuickPick(
        bib.entries.map((e) => ({ label: e.key, description: [e.fields['author'], e.fields['year']].filter(Boolean).join(' · '), detail: e.fields['title'], key: e.key })),
        { placeHolder: 'Cite which source?', matchOnDescription: true, matchOnDetail: true },
      );
      if (!pick) return;
      await editor.edit((b) => b.insert(editor.selection.active, `[@${pick.key}]`));
    }),

    vscode.commands.registerCommand('yamd.selectionToWidget', async () => {
      const editor = markdownEditor();
      if (!editor) return;
      const doc = editor.document;
      let range = editor.selection;
      if (range.isEmpty) {
        // With nothing selected, take the list the cursor is in.
        const lines = linesOf(doc);
        const isItem = (l: string | undefined) => !!l && /^\s*([-*+]|\d+[.)])\s/.test(l);
        let a = range.active.line;
        let b = a;
        if (!isItem(lines[a])) {
          void vscode.window.showInformationMessage('YAMD: Select some lines, or put the cursor in a list.');
          return;
        }
        while (a > 0 && (isItem(lines[a - 1]) || /^\s{2,}\S/.test(lines[a - 1] ?? ''))) a--;
        while (b + 1 < lines.length && (isItem(lines[b + 1]) || /^\s{2,}\S/.test(lines[b + 1] ?? ''))) b++;
        range = new vscode.Selection(a, 0, b, lines[b]?.length ?? 0);
      }
      const pick = await vscode.window.showQuickPick(
        [
          { label: 'Board', type: 'kanban' as SelectionWidget, description: 'columns and cards' },
          { label: 'Calendar', type: 'calendar' as SelectionWidget, description: 'events placed by {due=…}' },
          { label: 'Timeline', type: 'timeline' as SelectionWidget, description: 'bars from {start=…} to {due=…}' },
          { label: 'Gallery', type: 'gallery' as SelectionWidget, description: 'a grid of images' },
        ],
        { placeHolder: 'Turn the selection into…' },
      );
      if (!pick) return;
      const full = new vscode.Range(new vscode.Position(range.start.line, 0), doc.lineAt(range.end.line).range.end);
      const block = selectionToWidget(doc.getText(full), pick.type, doc.getText());
      await editor.edit((b) => b.replace(full, block));
    }),
  );
}
