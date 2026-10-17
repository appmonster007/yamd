import * as vscode from 'vscode';
import { parse } from '../core';
import type { Card } from '../core/study/cards';
import { extractCards } from '../core/study/cards';
import type { WorkspaceIndex } from '../workspace/index';
import { noteUri } from '../workspace/index';

const enc = new TextEncoder();
const dec = new TextDecoder();

export function todayIso(now = new Date()): string {
  const p = (n: number) => String(n).padStart(2, '0');
  return `${now.getFullYear()}-${p(now.getMonth() + 1)}-${p(now.getDate())}`;
}

export function workspaceRoot(): vscode.Uri | undefined {
  const active = vscode.window.activeTextEditor?.document.uri;
  return (active && vscode.workspace.getWorkspaceFolder(active)?.uri) ?? vscode.workspace.workspaceFolders?.[0]?.uri;
}

/** Study data lives in `.yamd/` at the workspace root, so it can be committed and shared. */
export async function readData(name: string): Promise<string | undefined> {
  const root = workspaceRoot();
  if (!root) return undefined;
  try {
    return dec.decode(await vscode.workspace.fs.readFile(vscode.Uri.joinPath(root, '.yamd', name)));
  } catch {
    return undefined;
  }
}

export async function writeData(name: string, text: string): Promise<void> {
  const root = workspaceRoot();
  if (!root) return;
  const dir = vscode.Uri.joinPath(root, '.yamd');
  await vscode.workspace.fs.createDirectory(dir);
  await vscode.workspace.fs.writeFile(vscode.Uri.joinPath(dir, name), enc.encode(text));
}

export async function exists(uri: vscode.Uri): Promise<boolean> {
  try {
    await vscode.workspace.fs.stat(uri);
    return true;
  } catch {
    return false;
  }
}

export function requireFolder(): vscode.Uri | undefined {
  const root = workspaceRoot();
  if (!root) void vscode.window.showInformationMessage('YAMD: Open a folder first.');
  return root;
}

const CARD_HINT = /:::\s*card|::card\[|:cloze\[/;

/** Every card in the workspace's notes. Only notes that mention cards are parsed. */
export function collectCards(index: WorkspaceIndex): Card[] {
  const cards: Card[] = [];
  for (const path of index.store.paths().sort()) {
    const text = index.store.read(path);
    if (!text || !CARD_HINT.test(text)) continue;
    cards.push(...extractCards(parse(text), path).cards);
  }
  return cards;
}

export async function openAt(path: string, line = 0): Promise<void> {
  const doc = await vscode.workspace.openTextDocument(noteUri(path));
  const editor = await vscode.window.showTextDocument(doc);
  const pos = new vscode.Position(Math.min(line, doc.lineCount - 1), 0);
  editor.selection = new vscode.Selection(pos, pos);
  editor.revealRange(new vscode.Range(pos, pos), vscode.TextEditorRevealType.InCenter);
}
