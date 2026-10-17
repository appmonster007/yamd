/**
 * Study commands (§6): registers all study-related commands with VS Code.
 * Imported once from extension.ts.
 */
import * as path from 'node:path';
import * as vscode from 'vscode';
import { parse } from '../core';
import { collectStudyBlocks, buildCheatSheet } from '../core/study/blocks';
import { extractCards } from '../core/study/cards';
import { collectDeadlines } from '../core/study/deadlines';
import { documentHtml, slidesHtml } from '../core/study/export';
import { buildDocx } from '../core/study/docx';
import { htmlToYamd, obsidianToYamd, notionToYamd } from '../core/study/importers';
import { collectReview, resolveReview } from '../core/study/review';
import { STUDY_TEMPLATES, READING_LIST_YDB, MATH_SYMBOLS } from '../core/study/templates';
import type { WorkspaceIndex } from '../workspace/index';
import { noteUri } from '../workspace/index';
import { highlight, renderMath } from '../extension/richLoader';
import { DashboardPanel } from './dashboard';
import { ReviewPanel } from './review';
import { StudyTimer } from './timer';
import { workspaceRoot, requireFolder, todayIso, readData, writeData, openAt, collectCards } from './workspace';
import { bibliographyFor } from './bibliography';

// ---- Helpers ----------------------------------------------------------------

function activeYamd(): vscode.TextDocument | undefined {
  const doc = vscode.window.activeTextEditor?.document;
  return doc?.languageId === 'yamd' ? doc : undefined;
}

function formatDate(d: Date): string {
  const p = (n: number) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`;
}

/** Substitute `{{@date}}`, `{{@title}}`, `{{@course}}` and `{{@cursor}}` placeholders. */
function applyTemplate(text: string, title: string, course: string): { text: string; cursorOffset: number } {
  const date = formatDate(new Date());
  let out = text
    .replace(/\{\{@date(?::[^}]*)?\}\}/g, date)
    .replace(/\{\{@title\}\}/g, title)
    .replace(/\{\{@course\}\}/g, course);
  const cursorOffset = out.indexOf('{{@cursor}}');
  out = out.replace('{{@cursor}}', '');
  return { text: out, cursorOffset };
}

// ---- Study note (template picker) -------------------------------------------

async function newStudyNote(clicked?: vscode.Uri): Promise<void> {
  const pick = await vscode.window.showQuickPick(
    STUDY_TEMPLATES.map((t) => ({ label: t.label, description: t.description, id: t.id })),
    { placeHolder: 'Choose a study note template' },
  );
  if (!pick) return;
  const template = STUDY_TEMPLATES.find((t) => t.id === pick.id)!;

  const title = await vscode.window.showInputBox({ prompt: 'Note title', placeHolder: 'Lecture 1' });
  if (title === undefined) return;
  const course = await vscode.window.showInputBox({ prompt: 'Course (optional)', placeHolder: 'CS101' }) ?? '';

  // Pick the target folder
  let folder: vscode.Uri | undefined;
  if (clicked?.scheme === 'file') {
    try {
      const stat = await vscode.workspace.fs.stat(clicked);
      folder = stat.type & vscode.FileType.Directory ? clicked : vscode.Uri.joinPath(clicked, '..');
    } catch { /* fall through */ }
  }
  if (!folder) {
    const active = vscode.window.activeTextEditor?.document.uri;
    if (active?.scheme === 'file') folder = vscode.Uri.joinPath(active, '..');
  }
  if (!folder) folder = vscode.workspace.workspaceFolders?.[0]?.uri;
  if (!folder) { void vscode.window.showInformationMessage('YAMD: Open a folder first.'); return; }

  const slug = (title || template.label).toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '') || 'note';
  const uri = vscode.Uri.joinPath(folder, `${slug}.yamd`);
  const { text, cursorOffset } = applyTemplate(template.text, title || template.label, course);
  await vscode.workspace.fs.writeFile(uri, new TextEncoder().encode(text));
  const doc = await vscode.workspace.openTextDocument(uri);
  const editor = await vscode.window.showTextDocument(doc);
  if (cursorOffset >= 0) {
    const pos = doc.positionAt(cursorOffset);
    editor.selection = new vscode.Selection(pos, pos);
    editor.revealRange(new vscode.Range(pos, pos));
  }
}

// ---- Cheat sheet ------------------------------------------------------------

async function generateCheatSheet(index: WorkspaceIndex): Promise<void> {
  if (!requireFolder()) return;
  await index.whenReady();
  const courses = new Set<string>();
  for (const s of index.store.summaries()) {
    const c = s.properties['course'];
    if (typeof c === 'string' && c.trim()) courses.add(c.trim());
  }

  const courseList = [...courses].sort();
  const course = courseList.length
    ? (await vscode.window.showQuickPick(['(all courses)', ...courseList], { placeHolder: 'Generate cheat sheet for…' }))
    : undefined;
  if (course === undefined && courseList.length) return;

  const allBlocks: ReturnType<typeof collectStudyBlocks> = [];
  for (const notePath of index.store.paths()) {
    const text = index.store.read(notePath);
    if (!text) continue;
    allBlocks.push(...collectStudyBlocks(parse(text), notePath));
  }

  const root = requireFolder()!;
  const linkFn = (p: string) => path.relative(root.fsPath, p);
  const content = buildCheatSheet(allBlocks, {
    course: course && course !== '(all courses)' ? course : undefined,
    date: todayIso(),
    link: linkFn,
  });

  const slug = course && course !== '(all courses)' ? course.toLowerCase().replace(/[^a-z0-9]+/g, '-') : 'cheat-sheet';
  const uri = vscode.Uri.joinPath(root, `${slug}-cheat-sheet.yamd`);
  await vscode.workspace.fs.writeFile(uri, new TextEncoder().encode(content));
  const doc = await vscode.workspace.openTextDocument(uri);
  await vscode.window.showTextDocument(doc);
}

// ---- Export -----------------------------------------------------------------

type ExportFmt = 'html' | 'pdf' | 'docx' | 'slides';

async function exportNote(fmt: ExportFmt): Promise<void> {
  const doc = activeYamd();
  if (!doc) { void vscode.window.showInformationMessage('YAMD: Open a .yamd file first.'); return; }

  const root = vscode.workspace.getWorkspaceFolder(doc.uri)?.uri.fsPath;
  const parsed = parse(doc.getText());
  const bib = bibliographyFor(parsed, doc.uri.fsPath, root);
  const opts = {
    css: '',
    render: { highlight, renderMath, bibliography: bib },
    readOnly: true,
    footer: `Exported from ${path.basename(doc.uri.fsPath)} on ${formatDate(new Date())}`,
  };

  const base = doc.uri.fsPath.replace(/\.yamd$/, '');

  if (fmt === 'docx') {
    const bytes = buildDocx(parsed, { title: parsed.frontMatter?.data['title'] as string | undefined });
    const outUri = vscode.Uri.file(`${base}.docx`);
    await vscode.workspace.fs.writeFile(outUri, bytes);
    void vscode.window.showInformationMessage(`YAMD: Saved ${path.basename(outUri.fsPath)}`);
    return;
  }

  const html = fmt === 'slides' ? slidesHtml(parsed, opts) : documentHtml(parsed, opts);
  const ext = fmt === 'slides' ? '-slides.html' : '.html';
  const outUri = vscode.Uri.file(`${base}${ext}`);
  await vscode.workspace.fs.writeFile(outUri, new TextEncoder().encode(html));

  if (fmt === 'pdf') {
    void vscode.env.openExternal(outUri);
    void vscode.window.showInformationMessage('YAMD: HTML opened in browser. Use "Print → Save as PDF" to export.');
  } else {
    void vscode.window.showInformationMessage(`YAMD: Saved ${path.basename(outUri.fsPath)}`);
  }
}

// ---- Citation (add from DOI / ISBN / URL) ------------------------------------

async function addCitation(): Promise<void> {
  const doc = activeYamd();
  if (!doc) { void vscode.window.showInformationMessage('YAMD: Open a .yamd file first.'); return; }

  const input = await vscode.window.showInputBox({
    prompt: 'DOI, ISBN, arXiv ID or URL',
    placeHolder: '10.1145/3453483.3454023',
  });
  if (!input?.trim()) return;

  const query = input.trim();
  let bibText: string | undefined;

  try {
    // DOI
    if (/^10\.\d{4,}\//.test(query) || query.startsWith('doi:')) {
      const doi = query.replace(/^doi:/i, '');
      const resp = await fetch(`https://doi.org/${doi}`, { headers: { Accept: 'application/x-bibtex' } });
      if (resp.ok) bibText = await resp.text();
    }
    // arXiv
    else if (/^(arxiv:)?\d{4}\.\d{4,}/.test(query.toLowerCase())) {
      const id = query.replace(/^arxiv:/i, '');
      const resp = await fetch(`https://export.arxiv.org/abs/${id}e=bibtex`);
      if (resp.ok) bibText = await resp.text();
    }
    // ISBN (OpenLibrary)
    else if (/^[\d-]{10,17}$/.test(query.replace(/[- ]/g, ''))) {
      const isbn = query.replace(/[- ]/g, '');
      const resp = await fetch(`https://openlibrary.org/isbn/${isbn}.json`);
      if (resp.ok) {
        const data = (await resp.json()) as Record<string, unknown>;
        const title = (data['title'] as string | undefined) ?? 'Unknown';
        const year = String(data['publish_date'] ?? '').match(/\d{4}/)?.[0] ?? '';
        const key = title.toLowerCase().replace(/[^a-z0-9]/g, '').slice(0, 12) + (year ? year.slice(2) : '');
        bibText = `@book{${key},\n  title = {${title}},\n  isbn = {${isbn}},\n  year = {${year}}\n}\n`;
      }
    }
  } catch {
    // Network unavailable — fall through to manual entry.
  }

  if (!bibText) {
    bibText = await vscode.window.showInputBox({
      prompt: 'Could not fetch automatically. Paste BibTeX entry:',
      placeHolder: '@article{key, title={…}, author={…}, year={…}}',
    });
    if (!bibText) return;
  }

  // Find or create the .bib file named in front matter, else refs.bib next to the note.
  const parsed = parse(doc.getText());
  const root = vscode.workspace.getWorkspaceFolder(doc.uri)?.uri.fsPath;
  const notePath = doc.uri.fsPath;
  const bibName = (parsed.frontMatter?.data['bibliography'] as string | undefined)?.trim() || 'refs.bib';
  const bibPath = bibName.startsWith('/')
    ? (root ? path.join(root, bibName) : bibName)
    : path.resolve(path.dirname(notePath), bibName);
  const bibUri = vscode.Uri.file(bibPath);

  let existing = '';
  try { existing = new TextDecoder().decode(await vscode.workspace.fs.readFile(bibUri)); } catch { /* new file */ }
  await vscode.workspace.fs.writeFile(bibUri, new TextEncoder().encode(`${existing}\n${bibText}`.trimStart()));
  void vscode.window.showInformationMessage(`YAMD: Added citation to ${path.basename(bibPath)}`);
}

// ---- Insert math symbol -----------------------------------------------------

async function insertSymbol(): Promise<void> {
  const editor = vscode.window.activeTextEditor;
  if (!editor) return;

  const items = MATH_SYMBOLS.map((s) => ({ label: `$${s.tex}$`, description: s.name, detail: s.category, tex: s.tex }));
  const pick = await vscode.window.showQuickPick(items, { placeHolder: 'Insert math symbol', matchOnDescription: true, matchOnDetail: true });
  if (!pick) return;

  const snippet = `$${pick.tex}$`;
  await editor.insertSnippet(new vscode.SnippetString(snippet));
}

// ---- Peer review (accept / reject all) --------------------------------------

async function resolveAllReview(mode: 'accept' | 'reject'): Promise<void> {
  const doc = activeYamd();
  if (!doc) { void vscode.window.showInformationMessage('YAMD: Open a .yamd file first.'); return; }
  const parsed = parse(doc.getText());
  const items = collectReview(parsed);
  if (!items.length) { void vscode.window.showInformationMessage('YAMD: No review markup found.'); return; }
  const resolved = resolveReview(parsed, mode);
  const edit = new vscode.WorkspaceEdit();
  edit.replace(doc.uri, new vscode.Range(0, 0, doc.lineCount, 0), resolved);
  await vscode.workspace.applyEdit(edit);
  void vscode.window.showInformationMessage(`YAMD: ${items.length} change(s) ${mode === 'accept' ? 'accepted' : 'rejected'}.`);
}

// ---- Combine notes ----------------------------------------------------------

async function combineNotes(index: WorkspaceIndex): Promise<void> {
  if (!requireFolder()) return;
  await index.whenReady();

  const summaries = index.store.summaries().sort((a, b) => (a.title ?? a.path).localeCompare(b.title ?? b.path));
  const items = summaries.map((s) => ({ label: s.title || path.basename(s.path, '.yamd'), description: s.path, path: s.path, picked: false }));
  const picked = await vscode.window.showQuickPick(items, { placeHolder: 'Select notes to combine (space to select)', canPickMany: true });
  if (!picked?.length) return;

  const title = await vscode.window.showInputBox({ prompt: 'Combined note title', placeHolder: 'Combined' }) ?? 'Combined';
  const parts: string[] = [`---\ntitle: ${JSON.stringify(title)}\ndate: ${todayIso()}\nlang: en\n---\n\n`, `# ${title}\n\n`];
  for (const p of picked) {
    const text = index.store.read(p.path) ?? '';
    // Strip front matter
    const body = text.startsWith('---\n')
      ? (text.slice(text.indexOf('\n---\n', 4) + 5) || text)
      : text;
    const noteTitle = summaries.find((s) => s.path === p.path)?.title || path.basename(p.path, '.yamd');
    parts.push(`## ${noteTitle}\n\n${body.trimStart()}\n\n`);
  }

  const root = requireFolder()!;
  const slug = title.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '') || 'combined';
  const uri = vscode.Uri.joinPath(root, `${slug}.yamd`);
  await vscode.workspace.fs.writeFile(uri, new TextEncoder().encode(parts.join('')));
  const doc = await vscode.workspace.openTextDocument(uri);
  await vscode.window.showTextDocument(doc);
}

// ---- Import -----------------------------------------------------------------

async function importFolder(): Promise<void> {
  const root = requireFolder();
  if (!root) return;

  const source = await vscode.window.showQuickPick(
    [
      { label: 'Obsidian vault', id: 'obsidian' },
      { label: 'Notion Markdown export', id: 'notion' },
      { label: 'HTML files', id: 'html' },
    ],
    { placeHolder: 'Import from…' },
  );
  if (!source) return;

  const folderUriArr = await vscode.window.showOpenDialog({ canSelectFiles: false, canSelectFolders: true, canSelectMany: false, openLabel: 'Select folder to import' });
  const srcUri0 = folderUriArr?.[0];
  if (!srcUri0) return;
  const srcUri: vscode.Uri = srcUri0;

  const destName = await vscode.window.showInputBox({ prompt: 'Destination sub-folder (empty = workspace root)', placeHolder: 'imported' }) ?? '';
  const dest = destName.trim() ? vscode.Uri.joinPath(root, destName.trim()) : root;
  await vscode.workspace.fs.createDirectory(dest);

  const sourceId = source.id;
  let converted = 0;
  let skipped = 0;

  async function walk(dir: vscode.Uri): Promise<void> {
    const entries = await vscode.workspace.fs.readDirectory(dir);
    for (const [name, type] of entries) {
      const childUri = vscode.Uri.joinPath(dir, name);
      if (type & vscode.FileType.Directory) {
        await walk(childUri);
      } else if (type & vscode.FileType.File) {
        const ext = path.extname(name).toLowerCase();
        const base = path.basename(name, ext);
        const rel = path.relative(srcUri.fsPath, childUri.fsPath);
        const outDir = vscode.Uri.joinPath(dest, path.dirname(rel));
        await vscode.workspace.fs.createDirectory(outDir);

        if (ext === '.md' || ext === '.markdown') {
          const raw = new TextDecoder().decode(await vscode.workspace.fs.readFile(childUri));
          const yamd = sourceId === 'obsidian' ? obsidianToYamd(raw) : notionToYamd(raw);
          await vscode.workspace.fs.writeFile(vscode.Uri.joinPath(outDir, `${base}.yamd`), new TextEncoder().encode(yamd));
          converted++;
        } else if (ext === '.html' || ext === '.htm') {
          const raw = new TextDecoder().decode(await vscode.workspace.fs.readFile(childUri));
          const yamd = htmlToYamd(raw, base);
          await vscode.workspace.fs.writeFile(vscode.Uri.joinPath(outDir, `${base}.yamd`), new TextEncoder().encode(yamd));
          converted++;
        } else {
          skipped++;
        }
      }
    }
  }

  await walk(srcUri);
  void vscode.window.showInformationMessage(`YAMD: Imported ${converted} note(s)${skipped ? `, skipped ${skipped} file(s)` : ''}.`);
}

// ---- Insert PDF reference ---------------------------------------------------

async function insertPdfReference(): Promise<void> {
  const editor = vscode.window.activeTextEditor;
  if (!editor) return;

  const pdfUri = await vscode.window.showOpenDialog({ canSelectFiles: true, canSelectMany: false, filters: { PDF: ['pdf'] }, openLabel: 'Select PDF' });
  if (!pdfUri?.[0]) return;

  const page = await vscode.window.showInputBox({ prompt: 'Page number (optional)', placeHolder: '42' });
  const comment = await vscode.window.showInputBox({ prompt: 'Comment (optional)', placeHolder: 'Key result' });

  const base = path.basename(pdfUri[0].fsPath, '.pdf');
  const rel = vscode.workspace.asRelativePath(pdfUri[0]);
  let text = `[${base}](${rel})`;
  if (page?.trim()) text += `, p. ${page.trim()}`;
  if (comment?.trim()) text += ` — ${comment.trim()}`;

  await editor.insertSnippet(new vscode.SnippetString(text));
}

// ---- New reading list -------------------------------------------------------

async function newReadingList(): Promise<void> {
  const root = requireFolder();
  if (!root) return;
  const uri = vscode.Uri.joinPath(root, 'reading-list.ydb');
  try { await vscode.workspace.fs.stat(uri); } catch {
    await vscode.workspace.fs.writeFile(uri, new TextEncoder().encode(READING_LIST_YDB));
  }
  const doc = await vscode.workspace.openTextDocument(uri);
  await vscode.window.showTextDocument(doc);
}

// ---- Prune cards ------------------------------------------------------------

async function pruneCards(index: WorkspaceIndex): Promise<void> {
  if (!requireFolder()) return;
  const { parseSchedule, pruneSchedule, stringifySchedule } = await import('../core/study/cards');
  await index.whenReady();
  const liveIds = new Set(collectCards(index).map((c) => c.id));
  const text = await readData('srs.json');
  const schedule = parseSchedule(text);
  const before = Object.keys(schedule.cards).length;
  const pruned = pruneSchedule(schedule, liveIds);
  const after = Object.keys(pruned.cards).length;
  if (before === after) { void vscode.window.showInformationMessage('YAMD: No orphaned card data found.'); return; }
  await writeData('srs.json', stringifySchedule(pruned));
  void vscode.window.showInformationMessage(`YAMD: Pruned ${before - after} orphaned card(s).`);
}

// ---- Registration -----------------------------------------------------------

export function registerStudyCommands(
  context: vscode.ExtensionContext,
  index: WorkspaceIndex,
  review: ReviewPanel,
  dashboard: DashboardPanel,
  timer: StudyTimer,
): void {
  context.subscriptions.push(
    vscode.commands.registerCommand('yamd.reviewCards', () => review.show()),
    vscode.commands.registerCommand('yamd.openDashboard', () => dashboard.show()),
    vscode.commands.registerCommand('yamd.startStudyTimer', async () => {
      const courses = [...new Set(index.store.summaries().map((s) => typeof s.properties['course'] === 'string' ? s.properties['course'] as string : undefined).filter((c): c is string => !!c))].sort();
      const course = courses.length
        ? await vscode.window.showQuickPick(['(no course)', ...courses], { placeHolder: 'Study session for…' })
        : undefined;
      if (course === undefined && courses.length) return;
      await timer.start(course && course !== '(no course)' ? course : undefined);
    }),
    vscode.commands.registerCommand('yamd.pauseStudyTimer', () => timer.pause()),
    vscode.commands.registerCommand('yamd.stopStudyTimer', () => timer.finish()),
    vscode.commands.registerCommand('yamd.studyTimerMenu', async () => {
      const courses = [...new Set(index.store.summaries().map((s) => typeof s.properties['course'] === 'string' ? s.properties['course'] as string : undefined).filter((c): c is string => !!c))].sort();
      await timer.menu(courses);
    }),
    vscode.commands.registerCommand('yamd.newStudyNote', (uri?: vscode.Uri) => newStudyNote(uri)),
    vscode.commands.registerCommand('yamd.generateCheatSheet', () => generateCheatSheet(index)),
    vscode.commands.registerCommand('yamd.exportHtml', () => exportNote('html')),
    vscode.commands.registerCommand('yamd.exportPdf', () => exportNote('pdf')),
    vscode.commands.registerCommand('yamd.exportDocx', () => exportNote('docx')),
    vscode.commands.registerCommand('yamd.exportSlides', () => exportNote('slides')),
    vscode.commands.registerCommand('yamd.addCitation', () => addCitation()),
    vscode.commands.registerCommand('yamd.insertSymbol', () => insertSymbol()),
    vscode.commands.registerCommand('yamd.acceptAllChanges', () => resolveAllReview('accept')),
    vscode.commands.registerCommand('yamd.rejectAllChanges', () => resolveAllReview('reject')),
    vscode.commands.registerCommand('yamd.combineNotes', () => combineNotes(index)),
    vscode.commands.registerCommand('yamd.importFolder', () => importFolder()),
    vscode.commands.registerCommand('yamd.insertPdfReference', () => insertPdfReference()),
    vscode.commands.registerCommand('yamd.newReadingList', () => newReadingList()),
    vscode.commands.registerCommand('yamd.pruneCards', () => pruneCards(index)),
    vscode.commands.registerCommand('yamd.toggleQuiz', () => {
      // Handled by PreviewManager — just forward so it can be key-bound.
      void vscode.commands.executeCommand('yamd.toggleQuizInternal');
    }),
  );
}
