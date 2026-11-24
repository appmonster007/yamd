import { existsSync, readFileSync } from 'node:fs';
import * as path from 'node:path';
import * as vscode from 'vscode';
import { parse } from '../../core/markdown';
import { buildNote } from '../../core/build/build';
import { checkNote, summarize } from '../../core/build/check';
import type { NoteProblem } from '../../core/build/check';
import { diffLines } from '../../core/build/diff';
import { writeRegion } from '../../core/build/markers';
import { bibSettings } from '../../core/build/build';
import { queryBlock } from '../../core/editing/queryBuilder';
import { placeBlock } from '../../core/editing/placeBlock';
import { inlineImages } from '../../core/export/inline';
import { documentHtml } from '../../core/export/page';
import { finalizeHtml, renderWidgets } from '../../core/export/prepare';
import { renderQueryResult, errorBox } from '../../core/query/views';
import { cardsFromCallouts } from '../../core/study/fromCallouts';
import { suggestId, usedIds } from '../../core/widgets/widgetLint';
import { formatDate } from '../../core/templates/placeholders';
import { highlight, renderMath } from '../shared/richLoader';
import { lineDiffEdit } from '../build/buildCommands';
import { describeSource, runBlockQuery } from '../query/queryWidget';
import { refreshSnapshots } from '../query/refresh';
import { folderImages, linesOf, widgetsOf } from '../widgets/widgets';
import { bibEntries } from './commands';

function markdownEditor(): vscode.TextEditor | undefined {
  const editor = vscode.window.activeTextEditor;
  if (!editor || editor.document.languageId !== 'markdown') {
    void vscode.window.showInformationMessage('YAMD: Open a Markdown note first.');
    return undefined;
  }
  return editor;
}

const DATA = /\.(csv|json|db|sqlite3?)$/i;

/** Problems in a note, including the checks that need files and the bibliography. */
export async function problemsOf(doc: vscode.TextDocument): Promise<NoteProblem[]> {
  const dir = path.dirname(doc.uri.fsPath);
  const bib = bibSettings(linesOf(doc)).file ? await bibEntries(doc, false) : undefined;
  return checkNote(linesOf(doc), { exists: (rel) => existsSync(path.resolve(dir, rel)), ...(bib ? { bibKeys: new Set(bib.entries.map((e) => e.key)) } : {}) });
}

async function checkCommand(): Promise<void> {
  const editor = markdownEditor();
  if (!editor) return;
  const doc = editor.document;
  const problems = await problemsOf(doc);
  if (!problems.length) {
    void vscode.window.showInformationMessage('YAMD: No problems found in this note.');
    return;
  }
  const fixable = problems.filter((p) => p.fix);
  const items = problems.map((p) => ({ label: `${p.severity === 'error' ? '$(error)' : p.severity === 'warning' ? '$(warning)' : '$(info)'} ${p.code}  line ${p.line + 1}`, description: p.message, p }));
  const picks: vscode.QuickPickItem[] = fixable.length ? [{ label: `$(wrench) Fix ${fixable.length} safe problem${fixable.length === 1 ? '' : 's'}`, description: 'Applies the one-line fixes' }, ...items] : items;
  const pick = await vscode.window.showQuickPick(picks, { placeHolder: summarize(problems), matchOnDescription: true });
  if (!pick) return;
  if (!('p' in pick)) {
    const lines = linesOf(doc);
    const next = lines.map((l, i) => problems.find((p) => p.line === i && p.fix)?.fix?.text ?? l).join('\n').split('\n');
    const diff = diffLines(lines, next);
    if (diff) await editor.edit((b) => b.replace(lineDiffEdit(doc, diff).range, lineDiffEdit(doc, diff).newText));
    return;
  }
  const at = new vscode.Position((pick as { p: NoteProblem }).p.line, 0);
  editor.selection = new vscode.Selection(at, at);
  editor.revealRange(new vscode.Range(at, at), vscode.TextEditorRevealType.InCenter);
}

async function insertQueryCommand(): Promise<void> {
  const editor = markdownEditor();
  if (!editor) return;
  const doc = editor.document;
  const files = await vscode.workspace.findFiles('**/*.{csv,json,db,sqlite,sqlite3}', '**/{node_modules,.git,.vscode-test}/**', 100);
  const dir = path.dirname(doc.uri.fsPath);
  const items = files.map((u) => ({ label: path.relative(dir, u.fsPath).split(path.sep).join('/'), uri: u })).filter((i) => DATA.test(i.label)).sort((a, b) => a.label.localeCompare(b.label));
  if (!items.length) {
    void vscode.window.showInformationMessage('YAMD: No CSV, JSON or SQLite files found in the workspace.');
    return;
  }
  const file = await vscode.window.showQuickPick(items, { placeHolder: 'Which data file?' });
  if (!file) return;
  const tables = await describeSource(doc, { attrs: { source: file.label } } as never);
  if (!tables?.length) {
    void vscode.window.showWarningMessage(`YAMD: Could not read "${file.label}".`);
    return;
  }
  const table = tables.length === 1 ? tables[0] : (await vscode.window.showQuickPick(tables.map((t) => ({ label: t.table, description: t.columns.map((c) => c.name).join(', '), t })), { placeHolder: 'Which table?' }))?.t;
  if (!table) return;
  const cols = await vscode.window.showQuickPick(table.columns.map((c) => ({ label: c.name, description: c.type, picked: true })), { canPickMany: true, placeHolder: 'Which columns? (none selected means all)' });
  if (!cols) return;
  const where = await vscode.window.showInputBox({ prompt: 'Filter (optional), for example status = \'open\'', placeHolder: 'status = \'open\'' });
  if (where === undefined) return;
  const view = await vscode.window.showQuickPick([{ label: 'table', description: 'Rows and columns' }, { label: 'board', description: 'Cards grouped by a column' }, { label: 'chart', description: 'A bar chart' }], { placeHolder: 'How to show it?' });
  if (!view) return;
  const names = table.columns.map((c) => c.name);
  let group: string | undefined;
  let x: string | undefined;
  let y: string | undefined;
  if (view.label === 'board') group = (await vscode.window.showQuickPick(names, { placeHolder: 'Group cards by which column?' })) ?? undefined;
  if (view.label === 'chart') {
    x = await vscode.window.showQuickPick(names, { placeHolder: 'Horizontal axis (x) column' });
    y = x ? await vscode.window.showQuickPick(names, { placeHolder: 'Value (y) column' }) : undefined;
  }
  if ((view.label === 'board' && !group) || (view.label === 'chart' && !(x && y))) return;
  const block = queryBlock({
    id: suggestId('sql', usedIds(linesOf(doc))), source: file.label, table: table.table,
    columns: cols.length === names.length ? [] : cols.map((c) => c.label), where, view: view.label as 'table' | 'board' | 'chart',
    ...(group ? { group } : {}), ...(x ? { x } : {}), ...(y ? { y } : {}),
  });
  const at = placeBlock(doc.getText(), doc.offsetAt(editor.selection.active), block);
  await editor.edit((b) => b.replace(new vscode.Range(doc.positionAt(at.offset), doc.positionAt(at.offset + at.remove)), at.insert));
  void vscode.commands.executeCommand('yamd.runQuery', doc.uri, doc.positionAt(at.offset + at.insert.indexOf(block)).line);
}

async function studyThisNote(): Promise<void> {
  const editor = markdownEditor();
  if (!editor) return;
  const doc = editor.document;
  const lines = linesOf(doc);
  const cards = cardsFromCallouts(lines);
  if (!cards.length) {
    void vscode.window.showInformationMessage('YAMD: No definitions, theorems, lemmas or questions with a body to turn into cards.');
    return;
  }
  const next = writeRegion(lines, 'cards', cards, { insertAfter: lines.length - 1 });
  const diff = diffLines(lines, next);
  if (diff) await editor.edit((b) => b.replace(lineDiffEdit(doc, diff).range, lineDiffEdit(doc, diff).newText));
  await doc.save();
  void vscode.commands.executeCommand('yamd.reviewCards');
}

function pageCss(context: vscode.ExtensionContext): string {
  try {
    return readFileSync(path.join(context.extensionPath, 'media', 'preview.css'), 'utf8');
  } catch {
    return '';
  }
}

async function exportMarkdown(): Promise<void> {
  const editor = markdownEditor();
  if (!editor) return;
  const doc = editor.document;
  const dir = path.dirname(doc.uri.fsPath);
  const snap = await refreshSnapshots(doc, false);
  let entries;
  const { file } = bibSettings(snap.lines);
  if (file) entries = (await bibEntries(doc, false))?.entries;
  const built = buildNote(snap.lines, { ...(entries ? { entries } : {}) }).lines;
  const inlined = inlineImages(built, (rel) => {
    try {
      return new Uint8Array(readFileSync(path.resolve(dir, rel)));
    } catch {
      return undefined;
    }
  }, (bytes) => Buffer.from(bytes).toString('base64'));
  const out = vscode.Uri.file(`${doc.uri.fsPath.replace(/\.[^.]+$/, '')}.export.md`);
  await vscode.workspace.fs.writeFile(out, new TextEncoder().encode(inlined.lines.join('\n')));
  const notes = [...(inlined.missing.length ? [`${inlined.missing.length} image${inlined.missing.length === 1 ? '' : 's'} not found`] : []), ...(snap.failed.length ? [`${snap.failed.length} quer${snap.failed.length === 1 ? 'y' : 'ies'} failed`] : [])];
  void vscode.window.showInformationMessage(`YAMD: Saved ${path.basename(out.fsPath)}${notes.length ? ` (${notes.join(', ')})` : ''}.`);
}

async function exportWidget(context: vscode.ExtensionContext, uri?: vscode.Uri, startLine?: number): Promise<void> {
  const doc = uri ? await vscode.workspace.openTextDocument(uri) : markdownEditor()?.document;
  if (!doc) return;
  const widgets = widgetsOf(doc).filter((w) => w.closed);
  const at = startLine ?? vscode.window.activeTextEditor?.selection.active.line ?? 0;
  let block = widgets.find((w) => w.startLine === startLine) ?? widgets.find((w) => w.startLine <= at && at <= w.endLine);
  if (!block) block = (await vscode.window.showQuickPick(widgets.map((w) => ({ label: w.label, description: `line ${w.startLine + 1}`, w })), { placeHolder: 'Export which widget?' }))?.w;
  if (!block) return;
  const lines = linesOf(doc);
  let html: string;
  if (block.type === 'sql') {
    const outcome = await runBlockQuery(doc, block);
    html = outcome.ok ? renderQueryResult(outcome.result, { view: block.attrs['view'] ?? 'table', group: block.attrs['group'], type: block.attrs['type'], x: block.attrs['x'], y: block.attrs['y'] }) : errorBox(outcome.problem.code, outcome.problem.message);
  } else {
    const body = block.type === 'gallery' && block.attrs['source'] && lines.slice(block.bodyStartLine, block.bodyEndLine + 1).every((l) => l.trim() === '') ? folderImages(doc, block.attrs['source']) : lines.slice(block.bodyStartLine, block.bodyEndLine + 1);
    html = renderWidgets([{ line: 0, type: block.type, attrs: block.attrs, body }], { highlight, renderMath }).get(0) ?? '';
  }
  const page = finalizeHtml(documentHtml(parse('YAMDQUERY0', 'gfm'), { css: pageCss(context), render: { highlight, renderMath }, readOnly: true, footer: `${block.label} from ${path.basename(doc.uri.fsPath)} on ${formatDate(new Date(), 'YYYY-MM-DD')}`, titlePage: false, toc: false }), new Map([[0, html]]));
  const out = vscode.Uri.file(path.join(path.dirname(doc.uri.fsPath), `${path.basename(doc.uri.fsPath).replace(/\.[^.]+$/, '')}-${block.id ?? block.type}.html`));
  await vscode.workspace.fs.writeFile(out, new TextEncoder().encode(page));
  void vscode.window.showInformationMessage(`YAMD: Saved ${path.basename(out.fsPath)}`);
}

export function registerTools(context: vscode.ExtensionContext): void {
  context.subscriptions.push(
    vscode.commands.registerCommand('yamd.checkNote', checkCommand),
    vscode.commands.registerCommand('yamd.insertQuery', insertQueryCommand),
    vscode.commands.registerCommand('yamd.studyThisNote', studyThisNote),
    vscode.commands.registerCommand('yamd.exportMarkdown', exportMarkdown),
    vscode.commands.registerCommand('yamd.exportWidget', (uri?: vscode.Uri, line?: number) => exportWidget(context, uri, line)),
  );
}
