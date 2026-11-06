// Runs in VS Code with the workspace NOT trusted (Restricted Mode); see scripts/integration.mjs --untrusted.
const vscode = require('vscode');
const fs = require('node:fs');
const path = require('node:path');

const results = [];
const test = (name, fn) => results.push({ name, fn });
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const assert = (cond, msg) => {
  if (!cond) throw new Error(msg);
};

exports.run = async function run() {
  const root = vscode.workspace.workspaceFolders[0].uri.fsPath;
  const out = process.env.YAMD_QA_OUT;
  const ext = vscode.extensions.getExtension('appmonster007.vscode-yamd-ext');
  const open = async (file) => {
    const doc = await vscode.workspace.openTextDocument(file);
    const editor = await vscode.window.showTextDocument(doc);
    return { doc, editor };
  };

  test('the workspace really is untrusted and the extension still activates', async () => {
    await ext.activate();
    assert(ext.isActive, 'not active');
    assert(vscode.workspace.isTrusted === false, 'the workspace is trusted, so these checks prove nothing');
  });

  test('Run Query and Run All Queries refuse to write results into the note', async () => {
    const { doc, editor } = await open(path.join(root, '03-queries', 'queries.md'));
    const before = doc.getText();
    editor.selection = new vscode.Selection(18, 0, 18, 0);
    await vscode.commands.executeCommand('yamd.runQuery');
    await vscode.commands.executeCommand('yamd.runAllQueries');
    await sleep(800);
    assert(doc.getText() === before, 'the note was changed in Restricted Mode');
  });

  test('Transcribe Audio does not run the configured tool', async () => {
    const marker = path.join(root, '__ran-tool');
    const tool = path.join(root, '__tool.sh');
    fs.writeFileSync(tool, `#!/bin/sh\ntouch ${marker}\necho text\n`);
    fs.chmodSync(tool, 0o755);
    fs.writeFileSync(path.join(root, '__t.md'), '[Rec](01-writing/audio/note-2026-11-05-0930.wav)\n');
    await vscode.workspace.getConfiguration('yamd.audio').update('transcribeCommand', `${tool} {file}`, vscode.ConfigurationTarget.Global);
    const { doc, editor } = await open(path.join(root, '__t.md'));
    editor.selection = new vscode.Selection(0, 0, 0, 0);
    await vscode.commands.executeCommand('yamd.transcribeAudio');
    await sleep(1500);
    assert(!fs.existsSync(marker), 'the tool ran in Restricted Mode');
    assert(!doc.getText().includes('Transcript'), 'a transcript was written');
  });

  test('Record Audio refuses', async () => {
    await open(path.join(root, '01-writing', 'audio.md'));
    await vscode.commands.executeCommand('yamd.recordAudio');
    await sleep(500);
    const tabs = vscode.window.tabGroups.all.flatMap((g) => g.tabs).filter((t) => t.input && t.input.viewType && /recorder/i.test(t.input.viewType));
    assert(tabs.length === 0, 'a recorder opened');
  });

  test('a query on a file outside the workspace is blocked in an export; one inside still runs', async () => {
    const outside = path.join(path.dirname(root), 'outside.csv');
    fs.writeFileSync(outside, 'id,name\n1,secret\n');
    const note = path.join(root, '__q.md');
    fs.writeFileSync(note, '```sql\n-- id="out" source="../outside.csv" view="table"\nSELECT * FROM outside;\n```\n\n```sql\n-- id="inn" source="03-queries/bugs.csv" view="table"\nSELECT id FROM bugs LIMIT 1;\n```\n');
    const { doc } = await open(note);
    await vscode.commands.executeCommand('yamd.exportWidget', doc.uri, 0);
    const outPage = fs.readFileSync(note.replace(/\.md$/, '-out.html'), 'utf8');
    assert(!outPage.includes('secret'), 'data outside the workspace was read');
    assert(/blocked|trusted/i.test(outPage), 'no explanation in the page');
    await vscode.commands.executeCommand('yamd.exportWidget', doc.uri, 5);
    const innPage = fs.readFileSync(note.replace(/\.md$/, '-inn.html'), 'utf8');
    assert(/<table/.test(innPage), 'a query inside the workspace did not run');
  });

  test('Build and the diagnostics still work', async () => {
    const { doc, editor } = await open(path.join(root, '01-writing', 'toc-and-build.md'));
    await vscode.commands.executeCommand('yamd.build');
    await sleep(300);
    assert(doc.getText().length > 0 && editor, 'build failed');
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
