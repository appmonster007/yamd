import * as path from 'node:path';
import * as vscode from 'vscode';
import { cardNodes, dataFileNodes, mentionNodes, outlineNodes, studyNodes, widgetNodes } from '../../core/sidebar/nodes';
import type { SidebarNode } from '../../core/sidebar/nodes';
import { wikilinkFor } from '../../core/notes/mentions';
import { gather } from '../../study/dashboard';
import { loadSchedule } from '../../study/review';
import type { StudyIndex } from '../../study/studyIndex';
import { collectCards, todayIso } from '../../study/workspace';
import { linesOf } from '../widgets/widgets';
import { NodeTree } from './nodeTree';

const baseName = (p: string) => path.basename(p).replace(/\.md$/i, '');

function activeMarkdown(): vscode.TextDocument | undefined {
  const doc = vscode.window.activeTextEditor?.document;
  return doc?.languageId === 'markdown' ? doc : undefined;
}

/** The YAMD sidebar: widgets and structure of the open note, flashcards, study progress and data files. */
export function registerSidebarViews(context: vscode.ExtensionContext, index: StudyIndex): void {
  // Views about the open note follow the active editor and its text.
  const here = (n: SidebarNode): vscode.Command | undefined => {
    const doc = activeMarkdown();
    if (n.line === undefined) return undefined;
    if (n.path) return { command: 'yamd.openAt', title: 'Open', arguments: [n.path, n.line] };
    if (!doc) return undefined;
    return n.widget ? { command: 'yamd.openWidget', title: 'Open', arguments: [doc.uri, n.line] } : { command: 'yamd.openAt', title: 'Reveal', arguments: [doc.uri.fsPath, n.line] };
  };
  const widgets = new NodeTree(() => {
    const doc = activeMarkdown();
    return doc ? widgetNodes(linesOf(doc)) : [];
  }, here);
  const outline = new NodeTree(() => {
    const doc = activeMarkdown();
    return doc ? outlineNodes(linesOf(doc)) : [];
  }, here);

  const mentions = new NodeTree(async () => {
    const doc = activeMarkdown();
    if (!doc || doc.uri.scheme !== 'file') return [];
    await index.whenReady();
    const notes = index.store.paths().map((p) => ({ path: p, text: index.store.read(p) ?? '' }));
    return mentionNodes(doc.uri.fsPath, linesOf(doc), notes, baseName);
  }, (n) => (n.path ? { command: 'yamd.openAt', title: 'Open', arguments: [n.path, n.line ?? 0] } : undefined));

  const cards = new NodeTree(
    async () => {
      await index.whenReady();
      const limit = vscode.workspace.getConfiguration('yamd.study').get<number>('newCardsPerDay', 20);
      return cardNodes(collectCards(index), await loadSchedule(), todayIso(), limit);
    },
    (n) => (n.review !== undefined ? { command: 'yamd.reviewCards', title: 'Review', arguments: [n.review || undefined] } : undefined),
  );

  const study = new NodeTree(
    async () => {
      await index.whenReady();
      const notes = index.store.paths().map((p) => ({ path: p, lines: (index.store.read(p) ?? '').split('\n') }));
      const files = dataFileNodes(notes, (note, source) => path.resolve(path.dirname(note), source), baseNameWithExt);
      return [...studyNodes(await gather(index)), ...(files.length ? [{ label: `Data files (${files.length})`, icon: 'database', children: files }] : [])];
    },
    (n) => (n.path ? { command: 'yamd.openAt', title: 'Open', arguments: [n.path, n.line ?? 0] } : undefined),
  );

  const refreshNote = () => {
    widgets.refresh();
    outline.refresh();
    mentions.refresh(600);
  };
  context.subscriptions.push(
    widgets,
    outline,
    mentions,
    cards,
    study,
    vscode.window.registerTreeDataProvider('yamd.widgets', widgets),
    vscode.window.registerTreeDataProvider('yamd.outline', outline),
    vscode.window.registerTreeDataProvider('yamd.mentions', mentions),
    vscode.window.registerTreeDataProvider('yamd.cards', cards),
    vscode.commands.registerCommand('yamd.linkMention', async (n?: SidebarNode) => {
      const m = n?.mention;
      if (!m) return;
      const doc = await vscode.workspace.openTextDocument(vscode.Uri.file(m.path));
      const range = new vscode.Range(m.line, m.col, m.line, m.col + m.length);
      // The note may have changed since the list was made.
      if (doc.getText(range) !== m.text) {
        void vscode.window.showInformationMessage('YAMD: That line changed. The list will refresh.');
        mentions.refresh(0);
        return;
      }
      const edit = new vscode.WorkspaceEdit();
      edit.replace(doc.uri, range, wikilinkFor(m.target, m.text));
      await vscode.workspace.applyEdit(edit);
      mentions.refresh(300);
    }),
    vscode.window.registerTreeDataProvider('yamd.study', study),
    vscode.window.onDidChangeActiveTextEditor(refreshNote),
    vscode.workspace.onDidChangeTextDocument((e) => {
      if (e.document === activeMarkdown()) refreshNote();
    }),
    index.onDidChange(() => {
      mentions.refresh(800);
      cards.refresh(800);
      study.refresh(800);
    }),
  );
}

function baseNameWithExt(p: string): string {
  return /\.md$/i.test(p) ? baseName(p) : path.basename(p);
}
