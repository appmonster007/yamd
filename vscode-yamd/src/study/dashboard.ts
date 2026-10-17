import { statSync } from 'node:fs';
import * as path from 'node:path';
import * as vscode from 'vscode';
import { parse } from '../core';
import { buildQueue } from '../core/study/cards';
import { DASHBOARD_CSS, dashboardBody } from '../core/study/dashboard';
import type { DashboardData } from '../core/study/dashboard';
import type { Deadline, NoteProgress } from '../core/study/deadlines';
import { collectDeadlines, courseOf, courseProgress, groupDeadlines, isoDate, staleTopics } from '../core/study/deadlines';
import { heatmap, minutesByCourse, minutesByDay, streak } from '../core/study/studylog';
import { addDays } from '../core/study/cards';
import { nonce } from '../extension/webviewShell';
import type { WorkspaceIndex } from '../workspace/index';
import { loadSchedule } from './review';
import { loadLog } from './timer';
import { collectCards, openAt, todayIso } from './workspace';

/** Everything the dashboard shows, gathered from the notes and the `.yamd/` data files. */
export async function gather(index: WorkspaceIndex): Promise<DashboardData> {
  await index.whenReady();
  const today = todayIso();
  const staleDays = vscode.workspace.getConfiguration('yamd.study').get<number>('staleAfterDays', 14);
  const deadlines: Deadline[] = [];
  const progress: NoteProgress[] = [];
  for (const summary of index.store.summaries()) {
    const text = index.store.read(summary.path);
    if (text && /\bdue\b/.test(text)) deadlines.push(...collectDeadlines(parse(text), summary.path, summary.title));
    const course = courseOf(summary.properties);
    let lastTouched = isoDate(summary.properties['reviewed']);
    if (!lastTouched && course) {
      try {
        lastTouched = todayIso(new Date(statSync(summary.path).mtimeMs));
      } catch {
        // The file went away; the note is left out of the stale list.
      }
    }
    progress.push({
      path: summary.path,
      title: summary.title,
      ...(course ? { course } : {}),
      tasksDone: summary.tasks.filter((t) => t.done).length,
      tasksTotal: summary.tasks.length,
      ...(lastTouched ? { lastTouched } : {}),
    });
  }
  const cards = collectCards(index);
  const queue = buildQueue(cards, await loadSchedule(), today, 20);
  const log = await loadLog();
  const week = [...minutesByDay(log)].filter(([d]) => d > addDays(today, -7)).reduce((n, [, m]) => n + m, 0);
  return {
    today,
    agenda: groupDeadlines(deadlines, today),
    courses: courseProgress(progress.filter((p) => p.tasksTotal > 0 || p.course)),
    stale: staleTopics(progress, today, staleDays),
    staleDays,
    cards: { due: queue.due.length, fresh: queue.fresh.length, later: queue.later },
    study: {
      weekMinutes: week,
      totalMinutes: log.sessions.reduce((n, s) => n + s.minutes, 0),
      streak: streak(log, today),
      byCourse: [...minutesByCourse(log, addDays(today, -30))].sort((a, b) => b[1] - a[1]),
      heatmap: heatmap(log, today),
    },
    label: (p) => path.basename(p, '.yamd'),
  };
}

export class DashboardPanel implements vscode.Disposable {
  private panel: vscode.WebviewPanel | undefined;
  private timer: ReturnType<typeof setTimeout> | undefined;
  private readonly sub: vscode.Disposable;

  constructor(private readonly index: WorkspaceIndex) {
    this.sub = index.onDidChange(() => this.schedule());
  }

  async show(): Promise<void> {
    if (this.panel) this.panel.reveal();
    else {
      this.panel = vscode.window.createWebviewPanel('yamd.dashboard', 'Study dashboard', vscode.ViewColumn.Active, { enableScripts: true });
      this.panel.onDidDispose(() => (this.panel = undefined));
      this.panel.webview.onDidReceiveMessage((m: { type: string; path?: string; line?: number; command?: string }) => {
        if (m.type === 'open' && m.path) void openAt(m.path, m.line);
        else if (m.type === 'command' && m.command && /^yamd\.(reviewCards|startStudyTimer)$/.test(m.command)) void vscode.commands.executeCommand(m.command);
      });
    }
    await this.refresh();
  }

  private schedule() {
    clearTimeout(this.timer);
    if (this.panel) this.timer = setTimeout(() => void this.refresh(), 1500);
  }

  async refresh(): Promise<void> {
    if (!this.panel) return;
    const body = dashboardBody(await gather(this.index));
    const n = nonce();
    this.panel.webview.html = `<!DOCTYPE html><html lang="en"><head><meta charset="UTF-8"><meta http-equiv="Content-Security-Policy" content="default-src 'none'; style-src 'unsafe-inline'; script-src 'nonce-${n}'"><style>${DASHBOARD_CSS}</style></head><body>${body}
<script nonce="${n}">const v = acquireVsCodeApi(); document.addEventListener('click', (e) => { const b = e.target.closest('button'); if (!b) return; if (b.dataset.open) v.postMessage({ type: 'open', path: b.dataset.open, line: Number(b.dataset.line) }); else if (b.dataset.command) v.postMessage({ type: 'command', command: b.dataset.command }); });</script></body></html>`;
  }

  dispose() {
    clearTimeout(this.timer);
    this.sub.dispose();
    this.panel?.dispose();
  }
}
