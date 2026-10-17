import * as path from 'node:path';
import * as vscode from 'vscode';
import { parse, walkBlocks } from '../core';
import { parseIfCheap, warmParse } from '../core/parser';
import { plainText } from '../core/inline';
import { findBlock, findHeading, noteLinks, renameEdits, resolveNote } from '../core/notes';
import { slugify } from '../core/slug';
import type { NoteLink, NoteSummary } from '../core/notes';
import { setProperty } from '../core/properties';
import type { WorkspaceIndex } from './index';
import { notePath, noteUri } from './index';

const SELECTOR: vscode.DocumentSelector = { language: 'yamd' };

/** Position of an offset in a text that may not be open as a document. */
export function positionIn(text: string, offset: number): vscode.Position {
  const before = text.slice(0, offset);
  const line = before.split('\n').length - 1;
  return new vscode.Position(line, offset - (before.lastIndexOf('\n') + 1));
}

/**
 * The parse of a note if it's cheap: small, or a large one whose parsing has already been done in
 * the background. Otherwise nothing, and the background parse is started so the next request works.
 */
function cheapParse(doc: vscode.TextDocument) {
  const text = doc.getText();
  const parsed = parseIfCheap(text);
  if (!parsed) {
    const version = doc.version;
    void warmParse(text, () => doc.version === version);
  }
  return parsed;
}

/** The line of a heading or block in a note, for opening it there. */
export function anchorLine(text: string, heading?: string, blockId?: string): number | undefined {
  const doc = parse(text);
  if (blockId !== undefined) return findBlock(doc, blockId)?.line;
  if (heading !== undefined) return findHeading(doc, heading)?.line;
  return undefined;
}

export async function openAt(uri: vscode.Uri, line?: number): Promise<void> {
  const doc = await vscode.workspace.openTextDocument(uri);
  const editor = await vscode.window.showTextDocument(doc);
  if (line !== undefined) {
    const pos = new vscode.Position(line, 0);
    editor.selection = new vscode.Selection(pos, pos);
    editor.revealRange(new vscode.Range(pos, pos), vscode.TextEditorRevealType.InCenterIfOutsideViewport);
  }
}

/** The shortest target that links to `p` without ambiguity. */
function linkName(index: WorkspaceIndex, p: string, from: string): string {
  const bare = p.replace(/\.yamd$/i, '');
  const parts = bare.split('/');
  for (let i = parts.length - 1; i >= 0; i--) {
    const candidate = parts.slice(i).join('/');
    const r = resolveNote(index.store, candidate, from);
    if (r?.path === p && r.candidates.length === 0) return candidate;
  }
  return bare;
}

class Completion implements vscode.CompletionItemProvider {
  constructor(private readonly index: WorkspaceIndex) {}

  provideCompletionItems(doc: vscode.TextDocument, position: vscode.Position): vscode.CompletionItem[] {
    const before = doc.lineAt(position.line).text.slice(0, position.character);
    const from = notePath(doc.uri);
    const store = this.index.store;

    const anchor = /!?\[\[([^\]|#]*)#(\^?)([^\]|]*)$/.exec(before);
    if (anchor) {
      const [, file = '', caret = '', typed = ''] = anchor;
      const target = resolveNote(store, file, from);
      const summary = target && store.summary(target.path);
      if (!summary) return [];
      const range = new vscode.Range(position.translate(0, -typed.length - caret.length), position);
      if (caret) {
        return summary.blocks.map((b) => {
          const item = new vscode.CompletionItem(`^${b.id}`, vscode.CompletionItemKind.Reference);
          item.range = range;
          item.insertText = `^${b.id}`;
          item.detail = (store.read(target.path) ?? '').split('\n')[b.line]?.trim();
          return item;
        });
      }
      return summary.headings.map((h, i) => {
        const item = new vscode.CompletionItem(h.text, vscode.CompletionItemKind.Reference);
        item.range = range;
        item.detail = `H${h.level}`;
        item.sortText = String(i).padStart(5, '0');
        return item;
      });
    }

    const link = /!?\[\[([^\]|#]*)$/.exec(before);
    if (link) {
      const typed = link[1] ?? '';
      const range = new vscode.Range(position.translate(0, -typed.length), position);
      const items: vscode.CompletionItem[] = [];
      for (const s of store.summaries()) {
        if (s.path === from) continue;
        const name = linkName(this.index, s.path, from);
        const item = new vscode.CompletionItem({ label: name, description: s.title }, vscode.CompletionItemKind.File);
        item.range = range;
        item.insertText = name;
        item.filterText = `${name} ${s.title}`;
        item.detail = vscode.workspace.asRelativePath(noteUri(s.path));
        items.push(item);
        for (const alias of s.aliases) {
          const a = new vscode.CompletionItem({ label: alias, description: `alias of ${name}` }, vscode.CompletionItemKind.Reference);
          a.range = range;
          a.insertText = `${name}|${alias}`;
          a.filterText = alias;
          items.push(a);
        }
      }
      return items;
    }

    const tag = /(^|[\s(])#([\p{L}\p{N}_/-]*)$/u.exec(before);
    if (tag) {
      const typed = tag[2] ?? '';
      const range = new vscode.Range(position.translate(0, -typed.length), position);
      return [...store.tags()].map(([name, notes]) => {
        const item = new vscode.CompletionItem(name, vscode.CompletionItemKind.Keyword);
        item.range = range;
        item.detail = `${notes.size} note${notes.size === 1 ? '' : 's'}`;
        return item;
      });
    }
    return [];
  }
}

/** Finds the link under a position and where it points. */
function linkAt(index: WorkspaceIndex, doc: vscode.TextDocument, position: vscode.Position) {
  const offset = doc.offsetAt(position);
  // A large note that hasn't been parsed yet isn't parsed here, which would freeze the editor.
  const parsed = cheapParse(doc);
  if (!parsed) return undefined;
  const link = noteLinks(parsed).find((l) => l.range.start <= offset && offset <= l.range.end);
  if (!link) return undefined;
  return { link, target: index.store.resolveLink(link, notePath(doc.uri)) };
}

/** The line of a link's heading or block in its target note, from the index (no re-parsing). */
function targetLine(index: WorkspaceIndex, p: string, link: NoteLink): number | undefined {
  const summary = index.store.summary(p);
  if (!summary) return undefined;
  if (link.blockId !== undefined) return summary.blocks.find((b) => b.id === link.blockId)?.line;
  if (link.heading === undefined) return undefined;
  const wanted = link.heading.trim().toLowerCase();
  const slug = slugify(link.heading);
  return summary.headings.find((h) => h.id === link.heading || h.id === slug || h.text.toLowerCase() === wanted)?.line;
}

class Links implements vscode.DocumentLinkProvider, vscode.DefinitionProvider {
  constructor(private readonly index: WorkspaceIndex) {}

  provideDocumentLinks(doc: vscode.TextDocument): vscode.DocumentLink[] {
    const from = notePath(doc.uri);
    const out: vscode.DocumentLink[] = [];
    const parsed = cheapParse(doc);
    if (!parsed) return out;
    for (const link of noteLinks(parsed)) {
      const range = new vscode.Range(doc.positionAt(link.range.start), doc.positionAt(link.range.end));
      const target = this.index.store.resolveLink(link, from);
      let uri: vscode.Uri;
      if (target) {
        const line = target.path.endsWith('.yamd') ? targetLine(this.index, target.path, link) : undefined;
        uri = noteUri(target.path).with({ fragment: line !== undefined ? `L${line + 1}` : '' });
      } else if (link.kind === 'markdown') {
        continue;
      } else {
        const args = encodeURIComponent(JSON.stringify([doc.uri.toString(), link.file]));
        uri = vscode.Uri.parse(`command:yamd.createNote?${args}`);
      }
      const dl = new vscode.DocumentLink(range, uri);
      dl.tooltip = target ? `Open ${vscode.workspace.asRelativePath(noteUri(target.path))}` : `Create "${link.file}"`;
      out.push(dl);
    }
    return out;
  }

  provideDefinition(doc: vscode.TextDocument, position: vscode.Position): vscode.Location | undefined {
    const found = linkAt(this.index, doc, position);
    if (!found?.target) return undefined;
    const line = targetLine(this.index, found.target.path, found.link) ?? 0;
    return new vscode.Location(noteUri(found.target.path), new vscode.Position(line, 0));
  }
}

class Symbols implements vscode.DocumentSymbolProvider {
  provideDocumentSymbols(doc: vscode.TextDocument): vscode.DocumentSymbol[] {
    const parsed = cheapParse(doc);
    const roots: vscode.DocumentSymbol[] = [];
    if (!parsed) return roots;
    const stack: { level: number; symbol: vscode.DocumentSymbol }[] = [];
    const headings: { level: number; text: string; line: number }[] = [];
    walkBlocks(parsed.blocks, (b) => {
      if (b.type === 'heading' && !b.inBoard) headings.push({ level: b.level, text: plainText(b.children).trim() || '(untitled)', line: b.line });
    });
    headings.forEach((h, i) => {
      // A section runs to the line before the next heading of the same or higher level.
      const next = headings.slice(i + 1).find((n) => n.level <= h.level);
      const endLine = next ? next.line - 1 : doc.lineCount - 1;
      const full = new vscode.Range(h.line, 0, endLine, doc.lineAt(Math.max(endLine, h.line)).text.length);
      const symbol = new vscode.DocumentSymbol(h.text, `H${h.level}`, vscode.SymbolKind.String, full, doc.lineAt(h.line).range);
      while (stack.length && (stack[stack.length - 1] as { level: number }).level >= h.level) stack.pop();
      const parent = stack[stack.length - 1];
      if (parent) parent.symbol.children.push(symbol);
      else roots.push(symbol);
      stack.push({ level: h.level, symbol });
    });
    return roots;
  }
}

/** Updates links when notes or images are renamed, in the same undoable step as the rename. */
function onWillRename(index: WorkspaceIndex, e: vscode.FileWillRenameEvent) {
  const edit = new vscode.WorkspaceEdit();
  let any = false;
  for (const f of e.files) {
    const oldPath = notePath(f.oldUri);
    const newPath = notePath(f.newUri);
    // A folder: every indexed note inside it moves.
    const moves = index.store.paths().some((p) => p.startsWith(`${oldPath}/`))
      ? index.store.paths().filter((p) => p.startsWith(`${oldPath}/`)).map((p) => [p, newPath + p.slice(oldPath.length)] as const)
      : [[oldPath, newPath] as const];
    for (const [from, to] of moves) {
      for (const [note, edits] of renameEdits(index.store, from, to)) {
        const text = index.store.read(note) ?? '';
        for (const te of edits) {
          edit.replace(noteUri(note), new vscode.Range(positionIn(text, te.range.start), positionIn(text, te.range.end)), te.text);
          any = true;
        }
      }
    }
  }
  if (any) e.waitUntil(Promise.resolve(edit));
}

/** Creates a note named `name` next to `from` (or at the workspace root) with a title, and opens it. */
export async function createNote(fromUri: vscode.Uri | undefined, name: string): Promise<void> {
  const base = fromUri ? vscode.Uri.joinPath(fromUri, '..') : vscode.workspace.workspaceFolders?.[0]?.uri;
  if (!base) return;
  const clean = name.replace(/\.yamd$/i, '').trim();
  const uri = vscode.Uri.joinPath(base, `${clean}.yamd`);
  try {
    await vscode.workspace.fs.stat(uri);
  } catch {
    const title = path.posix.basename(clean);
    const text = `---\ntitle: ${/[:#{}[\],&*?|<>=!%@`'"]/.test(title) ? JSON.stringify(title) : title}\n---\n\n`;
    await vscode.workspace.fs.writeFile(uri, new TextEncoder().encode(text));
  }
  await openAt(uri);
}

async function quickSwitcher(index: WorkspaceIndex) {
  const pick = vscode.window.createQuickPick<vscode.QuickPickItem & { path?: string }>();
  pick.placeholder = 'Open a note by title, alias or path, or type a new name to create it';
  pick.matchOnDescription = true;
  pick.matchOnDetail = true;
  const items = index.store
    .summaries()
    .sort((a, b) => a.title.localeCompare(b.title))
    .map((s: NoteSummary) => ({
      label: s.title,
      description: vscode.workspace.asRelativePath(noteUri(s.path)),
      detail: s.aliases.length ? `Aliases: ${s.aliases.join(', ')}` : undefined,
      path: s.path,
    }));
  pick.items = items;
  pick.onDidChangeValue((value) => {
    const exists = items.some((i) => i.label.toLowerCase() === value.trim().toLowerCase());
    pick.items = value.trim() && !exists ? [...items, { label: `$(new-file) Create "${value.trim()}"`, alwaysShow: true }] : items;
  });
  pick.onDidAccept(async () => {
    const chosen = pick.selectedItems[0];
    const value = pick.value.trim();
    pick.hide();
    if (chosen?.path) await openAt(noteUri(chosen.path));
    else if (value) await createNote(vscode.window.activeTextEditor?.document.uri, value);
  });
  pick.onDidHide(() => pick.dispose());
  pick.show();
}

/** Turns an unlinked mention into a wikilink. */
async function linkMention(index: WorkspaceIndex, args: { from: string; start: number; end: number; target: string }) {
  const text = index.store.read(args.from);
  if (text === undefined) return;
  const mention = text.slice(args.start, args.end);
  const name = linkName(index, args.target, args.from);
  const label = mention.toLowerCase() === path.posix.basename(name).toLowerCase() ? '' : `|${mention}`;
  const edit = new vscode.WorkspaceEdit();
  edit.replace(noteUri(args.from), new vscode.Range(positionIn(text, args.start), positionIn(text, args.end)), `[[${name}${label}]]`);
  await vscode.workspace.applyEdit(edit);
}

/** Applies a front matter change to a document as one undoable edit. */
export async function editProperty(doc: vscode.TextDocument, key: string, value: unknown): Promise<boolean> {
  const change = setProperty(doc.getText(), key, value);
  if (!change) return false;
  const edit = new vscode.WorkspaceEdit();
  if (change.endLine < change.startLine) {
    edit.insert(doc.uri, new vscode.Position(0, 0), `${change.text}\n`);
  } else {
    const end = doc.lineAt(change.endLine).range.end;
    edit.replace(doc.uri, new vscode.Range(change.startLine, 0, end.line, end.character), change.text);
  }
  return vscode.workspace.applyEdit(edit);
}

export function registerNoteFeatures(context: vscode.ExtensionContext, index: WorkspaceIndex): void {
  const links = new Links(index);
  context.subscriptions.push(
    vscode.languages.registerCompletionItemProvider(SELECTOR, new Completion(index), '[', '#', '^'),
    vscode.languages.registerDocumentLinkProvider(SELECTOR, links),
    vscode.languages.registerDefinitionProvider(SELECTOR, links),
    vscode.languages.registerDocumentSymbolProvider(SELECTOR, new Symbols()),
    vscode.workspace.onWillRenameFiles((e) => onWillRename(index, e)),
    vscode.commands.registerCommand('yamd.quickSwitcher', () => quickSwitcher(index)),
    vscode.commands.registerCommand('yamd.createNote', (from?: string, name?: string) =>
      name ? createNote(from ? vscode.Uri.parse(from) : undefined, name) : undefined,
    ),
    vscode.commands.registerCommand('yamd.linkMention', (args) => linkMention(index, args)),
  );
}

