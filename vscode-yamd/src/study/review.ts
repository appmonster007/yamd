import * as path from 'node:path';
import * as vscode from 'vscode';
import { parse, render } from '../core';
import { stripNoteExt } from '../core/notes';
import type { Card, Grade, Schedule } from '../core/study/cards';
import { buildQueue, parseSchedule, previewIntervals, pruneSchedule, review, stringifySchedule } from '../core/study/cards';
import { nonce } from '../extension/webviewShell';
import { highlight, renderMath } from '../extension/richLoader';
import type { WorkspaceIndex } from '../workspace/index';
import { collectCards, openAt, readData, requireFolder, todayIso, writeData } from './workspace';

const FILE = 'srs.json';

export async function loadSchedule(): Promise<Schedule> {
  return parseSchedule(await readData(FILE));
}

/** The flashcard review session. */
export class ReviewPanel implements vscode.Disposable {
  private panel: vscode.WebviewPanel | undefined;
  private schedule: Schedule = { version: 1, cards: {} };
  private saving: Promise<void> = Promise.resolve();

  constructor(
    private readonly extensionUri: vscode.Uri,
    private readonly index: WorkspaceIndex,
  ) {}

  async show(course?: string): Promise<void> {
    if (!requireFolder()) return;
    await this.index.whenReady();
    const cards = collectCards(this.index);
    this.schedule = await loadSchedule();
    const today = todayIso();
    const limit = vscode.workspace.getConfiguration('yamd.study').get<number>('newCardsPerDay', 20);
    const queue = buildQueue(cards, this.schedule, today, limit, course);
    if (!queue.due.length && !queue.fresh.length) {
      void vscode.window.showInformationMessage(cards.length ? `YAMD: No cards are due. ${queue.later} are scheduled for later.` : 'YAMD: No cards found. Add ::card[Question]{a="Answer"} or :cloze[hidden text] to a note.');
      return;
    }
    const items = [...queue.due, ...queue.fresh].map((c) => this.item(c, today));
    if (!this.panel) {
      this.panel = vscode.window.createWebviewPanel('yamd.review', 'Review cards', vscode.ViewColumn.Active, {
        enableScripts: true,
        localResourceRoots: [vscode.Uri.joinPath(this.extensionUri, 'dist'), vscode.Uri.joinPath(this.extensionUri, 'media')],
      });
      this.panel.onDidDispose(() => (this.panel = undefined));
      this.panel.webview.onDidReceiveMessage((m: { type: string; id?: string; grade?: Grade; path?: string; line?: number }) => {
        if (m.type === 'ready') void this.panel?.webview.postMessage({ type: 'queue', items });
        else if (m.type === 'grade' && m.id && m.grade) this.grade(m.id, m.grade);
        else if (m.type === 'open' && m.path) void openAt(m.path, m.line);
      });
      this.panel.webview.html = this.html(this.panel.webview);
    } else {
      this.panel.reveal();
      void this.panel.webview.postMessage({ type: 'queue', items });
    }
  }

  private item(c: Card, today: string) {
    const html = (src: string) => render(parse(src), { highlight, renderMath });
    return {
      id: c.id,
      front: html(c.front),
      back: html(c.back),
      intervals: previewIntervals(this.schedule.cards[c.id], today),
      path: c.path,
      line: c.line,
      title: stripNoteExt(path.basename(c.path)),
    };
  }

  private grade(id: string, grade: Grade) {
    this.schedule.cards[id] = review(this.schedule.cards[id], grade, todayIso());
    // Writes are chained so quick answers can't overwrite each other.
    this.saving = this.saving.then(() => writeData(FILE, stringifySchedule(this.schedule)));
  }

  /** Forgets schedules of cards that were deleted from the notes. */
  async prune(): Promise<void> {
    const live = new Set(collectCards(this.index).map((c) => c.id));
    const before = Object.keys(this.schedule.cards).length;
    this.schedule = pruneSchedule(await loadSchedule(), live);
    await writeData(FILE, stringifySchedule(this.schedule));
    void vscode.window.showInformationMessage(`YAMD: Removed the schedule of ${before - Object.keys(this.schedule.cards).length} deleted cards.`);
  }

  private html(webview: vscode.Webview): string {
    const n = nonce();
    const uri = (...p: string[]) => webview.asWebviewUri(vscode.Uri.joinPath(this.extensionUri, ...p));
    const csp = `default-src 'none'; img-src ${webview.cspSource} https: data:; style-src ${webview.cspSource} 'unsafe-inline'; font-src ${webview.cspSource}; script-src 'nonce-${n}'`;
    return `<!DOCTYPE html><html lang="en"><head><meta charset="UTF-8"><meta http-equiv="Content-Security-Policy" content="${csp}">
<link rel="stylesheet" href="${uri('dist', 'katex', 'katex.min.css')}"><link rel="stylesheet" href="${uri('media', 'preview.css')}"><link rel="stylesheet" href="${uri('media', 'review.css')}"></head>
<body><main id="root"></main><script nonce="${n}" src="${uri('dist', 'review.js')}"></script></body></html>`;
  }

  dispose() {
    this.panel?.dispose();
  }
}
