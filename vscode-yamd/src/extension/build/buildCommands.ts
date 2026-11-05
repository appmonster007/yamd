import { readFileSync } from 'node:fs';
import * as path from 'node:path';
import * as vscode from 'vscode';
import { bibSettings, buildNote } from '../../core/build/build';
import { diffLines } from '../../core/build/diff';
import type { LineDiff } from '../../core/build/diff';
import { closeMarker, openMarker } from '../../core/build/markers';
import { collectTargets, refAt } from '../../core/build/refs';
import { parseBibtex } from '../../core/citations/bibtex';
import type { BibEntry } from '../../core/citations/bibtex';
import { linesOf } from '../widgets/widgets';

/** A TextEdit for a line diff: whole lines are replaced, including the end of the note. */
function lineDiffEdit(doc: vscode.TextDocument, d: LineDiff): vscode.TextEdit {
  const last = doc.lineCount;
  const endsInside = d.start + d.removeCount < last;
  const end = endsInside ? new vscode.Position(d.start + d.removeCount, 0) : doc.lineAt(last - 1).range.end;
  let start = new vscode.Position(Math.min(d.start, last - 1), 0);
  let text = d.lines.join('\n') + (endsInside && d.lines.length ? '\n' : '');
  // Appending past the last line needs a newline first; deleting the last lines takes the one before them.
  if (d.start >= last) {
    start = doc.lineAt(last - 1).range.end;
    text = `\n${d.lines.join('\n')}`;
  } else if (!endsInside && !d.lines.length && d.start > 0) {
    start = doc.lineAt(d.start - 1).range.end;
  }
  return vscode.TextEdit.replace(new vscode.Range(start, end), text);
}

function bibFile(doc: vscode.TextDocument, name: string): string | undefined {
  if (doc.uri.scheme !== 'file') return undefined;
  const root = vscode.workspace.getWorkspaceFolder(doc.uri)?.uri.fsPath;
  for (const c of [path.resolve(path.dirname(doc.uri.fsPath), name), ...(root ? [path.resolve(root, name)] : [])]) {
    try {
      readFileSync(c);
      return c;
    } catch {
      /* try the next */
    }
  }
  return undefined;
}

function readEntries(doc: vscode.TextDocument, lines: string[]): { entries?: BibEntry[]; file?: string } {
  const { file: name } = bibSettings(lines);
  if (!name) return {};
  const file = bibFile(doc, name);
  if (!file) return {};
  try {
    return { entries: parseBibtex(readFileSync(file, 'utf8')), file };
  } catch {
    return { file };
  }
}

/** The edit and warnings a Build would produce for a note. */
function planBuild(doc: vscode.TextDocument): { edit?: vscode.TextEdit; warnings: string[] } {
  const lines = linesOf(doc);
  const { entries } = readEntries(doc, lines);
  const result = buildNote(lines, { ...(entries ? { entries } : {}), linkCitations: vscode.workspace.getConfiguration('yamd.build').get<boolean>('linkCitations', true) });
  const diff = diffLines(lines, result.lines);
  return { ...(diff ? { edit: lineDiffEdit(doc, diff) } : {}), warnings: result.warnings };
}

function reveal(editor: vscode.TextEditor, line: number) {
  const pos = new vscode.Position(line, 0);
  editor.selection = new vscode.Selection(pos, pos);
  editor.revealRange(new vscode.Range(pos, pos), vscode.TextEditorRevealType.InCenterIfOutsideViewport);
}

export function registerBuildCommands(context: vscode.ExtensionContext): void {
  context.subscriptions.push(
    vscode.commands.registerCommand('yamd.build', async () => {
      const editor = vscode.window.activeTextEditor;
      if (!editor || editor.document.languageId !== 'markdown') {
        void vscode.window.showInformationMessage('YAMD: Open a Markdown note first.');
        return;
      }
      const { edit, warnings } = planBuild(editor.document);
      if (edit) await editor.edit((b) => b.replace(edit.range, edit.newText));
      const note = edit ? 'Built.' : 'Already up to date.';
      if (warnings.length) void vscode.window.showWarningMessage(`YAMD: ${note} ${warnings.join(' ')}`);
      else void vscode.window.setStatusBarMessage(`YAMD: ${note}`, 3000);
    }),

    // Optional: rebuild when saving. The build is idempotent, so saving twice changes nothing.
    vscode.workspace.onWillSaveTextDocument((e) => {
      if (e.document.languageId !== 'markdown' || !vscode.workspace.getConfiguration('yamd.build').get<boolean>('onSave', false)) return;
      const { edit } = planBuild(e.document);
      if (edit) e.waitUntil(Promise.resolve([edit]));
    }),

    vscode.commands.registerCommand('yamd.insertToc', async () => insertRegion('toc', 'depth=3', ['(Run "YAMD: Build" to fill this in.)'])),
    vscode.commands.registerCommand('yamd.insertBibliography', async () => insertRegion('bibliography', '', ['(Run "YAMD: Build" to fill this in. Add `bibliography: refs.bib` to the front matter.)'])),

    vscode.commands.registerCommand('yamd.goToReference', async () => {
      const editor = vscode.window.activeTextEditor;
      if (!editor || editor.document.languageId !== 'markdown') return;
      const doc = editor.document;
      const lines = linesOf(doc);
      const at = editor.selection.active;
      const ref = refAt(doc.lineAt(at.line).text, at.character);
      if (!ref) {
        void vscode.window.showInformationMessage('YAMD: Put the cursor on a cross-reference, citation or image first.');
        return;
      }
      if (ref.kind === 'xref') {
        const target = collectTargets(lines).find((t) => t.id === ref.id);
        if (target) reveal(editor, target.line);
        else void vscode.window.showWarningMessage(`YAMD: No target "^${ref.id}" in this note.`);
      } else if (ref.kind === 'image') {
        const resolved = doc.uri.scheme === 'file' && !/^[a-z]+:/i.test(ref.src) ? vscode.Uri.file(path.resolve(path.dirname(doc.uri.fsPath), decodeURIComponent(ref.src))) : vscode.Uri.parse(ref.src);
        await vscode.commands.executeCommand(/^https?:/i.test(ref.src) ? 'vscode.open' : 'vscode.open', resolved, { viewColumn: vscode.ViewColumn.Beside });
      } else {
        const key = ref.keys[0] as string;
        const anchor = lines.findIndex((l) => l.includes(`<a id="ref-${key}"></a>`));
        if (anchor >= 0) return reveal(editor, anchor);
        const { file } = readEntries(doc, lines);
        if (file) {
          const bib = await vscode.workspace.openTextDocument(file);
          const row = linesOf(bib).findIndex((l) => new RegExp(`^\\s*@\\w+\\s*\\{\\s*${key.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}\\s*,`).test(l));
          const shown = await vscode.window.showTextDocument(bib, { viewColumn: vscode.ViewColumn.Beside });
          if (row >= 0) reveal(shown, row);
        } else void vscode.window.showWarningMessage(`YAMD: "${key}" isn't in a bibliography. Run "YAMD: Build" after adding a bibliography file.`);
      }
    }),
  );
}

async function insertRegion(name: string, attrs: string, body: string[]): Promise<void> {
  const editor = vscode.window.activeTextEditor;
  if (!editor || editor.document.languageId !== 'markdown') return;
  const text = [openMarker(name, attrs), ...body, closeMarker(name)].join('\n');
  await editor.edit((b) => b.insert(editor.selection.active, `${text}\n`));
}
