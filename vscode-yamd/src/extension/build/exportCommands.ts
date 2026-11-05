import { readFileSync } from 'node:fs';
import * as path from 'node:path';
import * as vscode from 'vscode';
import { parse } from '../../core/markdown';
import { buildNote } from '../../core/build/build';
import { finalizeHtml, prepareExport, renderWidgets } from '../../core/export/prepare';
import { scanWidgets } from '../../core/widgets/fences';
import { renderQueryResult } from '../../core/query/views';
import { errorBox } from '../../core/query/views';
import { documentHtml, slidesHtml } from '../../core/export/page';
import { formatDate } from '../../core/templates/placeholders';
import { bibSettings } from '../../core/build/build';
import { parseBibtex } from '../../core/citations/bibtex';
import { highlight, renderMath } from '../shared/richLoader';
import { runBlockQuery } from '../query/queryWidget';
import { folderImages, linesOf } from '../widgets/widgets';

type Kind = 'html' | 'pdf' | 'slides';

/** Exports the active note as a standalone page: HTML, a page to print as PDF, or a slide deck. */
async function exportNote(context: vscode.ExtensionContext, kind: Kind): Promise<void> {
  const editor = vscode.window.activeTextEditor;
  if (!editor || editor.document.languageId !== 'markdown') {
    void vscode.window.showInformationMessage('YAMD: Open a Markdown note first.');
    return;
  }
  const doc = editor.document;
  const lines = linesOf(doc);

  let entries;
  const { file } = bibSettings(lines);
  if (file && doc.uri.scheme === 'file') {
    try {
      entries = parseBibtex(readFileSync(path.resolve(path.dirname(doc.uri.fsPath), file), 'utf8'));
    } catch {
      /* the build warns about a missing bibliography */
    }
  }
  const built = buildNote(lines, { ...(entries ? { entries } : {}), linkCitations: vscode.workspace.getConfiguration('yamd.build').get<boolean>('linkCitations', true) }).lines;
  const prepared = prepareExport(built);

  // Query blocks are run now and shown as static tables, boards or charts.
  // A gallery that names a folder lists that folder's images.
  for (const w of prepared.widgets) {
    if (w.type === 'gallery' && w.attrs['source'] && w.body.every((l) => l.trim() === '')) w.body = folderImages(doc, w.attrs['source']);
  }
  const blocks = renderWidgets(prepared.widgets, { highlight, renderMath });
  for (const w of scanWidgets(built)) {
    if (w.type !== 'sql' || !w.closed) continue;
    const outcome = await runBlockQuery(doc, { ...w, bodyStartLine: w.bodyStartLine, bodyEndLine: w.bodyEndLine });
    blocks.set(
      w.startLine,
      outcome.ok
        ? renderQueryResult(outcome.result, { view: w.attrs['view'] ?? 'table', group: w.attrs['group'], type: w.attrs['type'], x: w.attrs['x'], y: w.attrs['y'] })
        : errorBox(outcome.problem.code, outcome.problem.message),
    );
  }

  let css = '';
  try {
    css = readFileSync(path.join(context.extensionPath, 'media', 'preview.css'), 'utf8');
  } catch {
    /* the page still has its own base styles */
  }
  // The prose is read as plain Markdown (a newline is a space, as in the editor's preview); widgets were rendered above.
  const parsed = parse(prepared.source, 'gfm');
  const options = { css, render: { highlight, renderMath, softBreaks: 'newline' as const }, readOnly: false, footer: `Exported from ${path.basename(doc.uri.fsPath)} on ${formatDate(new Date(), 'YYYY-MM-DD')}`, titlePage: false, toc: false };
  const page = finalizeHtml(kind === 'slides' ? slidesHtml(parsed, options) : documentHtml(parsed, options), blocks);

  const base = doc.uri.fsPath.replace(/\.[^.]+$/, '');
  const out = vscode.Uri.file(`${base}${kind === 'slides' ? '-slides' : ''}.html`);
  await vscode.workspace.fs.writeFile(out, new TextEncoder().encode(page));
  if (kind === 'pdf') {
    await vscode.env.openExternal(out);
    void vscode.window.showInformationMessage('YAMD: Opened in your browser. Use Print → Save as PDF.');
  } else {
    void vscode.window.showInformationMessage(`YAMD: Saved ${path.basename(out.fsPath)}`);
  }
}

export function registerExportCommands(context: vscode.ExtensionContext): void {
  context.subscriptions.push(
    vscode.commands.registerCommand('yamd.exportHtml', () => exportNote(context, 'html')),
    vscode.commands.registerCommand('yamd.exportPdf', () => exportNote(context, 'pdf')),
    vscode.commands.registerCommand('yamd.exportSlides', () => exportNote(context, 'slides')),
  );
}
