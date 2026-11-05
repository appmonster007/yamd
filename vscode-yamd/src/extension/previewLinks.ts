import * as path from 'node:path';
import { existsSync } from 'node:fs';
import * as vscode from 'vscode';
import { parse, sanitizeUrl } from '../core';
import { resolveNote, splitTarget, stripNoteExt } from '../core/notes';
import { anchorLine, createNote } from '../workspace/features';
import type { WorkspaceIndex } from '../workspace/index';
import { notePath, noteUri } from '../workspace/index';
import { fileResolver } from './diagnostics';

export const YAMD_EDITOR = 'yamd.editor';

/** Lines to scroll to when a note's preview next opens, keyed by URI. Carries the position across Source/Preview switches and link jumps. */
export const pendingLines = new Map<string, number>();
/** Where a preview of each note was last scrolled to (by source line), so switching to Source can land there. */
export const lastLines = new Map<string, number>();
/** Ignore echoes of a scroll we just sent the other side (ms). */
export const SYNC_QUIET_MS = 200;

export interface LinkContext {
  doc: vscode.TextDocument;
  index: WorkspaceIndex | undefined;
  /** True when the preview is a note's own editor tab, so navigation should stay in preview mode. */
  inEditorTab: boolean;
  column: vscode.ViewColumn | undefined;
}

/** Follows a link clicked in a preview: opens the web page, resolves the note, or offers to create it. */
export async function openPreviewLink(ctx: LinkContext, m: { href: string; source?: string }): Promise<void> {
  const { doc, index } = ctx;
  const href = sanitizeUrl(m.href);
  if (!href) return;
  if (/^(https?|mailto|tel):/i.test(href)) {
    await vscode.env.openExternal(vscode.Uri.parse(href));
    return;
  }
  const [target = '', fragment] = href.split('#');
  const decoded = decodeURIComponent(target);
  // Links inside an embed are relative to the embedded note.
  const from = m.source ?? (doc.uri.scheme === 'file' ? notePath(doc.uri) : undefined);
  let file = m.source
    ? [path.resolve(path.dirname(m.source), decoded)].find((c) => existsSync(c))
    : fileResolver(doc)?.(decoded);
  if (!file && index && from) {
    // Wikilinks resolve by name and alias anywhere in the workspace.
    const r = resolveNote(index.store, stripNoteExt(decoded), from);
    if (r && r.candidates.length > 1) {
      // Ambiguous: never auto-pick (the shortest path could silently change later as notes are
      // added or removed), so ask which one was meant instead of guessing.
      const picked = await vscode.window.showQuickPick(r.candidates, { placeHolder: `"${decoded}" matches more than one note — which one?` });
      file = picked;
    } else {
      file = r?.path;
    }
  }
  if (!file) {
    const name = stripNoteExt(splitTarget(decoded).file);
    const choice = await vscode.window.showInformationMessage(`YAMD: "${name}" does not exist. Create it?`, 'Create Note');
    if (choice) await createNote(from ? noteUri(from) : doc.uri, name);
    return;
  }
  const opened = await vscode.workspace.openTextDocument(vscode.Uri.file(file));
  const id = fragment ? decodeURIComponent(fragment) : undefined;
  const targetLine =
    id && opened.languageId === 'yamd' ? (id.startsWith('^') ? anchorLine(opened.getText(), undefined, id.slice(1)) : findIdLine(opened.getText(), id)) : undefined;
  // From a note's own preview tab, stay in preview mode.
  if (ctx.inEditorTab && opened.languageId === 'yamd') {
    if (targetLine !== undefined) pendingLines.set(opened.uri.toString(), targetLine);
    await vscode.commands.executeCommand('vscode.openWith', opened.uri, YAMD_EDITOR, ctx.column ?? vscode.ViewColumn.One);
    return;
  }
  const editor = await vscode.window.showTextDocument(opened, vscode.ViewColumn.One);
  {
    const line = targetLine;
    if (line !== undefined) {
      const pos = new vscode.Position(line, 0);
      editor.selection = new vscode.Selection(pos, pos);
      editor.revealRange(new vscode.Range(pos, pos), vscode.TextEditorRevealType.AtTop);
    }
  }
}

/** Finds the line of the heading or block with the given id. */
function findIdLine(source: string, id: string): number | undefined {
  const doc = parse(source);
  let found: number | undefined;
  const visit = (blocks: typeof doc.blocks) => {
    for (const b of blocks) {
      if (found !== undefined) return;
      if ((b.type === 'heading' && b.id === id) || b.attrs?.id === id) found = b.line;
      if (b.type === 'list') b.items.forEach((it) => visit(it.children));
      else if (b.type === 'blockquote' || b.type === 'container') visit(b.children);
    }
  };
  visit(doc.blocks);
  return found;
}
