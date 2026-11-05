import * as path from 'node:path';
import { existsSync } from 'node:fs';
import * as vscode from 'vscode';
import { scanWidgets } from '../core/fences';
import type { WidgetBlock } from '../core/fences';

export const MARKDOWN = { language: 'markdown' } as const;

export function linesOf(doc: vscode.TextDocument): string[] {
  const lines: string[] = [];
  for (let i = 0; i < doc.lineCount; i++) lines.push(doc.lineAt(i).text);
  return lines;
}

export function widgetsOf(doc: vscode.TextDocument): WidgetBlock[] {
  return scanWidgets(linesOf(doc));
}

/** Finds a note's file next to it, or from the workspace root; undefined if missing. */
export function fileResolver(doc: vscode.TextDocument): ((p: string) => string | undefined) | undefined {
  if (doc.uri.scheme !== 'file') return undefined;
  const dir = path.dirname(doc.uri.fsPath);
  const root = vscode.workspace.getWorkspaceFolder(doc.uri)?.uri.fsPath;
  return (p: string) => {
    const candidates = p.startsWith('/') ? [root ? path.join(root, p) : p] : [path.resolve(dir, p), ...(root ? [path.resolve(root, p)] : [])];
    return candidates.find((c) => existsSync(c));
  };
}
