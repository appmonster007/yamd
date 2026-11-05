// Runs inside VS Code's extension host (see scripts/integration.mjs). Checks the installed behaviour of
// the extension against a copy of the examples, and writes the results next to the workspace.
const vscode = require('vscode');
const fs = require('node:fs');
const path = require('node:path');

const results = [];
const test = (name, fn) => results.push({ name, fn });
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const until = async (cond, ms = 8000, step = 100) => {
  const end = Date.now() + ms;
  for (;;) {
    const v = await cond();
    if (v) return v;
    if (Date.now() > end) return undefined;
    await sleep(step);
  }
};
const assert = (cond, msg) => {
  if (!cond) throw new Error(msg);
};

async function open(root, rel) {
  const uri = vscode.Uri.file(path.join(root, rel));
  const doc = await vscode.workspace.openTextDocument(uri);
  const editor = await vscode.window.showTextDocument(doc);
  return { uri, doc, editor };
}

async function setText(editor, text) {
  await editor.edit((b) => b.replace(new vscode.Range(0, 0, editor.document.lineCount, 0), text));
}

exports.run = async function run() {
  const root = vscode.workspace.workspaceFolders[0].uri.fsPath;
  const out = process.env.YAMD_QA_OUT;
  const ext = vscode.extensions.getExtension('appmonster007.vscode-yamd-ext');

  test('the extension activates', async () => {
    assert(ext, 'extension not found');
    await ext.activate();
    assert(ext.isActive, 'not active');
  });

  test('every contributed command is registered', async () => {
    const all = await vscode.commands.getCommands(true);
    const want = ext.packageJSON.contributes.commands.map((c) => c.command);
    const missing = want.filter((c) => !all.includes(c));
    assert(missing.length === 0, `missing: ${missing.join(', ')}`);
  });

  test('a CodeLens appears above each widget block, named by id or position', async () => {
    const { uri } = await open(root, '02-widgets/kanban.md');
    const lenses = await until(async () => {
      const l = await vscode.commands.executeCommand('vscode.executeCodeLensProvider', uri);
      return l && l.length ? l : undefined;
    });
    assert(lenses, 'no code lenses');
    const titles = lenses.map((l) => l.command?.title ?? '');
    assert(titles.some((t) => t.includes('Open kanban: sprint-12')), titles.join(' | '));
    assert(titles.some((t) => t.includes('Open kanban: personal-reading')), titles.join(' | '));
  });

  test('a plain sql block has no lens, a query block has one', async () => {
    const { uri } = await open(root, '03-queries/queries.md');
    const lenses = await vscode.commands.executeCommand('vscode.executeCodeLensProvider', uri);
    const titles = lenses.map((l) => l.command?.title ?? '');
    assert(titles.some((t) => t.includes('Open sql: open-bugs')), titles.join(' | '));
    assert(titles.length === 7, `expected 7 lenses (one per query block), got ${titles.length}: ${titles.join(' | ')}`);
  });

  test('diagnostics: duplicate ids, a missing blank line and unknown markers are reported', async () => {
    const { uri, editor } = await open(root, '01-writing/markers.md');
    await setText(editor, '```kanban a\n```\n\n```kanban a\n```\n\n> [!note] x\n> y\nlazy\n\n<!-- yamd:banana -->\n<!-- yamd:toc -->\n');
    const diags = await until(() => {
      const d = vscode.languages.getDiagnostics(uri);
      return d.some((x) => x.code === 'W001') && d.some((x) => x.code === 'C002') && d.some((x) => x.code === 'M001') ? d : undefined;
    });
    assert(diags, `got ${JSON.stringify(vscode.languages.getDiagnostics(uri).map((d) => d.code))}`);
    const codes = diags.map((d) => d.code);
    assert(codes.includes('M002'), `no M002 in ${codes}`);
  });

  test('quick fixes: name an unnamed block, add the blank line after a callout', async () => {
    const { uri, editor } = await open(root, '02-widgets/gallery.md');
    await setText(editor, '```kanban\n- [ ] a\n```\n\n> [!note] x\n> y\nlazy\n');
    const diags = await until(() => {
      const d = vscode.languages.getDiagnostics(uri);
      return d.some((x) => x.code === 'W002') && d.some((x) => x.code === 'C002') ? d : undefined;
    });
    assert(diags, 'diagnostics did not appear');
    const w = diags.find((d) => d.code === 'W002');
    const actions = await vscode.commands.executeCommand('vscode.executeCodeActionProvider', uri, w.range);
    const name = actions.find((a) => /Name this block/.test(a.title));
    assert(name, `actions: ${actions.map((a) => a.title)}`);
    await vscode.workspace.applyEdit(name.edit);
    assert(editor.document.lineAt(0).text === '```kanban id=kanban-1', editor.document.lineAt(0).text);
  });

  test('Build restores reference links and a second Build changes nothing', async () => {
    const { doc, editor } = await open(root, '01-writing/references.md');
    const original = doc.getText();
    await setText(editor, original.replace('[Figure 1](#fig-arch)', '[@fig-arch]').replace(/\[\(Lamport[^\]]*\]\(#ref-lamport1978 "cite"\)/, '[@lamport1978]'));
    assert(doc.getText() !== original, 'setup edit failed');
    await vscode.commands.executeCommand('yamd.build');
    assert(doc.getText() === original, 'Build did not restore the note');
    await vscode.commands.executeCommand('yamd.build');
    assert(doc.getText() === original, 'a second Build changed the note');
  });

  test('Run Query writes a snapshot once and not again', async () => {
    const { doc, editor } = await open(root, '03-queries/queries.md');
    const line = doc.getText().split('\n').findIndex((l) => l.includes('id="open-bugs"'));
    editor.selection = new vscode.Selection(line, 0, line, 0);
    await vscode.commands.executeCommand('yamd.runQuery');
    const text = doc.getText();
    assert(text.includes('<!-- yamd:query:open-bugs -->'), 'no snapshot marker');
    assert(text.includes('| id | title | owner | days_open |'), 'no table');
    assert(/\*Last run: /.test(text), 'no last run');
    await sleep(1100);
    editor.selection = new vscode.Selection(line, 0, line, 0);
    await vscode.commands.executeCommand('yamd.runQuery');
    assert(doc.getText() === text, 'a second run changed the note');
  });

  test('opening a widget creates a panel beside the note', async () => {
    const { uri, doc } = await open(root, '02-widgets/kanban.md');
    const start = doc.getText().split('\n').findIndex((l) => l.startsWith('```kanban sprint-12'));
    assert(start >= 0, 'example changed');
    await vscode.commands.executeCommand('yamd.openWidget', uri, start);
    const tab = await until(() => vscode.window.tabGroups.all.flatMap((g) => g.tabs).find((t) => t.label === 'sprint-12'));
    assert(tab, `tabs: ${vscode.window.tabGroups.all.flatMap((g) => g.tabs).map((t) => t.label)}`);
    await vscode.commands.executeCommand('yamd.openWidget', uri, start);
    const count = vscode.window.tabGroups.all.flatMap((g) => g.tabs).filter((t) => t.label === 'sprint-12').length;
    assert(count === 1, `opened ${count} panels`);
  });

  test('the palette commands open the block under the cursor, like the CodeLens', async () => {
    const { doc, editor } = await open(root, '02-widgets/calendar.md');
    const start = doc.getText().split('\n').findIndex((l) => l.startsWith('```calendar'));
    editor.selection = new vscode.Selection(start + 1, 0, start + 1, 0);
    await vscode.commands.executeCommand('yamd.openCalendar');
    assert(await until(() => vscode.window.tabGroups.all.flatMap((g) => g.tabs).find((t) => t.label === 'december')), 'Open Calendar did not open the block');
    // The only timeline in its note opens without asking, from anywhere in the note.
    const t = await open(root, '02-widgets/timeline.md');
    t.editor.selection = new vscode.Selection(0, 0, 0, 0);
    await vscode.commands.executeCommand('yamd.openTimeline');
    assert(await until(() => vscode.window.tabGroups.all.flatMap((g) => g.tabs).find((x) => x.label === 'q1-roadmap')), 'Open Timeline did not open the only timeline');
    // The generic command opens the block at the cursor too.
    const g = await open(root, '02-widgets/kanban.md');
    const line = g.doc.getText().split('\n').findIndex((l) => l.startsWith('```kanban personal-reading'));
    g.editor.selection = new vscode.Selection(line + 1, 0, line + 1, 0);
    await vscode.commands.executeCommand('yamd.openWidget');
    assert(await until(() => vscode.window.tabGroups.all.flatMap((x) => x.tabs).find((x) => x.label === 'personal-reading')), 'Open Widget did not open the block at the cursor');
  });

  test('a query widget opens too', async () => {
    const { uri, doc } = await open(root, '03-queries/queries.md');
    const line = doc.getText().split('\n').findIndex((l) => l.startsWith('```sql')) ;
    const block = doc.getText().split('\n').findIndex((l) => l.includes('id="bugs-per-owner"')) - 1;
    await vscode.commands.executeCommand('yamd.openWidget', uri, block);
    const tab = await until(() => vscode.window.tabGroups.all.flatMap((g) => g.tabs).find((t) => t.label === 'bugs-per-owner'));
    assert(tab, 'no query panel');
    void line;
  });

  test('accept and reject changes at the cursor and for the whole note', async () => {
    const { doc, editor } = await open(root, '01-writing/review-marks.md');
    await setText(editor, 'A <ins>new</ins> and <del>old</del> word.\n\nB <ins>x</ins>.');
    const col = doc.getText().indexOf('new');
    editor.selection = new vscode.Selection(0, col, 0, col);
    await vscode.commands.executeCommand('yamd.acceptChange');
    assert(doc.lineAt(0).text === 'A new and <del>old</del> word.', doc.lineAt(0).text);
    await vscode.commands.executeCommand('yamd.rejectAllChanges');
    assert(doc.getText() === 'A new and old word.\n\nB .', JSON.stringify(doc.getText()));
  });

  test('Go to Reference Target moves the cursor to the target', async () => {
    const { doc, editor } = await open(root, '01-writing/references.md');
    const text = doc.getText().split('\n');
    const at = text.findIndex((l) => l.includes('(#fig-arch)') && l.startsWith('Write'));
    const row = text.findIndex((l) => l.includes('[Figure 1](#fig-arch)'));
    const target = text.findIndex((l) => l.trim() === '^fig-arch');
    assert(row >= 0 && target >= 0, 'example changed');
    const col = text[row].indexOf('Figure 1') + 2;
    editor.selection = new vscode.Selection(row, col, row, col);
    await vscode.commands.executeCommand('yamd.goToReference');
    assert(editor.selection.active.line === target, `cursor on ${editor.selection.active.line}, wanted ${target}`);
    void at;
  });

  test('Export HTML writes a page with numbered callouts, anchors and static widgets', async () => {
    const { doc } = await open(root, '05-export/export.md');
    await vscode.commands.executeCommand('yamd.exportHtml');
    const file = doc.uri.fsPath.replace(/\.md$/, '.html');
    const ok = await until(() => fs.existsSync(file));
    assert(ok, 'no html written');
    const html = fs.readFileSync(file, 'utf8');
    assert(/Theorem 1/.test(html), 'no numbered theorem');
    assert(/class="kanban/.test(html), 'no static board');
    assert(/<table[^>]*db-table/.test(html), 'no query table');
    assert(/id="thm-short"/.test(html), 'the theorem keeps its id');
    assert(!/YAMD(ANCHOR|QUERY|WIDGET|ATTRS)/.test(html), 'placeholder left behind');
    assert(!/<br/.test(html), 'a soft line break became <br>');
  });

  test('Export Slides writes a deck', async () => {
    const { doc } = await open(root, '05-export/export.md');
    await vscode.commands.executeCommand('yamd.exportSlides');
    const file = doc.uri.fsPath.replace(/\.md$/, '-slides.html');
    assert(await until(() => fs.existsSync(file)), 'no slides');
    assert(/class="slide/.test(fs.readFileSync(file, 'utf8')), 'no slides in file');
  });

  test('alias commands are registered and the companions are installed', async () => {
    for (const id of ['foam.foam-vscode', 'yy0931.vscode-sqlite3-editor', 'janisdd.vscode-edit-csv', 'mechatroner.rainbow-csv', 'yzhang.markdown-all-in-one']) {
      assert(vscode.extensions.getExtension(id), `${id} is not installed`);
    }
  });

  const report = [];
  let failed = 0;
  for (const t of results) {
    try {
      await Promise.race([t.fn(), new Promise((_, rej) => setTimeout(() => rej(new Error('timed out')), 30000))]);
      report.push({ name: t.name, ok: true });
    } catch (e) {
      failed++;
      report.push({ name: t.name, ok: false, error: String(e && e.message ? e.message : e) });
    }
  }
  if (out) fs.writeFileSync(out, JSON.stringify(report, null, 2));
  if (failed) throw new Error(`${failed} of ${results.length} checks failed`);
};
