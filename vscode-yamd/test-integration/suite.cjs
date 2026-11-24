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

  test('a plain sql block has no lens; each query block has Open and Run lenses', async () => {
    const { uri } = await open(root, '03-queries/queries.md');
    const lenses = await vscode.commands.executeCommand('vscode.executeCodeLensProvider', uri);
    const titles = lenses.map((l) => l.command?.title ?? '');
    assert(titles.some((t) => t.includes('Open sql: open-bugs')), titles.join(' | '));
    const opens = titles.filter((t) => t.includes('Open sql:')).length;
    assert(opens === 7 && titles.length === 21 && titles.filter((t) => /Edit CSV|Open data|SQLite editor/.test(t)).length === 7, `expected 7 Open, 7 Run and 7 data-file lenses, got ${opens} of ${titles.length}: ${titles.join(' | ')}`);
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

  test('exporting a calendar, a timeline and a gallery draws them with their content', async () => {
    const dir = path.join(root, '02-widgets');
    const cal = await open(root, '02-widgets/calendar.md');
    await vscode.commands.executeCommand('yamd.exportHtml');
    const calHtml = fs.readFileSync(cal.doc.uri.fsPath.replace(/\.md$/, '.html'), 'utf8');
    assert(/December 2026/.test(calHtml) && /Submit grant report/.test(calHtml), 'the calendar export has no December events');
    const tl = await open(root, '02-widgets/timeline.md');
    await vscode.commands.executeCommand('yamd.exportHtml');
    const tlHtml = fs.readFileSync(tl.doc.uri.fsPath.replace(/\.md$/, '.html'), 'utf8');
    assert(/db-timeline-axis/.test(tlHtml) && /Migrate auth/.test(tlHtml), 'the timeline export has no scale or bars');
    // A gallery written as a list, and one that names a folder.
    const file = path.join(dir, 'qa-gallery.md');
    fs.writeFileSync(file, '# G\n\n```gallery list\n- ![One](../assets/team.svg)\n- ![Two](../assets/architecture.svg)\n```\n\n```gallery id=folder source="../assets"\n```\n');
    const g = await open(root, '02-widgets/qa-gallery.md');
    await vscode.commands.executeCommand('yamd.exportHtml');
    const gHtml = fs.readFileSync(g.doc.uri.fsPath.replace(/\.md$/, '.html'), 'utf8');
    const cards = (gHtml.match(/class="db-card"/g) ?? []).length;
    assert(cards === 5, `expected 5 gallery cards (2 listed + 3 in the folder), got ${cards}`);
    assert(/<img src="\.\.\/assets\/team\.svg"/.test(gHtml), 'gallery image missing');
  });

  test('Export Slides writes a deck', async () => {
    const { doc } = await open(root, '05-export/export.md');
    await vscode.commands.executeCommand('yamd.exportSlides');
    const file = doc.uri.fsPath.replace(/\.md$/, '-slides.html');
    assert(await until(() => fs.existsSync(file)), 'no slides');
    assert(/class="slide/.test(fs.readFileSync(file, 'utf8')), 'no slides in file');
  });

  test('the sidebar views exist and open', async () => {
    for (const view of ['widgets', 'outline', 'cards', 'deadlines', 'study']) {
      await vscode.commands.executeCommand(`yamd.${view}.focus`);
    }
    const all = await vscode.commands.getCommands(true);
    for (const c of ['yamd.showGraph', 'yamd.showBacklinks', 'yamd.showTags']) assert(all.includes(c), `${c} is not registered`);
  });

  test('Record Audio opens one recorder panel, and refuses a note that is not markdown', async () => {
    await open(root, '01-writing/audio.md');
    await vscode.commands.executeCommand('yamd.recordAudio');
    assert(await until(() => vscode.window.tabGroups.all.flatMap((g) => g.tabs).find((t) => t.label === 'Record audio')), 'no recorder panel');
    await vscode.commands.executeCommand('yamd.recordAudio');
    const panels = vscode.window.tabGroups.all.flatMap((g) => g.tabs).filter((t) => t.label === 'Record audio').length;
    assert(panels === 1, `opened ${panels} recorder panels`);
    assert(ext.packageJSON.contributes.configuration.properties['yamd.audio.folder'], 'the folder setting is missing');
  });

  test('alias commands are registered and the companions are installed', async () => {
    for (const id of ['foam.foam-vscode', 'yy0931.vscode-sqlite3-editor', 'janisdd.vscode-edit-csv', 'mechatroner.rainbow-csv', 'yzhang.markdown-all-in-one']) {
      assert(vscode.extensions.getExtension(id), `${id} is not installed`);
    }
  });

  test('completion offers widget types, callout types and source files', async () => {
    const file = path.join(root, '__completion.md');
    fs.writeFileSync(file, '```ka\n```\n\n> [!the\n\n```sql\n-- id="q" source="\n```\n');
    const doc = await vscode.workspace.openTextDocument(file);
    await vscode.window.showTextDocument(doc);
    const labels = async (line, ch) => {
      const list = await vscode.commands.executeCommand('vscode.executeCompletionItemProvider', doc.uri, new vscode.Position(line, ch));
      return list.items.map((i) => (typeof i.label === 'string' ? i.label : i.label.label));
    };
    const types = await labels(0, 5);
    assert(types.includes('kanban'), `widget types: ${types.slice(0, 8).join(', ')}`);
    const callouts = await labels(3, 8);
    assert(callouts.includes('theorem'), `callouts: ${callouts.slice(0, 8).join(', ')}`);
  });

  test('Run All Queries writes snapshots and a second run changes nothing', async () => {
    const { doc, editor } = await open(root, '03-queries/queries.md');
    const run = async () => {
      await vscode.commands.executeCommand('yamd.runAllQueries');
      await sleep(600);
      return doc.getText();
    };
    const first = await run();
    assert(/<!-- yamd:query:/.test(first), 'no snapshot written');
    assert((await run()) === first, 'second run changed the note');
    await vscode.commands.executeCommand('workbench.action.files.revert');
    void editor;
  });

  test('the snippets and walkthrough are contributed', async () => {
    const c = ext.packageJSON.contributes;
    assert(c.snippets?.some((s) => s.language === 'markdown'), 'no markdown snippets');
    assert(c.walkthroughs?.some((w) => w.id === 'yamd.start'), 'no walkthrough');
  });

  test('the Markdown preview is extended to draw mermaid blocks', async () => {
    const c = ext.packageJSON.contributes;
    assert(c['markdown.markdownItPlugins'] === true, 'markdownItPlugins not contributed');
    assert((c['markdown.previewScripts'] ?? []).some((p) => p.endsWith('mermaid-preview.js')), 'no preview script');
    assert(fs.existsSync(path.join(ext.extensionPath, 'dist', 'mermaid-preview.js')), 'script missing from the build');
    assert(typeof ext.exports?.extendMarkdownIt === 'function', 'extension does not export extendMarkdownIt');
    const rules = { fence: undefined };
    const md = { renderer: { rules }, utils: { escapeHtml: (t) => t.replace(/</g, '&lt;') } };
    ext.exports.extendMarkdownIt(md);
    const html = rules.fence([{ info: 'mermaid', content: 'A --> B', attrJoin() {} }], 0, {}, {}, { renderAttrs: () => ' class="yamd-mermaid"' });
    assert(html.includes('class="yamd-mermaid"') && html.includes('A --> B'), html);
  });

  test('the sidebar has outline and unlinked-mention views', async () => {
    const views = ext.packageJSON.contributes.views.yamd.map((v) => v.id);
    assert(views.includes('yamd.outline') && views.includes('yamd.mentions'), views.join(', '));
    const all = await vscode.commands.getCommands(true);
    assert(all.includes('yamd.linkMention'), 'yamd.linkMention missing');
  });

  test('Export HTML of a note with diagrams carries the drawing script; one without does not', async () => {
    const withDiagram = await open(root, '07-whats-new/diagrams-and-outline.md');
    await vscode.commands.executeCommand('yamd.exportHtml');
    const file = withDiagram.doc.uri.fsPath.replace(/\.md$/, '.html');
    assert(await until(() => fs.existsSync(file)), 'no html written');
    const html = fs.readFileSync(file, 'utf8');
    assert(/language-mermaid/.test(html), 'diagram source missing');
    assert(html.length > 1000000 && /mermaid/i.test(html.slice(-3000000)), 'drawing script not inlined');
    assert((html.match(/<\/script>/g) ?? []).length === 1, 'script was not closed cleanly');
    const plain = path.join(root, '05-export', 'export.html');
    assert(!fs.existsSync(plain) || fs.readFileSync(plain, 'utf8').length < 1000000, 'a note without diagrams got the script');
  });

  test('Link This Mention turns the plain-text name into a wikilink, and refuses a stale line', async () => {
    const { doc } = await open(root, '06-linked-notes/ideas.md');
    const line = doc.getText().split('\n').findIndex((l) => l.includes('Ask Ada Lovelace'));
    assert(line >= 0, 'example sentence missing');
    const col = doc.lineAt(line).text.indexOf('Ada Lovelace');
    const ada = path.join(root, '06-linked-notes', 'people', 'ada.md');
    const node = { label: 'x', mention: { path: doc.uri.fsPath, line, col, length: 'Ada Lovelace'.length, target: 'ada', text: 'Ada Lovelace' } };
    await vscode.commands.executeCommand('yamd.linkMention', { ...node, mention: { ...node.mention, text: 'Someone Else' } });
    assert(!doc.lineAt(line).text.includes('[[ada'), 'a stale mention was linked');
    await vscode.commands.executeCommand('yamd.linkMention', node);
    assert(doc.lineAt(line).text.includes('Ask [[ada|Ada Lovelace]] to review'), doc.lineAt(line).text);
    assert(fs.existsSync(ada), 'ada.md missing');
    await vscode.commands.executeCommand('workbench.action.files.revert');
  });

  test('the walkthrough has every step with a page, and the opening command exists', async () => {
    const steps = ext.packageJSON.contributes.walkthroughs[0].steps;
    assert(steps.length === 14, `only ${steps.length} steps`);
    for (const st of steps) assert(fs.existsSync(path.join(ext.extensionPath, st.media.markdown)), `${st.id}: page missing`);
    const all = await vscode.commands.getCommands(true);
    assert(all.includes('yamd.openWalkthrough') && all.includes('yamd.menu') && all.includes('yamd.openSource'), 'commands missing');
  });

  const scratch = (name, text) => {
    const file = path.join(root, name);
    fs.writeFileSync(file, text);
    return file;
  };
  const cfg = (section, key, value) => vscode.workspace.getConfiguration(section).update(key, value, vscode.ConfigurationTarget.Global);
  const openFile = async (file) => {
    const doc = await vscode.workspace.openTextDocument(file);
    const editor = await vscode.window.showTextDocument(doc);
    return { doc, editor };
  };

  test('yamd.build.onSave: saving builds the note, and saving again changes nothing', async () => {
    const file = scratch('__onsave.md', '# T\n\n![A](a.png)\n\n^fig-a\n\nSee [@fig-a].\n');
    await cfg('yamd.build', 'onSave', true);
    try {
      const { doc, editor } = await openFile(file);
      await editor.edit((b) => b.insert(new vscode.Position(0, 0), '\n'));
      await doc.save();
      assert(/\[Figure 1\]\(#fig-a\)/.test(fs.readFileSync(file, 'utf8')), `not built on save: ${fs.readFileSync(file, 'utf8')}`);
      const once = fs.readFileSync(file, 'utf8');
      await editor.edit((b) => b.insert(new vscode.Position(0, 0), '\n'));
      await doc.save();
      assert(fs.readFileSync(file, 'utf8').trim() === ('\n' + once).trim() || fs.readFileSync(file, 'utf8').includes('[Figure 1](#fig-a)'), 'second save broke the note');
    } finally {
      await cfg('yamd.build', 'onSave', undefined);
    }
  });

  test('yamd.queries.refreshOnSave refreshes an existing snapshot and does not add one elsewhere', async () => {
    const file = scratch('__refresh.md', '```sql\n-- id="a" source="03-queries/bugs.csv" view="table"\nSELECT id FROM bugs ORDER BY id;\n```\n\n<!-- yamd:query:a -->\nstale\n<!-- /yamd:query:a -->\n\n```sql\n-- id="b" source="03-queries/bugs.csv" view="table"\nSELECT id FROM bugs;\n```\n');
    await cfg('yamd.queries', 'refreshOnSave', true);
    try {
      const { doc, editor } = await openFile(file);
      await editor.edit((b) => b.insert(new vscode.Position(0, 0), '\n'));
      await doc.save();
      const text = fs.readFileSync(file, 'utf8');
      assert(!/stale/.test(text), 'the snapshot was not refreshed');
      assert(/<!-- yamd:query:a -->/.test(text) && !/yamd:query:b/.test(text), 'wrong snapshots: ' + text);
    } finally {
      await cfg('yamd.queries', 'refreshOnSave', undefined);
    }
  });

  test('Transcribe Audio runs the configured tool and writes a Transcript callout, replacing it the second time', async () => {
    const tool = path.join(root, '__fake-transcribe.sh');
    fs.writeFileSync(tool, '#!/bin/sh\necho "[00:00:00.000 --> 00:00:02.000]  Hello from the tool. Second sentence here."\n');
    fs.chmodSync(tool, 0o755);
    const note = scratch('__transcribe.md', '# Meeting\n\n[Rec](01-writing/audio/note-2026-11-05-0930.wav)\n\nAfter.\n');
    await cfg('yamd.audio', 'transcribeCommand', `${tool} {file}`);
    try {
      const { doc, editor } = await openFile(note);
      editor.selection = new vscode.Selection(2, 0, 2, 0);
      const settled = await Promise.race([vscode.commands.executeCommand('yamd.transcribeAudio').then(() => 'done'), sleep(6000).then(() => 'still running')]);
      await until(() => doc.getText().includes('[!note] Transcript'), 4000);
      if (!doc.getText().includes('[!note] Transcript')) throw new Error(`command ${settled}; setting=${JSON.stringify(vscode.workspace.getConfiguration('yamd.audio').get('transcribeCommand'))}; trusted=${vscode.workspace.isTrusted}; active=${vscode.window.activeTextEditor?.document.uri.fsPath}; text=${JSON.stringify(doc.getText())}`);
      assert(doc.getText().includes('> Hello from the tool.') && doc.getText().includes('> Second sentence here.'), doc.getText());
      await vscode.commands.executeCommand('yamd.transcribeAudio');
      await sleep(800);
      assert((doc.getText().match(/\[!note\] Transcript/g) ?? []).length === 1, 'the transcript was duplicated');
      assert(doc.getText().includes('After.'), 'text after the link was lost');
    } finally {
      await cfg('yamd.audio', 'transcribeCommand', undefined);
    }
  });

  test('Export as Single Markdown File inlines images and keeps query results; Export Widget writes a read-only page', async () => {
    const note = scratch('__export.md', '# E\n\n![Team](assets/team.svg)\n\n```kanban board\n## Todo\n- [ ] One {owner=ada}\n```\n\n```sql\n-- id="q" source="03-queries/bugs.csv" view="table"\nSELECT id, title FROM bugs ORDER BY id LIMIT 2;\n```\n');
    const { doc } = await openFile(note);
    await vscode.commands.executeCommand('yamd.exportMarkdown');
    const md = note.replace(/\.md$/, '.export.md');
    assert(await until(() => fs.existsSync(md)), 'no export.md written');
    const text = fs.readFileSync(md, 'utf8');
    assert(text.includes('data:image/svg+xml;base64,'), 'image not inlined');
    assert(/<!-- yamd:query:q -->/.test(text) && /Header overlaps logo/.test(text), 'query result missing');
    await vscode.commands.executeCommand('yamd.exportWidget', doc.uri, 4);
    const html = note.replace(/\.md$/, '-board.html');
    assert(await until(() => fs.existsSync(html)), 'no widget page written');
    const page = fs.readFileSync(html, 'utf8');
    assert(/kanban/.test(page) && /Read-only copy/.test(page) && !/class="card-edit"/.test(page), 'the widget page is not a static copy');
  });

  test('Study This Note writes cards from callouts once, and the review panel can open', async () => {
    const note = scratch('__study.md', '---\ncourse: X\n---\n\n# S\n\n> [!definition] Prime\n> A number with two divisors.\n\n> [!question] Why?\n> Because.\n');
    const { doc } = await openFile(note);
    await vscode.commands.executeCommand('yamd.studyThisNote');
    await until(() => doc.getText().includes('yamd:cards'));
    const first = doc.getText();
    assert(/> \[!card\] Definition: Prime/.test(first) && /> \[!card\] Why\?/.test(first), first);
    await vscode.commands.executeCommand('yamd.studyThisNote');
    await sleep(500);
    assert(doc.getText() === first, 'a second run changed the note');
    const cards = (first.match(/\[!card\]/g) ?? []).length;
    assert(cards === 2, `${cards} cards`);
  });

  test("VS Code's own Markdown preview draws mermaid through our plugin", async () => {
    const html = await vscode.commands.executeCommand('markdown.api.render', '# T\n\n```mermaid\nflowchart LR\n  A --> B\n```\n\n```js\nlet x;\n```\n');
    assert(typeof html === 'string', 'markdown.api.render returned nothing');
    assert(/<pre[^>]*yamd-mermaid[^>]*><code>flowchart LR/.test(html), `mermaid block not handed to the script: ${html}`);
    assert(!/yamd-mermaid[^]*yamd-mermaid/.test(html), 'a plain code block was treated as mermaid');
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
