import * as path from 'node:path';
import * as vscode from 'vscode';
import { expandPlaceholders, formatDate, parseDate } from '../core/templates';

function settings() {
  const daily = vscode.workspace.getConfiguration('yamd.dailyNotes');
  return {
    folder: daily.get<string>('folder', 'daily'),
    format: daily.get<string>('format', 'YYYY-MM-DD'),
    template: daily.get<string>('template', ''),
    templates: vscode.workspace.getConfiguration('yamd.templates').get<string>('folder', 'templates'),
  };
}

function root(): vscode.Uri | undefined {
  const active = vscode.window.activeTextEditor?.document.uri;
  return (active && vscode.workspace.getWorkspaceFolder(active)?.uri) ?? vscode.workspace.workspaceFolders?.[0]?.uri;
}

async function exists(uri: vscode.Uri): Promise<boolean> {
  try {
    await vscode.workspace.fs.stat(uri);
    return true;
  } catch {
    return false;
  }
}

async function readText(uri: vscode.Uri): Promise<string> {
  return new TextDecoder().decode(await vscode.workspace.fs.readFile(uri));
}

/** Template text with placeholders expanded, and `{{@cursor}}` turned into a snippet tab stop. */
function snippet(template: string, title: string): vscode.SnippetString {
  const { text, cursor } = expandPlaceholders(template, { now: new Date(), title });
  const s = new vscode.SnippetString();
  if (cursor === undefined) {
    s.appendText(text);
    s.appendTabstop(0);
  } else {
    s.appendText(text.slice(0, cursor));
    s.appendTabstop(0);
    s.appendText(text.slice(cursor));
  }
  return s;
}

async function openDaily(date: Date): Promise<void> {
  const base = root();
  if (!base) {
    void vscode.window.showInformationMessage('YAMD: Open a folder to use daily notes.');
    return;
  }
  const { folder, format, template } = settings();
  const name = formatDate(date, format);
  const uri = vscode.Uri.joinPath(base, folder, `${name}.yamd`);
  if (!(await exists(uri))) {
    let text = '';
    if (template) {
      const t = vscode.Uri.joinPath(base, template);
      if (await exists(t)) text = expandPlaceholders(await readText(t), { now: date, title: name }).text;
      else void vscode.window.showWarningMessage(`YAMD: The daily note template "${template}" was not found.`);
    }
    if (!text.trimStart().startsWith('---')) {
      const lang = vscode.workspace.getConfiguration('yamd.newNote').get<string>('lang', 'en');
      text = `---\ntitle: ${name}\ndate: ${formatDate(date, 'YYYY-MM-DD')}\nlang: ${lang}\n---\n\n# ${name}\n\n${text}`;
    }
    await vscode.workspace.fs.createDirectory(vscode.Uri.joinPath(base, folder));
    await vscode.workspace.fs.writeFile(uri, new TextEncoder().encode(text));
  }
  await vscode.window.showTextDocument(uri);
}

/** Opens the nearest existing daily note before (-1) or after (+1) the active one. */
async function stepDaily(direction: -1 | 1): Promise<void> {
  const base = root();
  const active = vscode.window.activeTextEditor?.document.uri;
  if (!base) return;
  const { folder, format } = settings();
  const dir = vscode.Uri.joinPath(base, folder);
  const current = active ? parseDate(path.basename(active.fsPath, '.yamd'), format) : null;
  const from = current ?? new Date();
  let entries: [string, vscode.FileType][] = [];
  try {
    entries = await vscode.workspace.fs.readDirectory(dir);
  } catch {
    // No daily notes yet.
  }
  const dated = entries
    .filter(([n, t]) => t === vscode.FileType.File && n.endsWith('.yamd'))
    .map(([n]) => ({ name: n, date: parseDate(n.slice(0, -'.yamd'.length), format) }))
    .filter((e): e is { name: string; date: Date } => e.date !== null)
    .sort((a, b) => a.date.getTime() - b.date.getTime());
  const day = (d: Date) => formatDate(d, 'YYYY-MM-DD');
  const target =
    direction < 0
      ? [...dated].reverse().find((e) => day(e.date) < day(from))
      : dated.find((e) => day(e.date) > day(from));
  if (!target) {
    void vscode.window.showInformationMessage(`YAMD: There is no ${direction < 0 ? 'earlier' : 'later'} daily note.`);
    return;
  }
  await vscode.window.showTextDocument(vscode.Uri.joinPath(dir, target.name));
}

/** Template files in the `templates/` folder, for the quick pick in "Insert Template" and "New Note from Template". */
export async function findTemplates(base: vscode.Uri): Promise<{ label: string; description: string; uri: vscode.Uri }[]> {
  const { templates } = settings();
  const files = await vscode.workspace.findFiles(new vscode.RelativePattern(base, `${templates}/**/*.yamd`));
  return files.map((uri) => ({ label: path.basename(uri.fsPath, '.yamd'), description: vscode.workspace.asRelativePath(uri), uri }));
}

async function insertTemplate(): Promise<void> {
  const editor = vscode.window.activeTextEditor;
  const base = root();
  if (!editor || editor.document.languageId !== 'yamd' || !base) {
    void vscode.window.showInformationMessage('YAMD: Open a YAMD note to insert a template.');
    return;
  }
  const { templates } = settings();
  const items = await findTemplates(base);
  if (!items.length) {
    void vscode.window.showInformationMessage(`YAMD: No templates found in "${templates}". Set yamd.templates.folder to change it.`);
    return;
  }
  const pick = await vscode.window.showQuickPick(items, { placeHolder: 'Choose a template' });
  if (!pick) return;
  const title = path.basename(editor.document.uri.fsPath, '.yamd');
  let text = await readText(pick.uri);
  const doc = editor.document;
  if (doc.getText().trim() === '') {
    // An empty note takes the whole template, front matter included.
    await editor.edit((b) => b.delete(new vscode.Range(0, 0, doc.lineCount, 0)));
    await editor.insertSnippet(snippet(text, title), new vscode.Position(0, 0));
    return;
  }
  // Otherwise the template's front matter is left out.
  const fm = /^---\r?\n[\s\S]*?\r?\n(?:---|\.\.\.)\r?\n?/.exec(text);
  if (fm) text = text.slice(fm[0].length);
  await editor.insertSnippet(snippet(text, title));
}

export function registerDailyNotes(context: vscode.ExtensionContext): void {
  context.subscriptions.push(
    vscode.commands.registerCommand('yamd.openTodayDailyNote', () => openDaily(new Date())),
    vscode.commands.registerCommand('yamd.previousDailyNote', () => stepDaily(-1)),
    vscode.commands.registerCommand('yamd.nextDailyNote', () => stepDaily(1)),
    vscode.commands.registerCommand('yamd.insertTemplate', insertTemplate),
  );
}

/** Adds `line` under `heading` in the daily note for `date`, creating the note and heading if needed. */
export async function appendToDailyNote(date: Date, heading: string, line: string): Promise<vscode.Uri | undefined> {
  const base = root();
  if (!base) return undefined;
  const { folder, format, template } = settings();
  const name = formatDate(date, format);
  const uri = vscode.Uri.joinPath(base, folder, `${name}.yamd`);
  let text = '';
  if (await exists(uri)) text = await readText(uri);
  else {
    const t = template ? vscode.Uri.joinPath(base, template) : undefined;
    if (t && (await exists(t))) text = expandPlaceholders(await readText(t), { now: date, title: name }).text;
    if (!text.trimStart().startsWith('---')) {
      const lang = vscode.workspace.getConfiguration('yamd.newNote').get<string>('lang', 'en');
      text = `---\ntitle: ${name}\ndate: ${formatDate(date, 'YYYY-MM-DD')}\nlang: ${lang}\n---\n\n# ${name}\n\n${text}`;
    }
    await vscode.workspace.fs.createDirectory(vscode.Uri.joinPath(base, folder));
  }
  const lines = text.split('\n');
  const at = lines.findIndex((l) => l.trim() === `## ${heading}`);
  if (at === -1) {
    text = `${text.replace(/\s*$/, '')}${text.trim() ? '\n\n' : ''}## ${heading}\n\n${line}\n`;
  } else {
    // After the last line of the section's list.
    let end = at + 1;
    for (let i = at + 1; i < lines.length && !/^#{1,6}\s/.test(lines[i] ?? ''); i++) if ((lines[i] ?? '').trim()) end = i + 1;
    lines.splice(end, 0, ...(end === at + 1 ? ['', line] : [line]));
    text = lines.join('\n');
  }
  await vscode.workspace.fs.writeFile(uri, new TextEncoder().encode(text));
  return uri;
}
