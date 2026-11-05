import * as path from 'node:path';
import * as vscode from 'vscode';
import { toInternal } from '../core/markdown/compat';
import { parse } from '../core/markdown';
import { collectDeadlines, groupDeadlines } from '../core/study/deadlines';
import type { Deadline } from '../core/study/deadlines';
import { reminderMessage, shouldRemind } from '../core/study/reminders';
import { buildQueue, parseSchedule } from '../core/study/cards';
import { STUDY_TEMPLATES } from '../core/study/templates';
import { pruneSchedule } from '../core/study/cards';
import { stringifySchedule } from '../core/study/cards';
import { chooseFolder, createNote } from '../extension/shared/files';
import type { DashboardPanel } from './dashboard';
import type { ReviewPanel } from './review';
import { loadSchedule } from './review';
import type { StudyIndex } from './studyIndex';
import type { StudyTimer } from './timer';
import { collectCards, openAt, requireFolder, todayIso, writeData } from './workspace';

async function newStudyNote(clicked?: vscode.Uri): Promise<void> {
  const pick = await vscode.window.showQuickPick(
    STUDY_TEMPLATES.map((t) => ({ label: t.label, description: t.description, id: t.id })),
    { placeHolder: 'Choose a study note template' },
  );
  if (!pick) return;
  const template = STUDY_TEMPLATES.find((t) => t.id === pick.id)!;
  const title = await vscode.window.showInputBox({ prompt: 'Note title', placeHolder: 'Lecture 1' });
  if (title === undefined) return;
  const course = (await vscode.window.showInputBox({ prompt: 'Course (optional)', placeHolder: 'CS101' })) ?? '';
  const folder = await chooseFolder(clicked);
  if (!folder) return;
  await createNote(folder, title || template.label, template, { course });
}

function courses(index: StudyIndex): string[] {
  return [...new Set(index.store.summaries().map((s) => (typeof s.properties['course'] === 'string' ? (s.properties['course'] as string) : undefined)).filter((c): c is string => !!c))].sort();
}

/** The Deadlines list in the YAMD sidebar: due dates collected from every note's tasks, grouped by day. */
interface Node {
  label: string;
  deadline?: Deadline;
  children?: Deadline[];
}

class DeadlinesView implements vscode.TreeDataProvider<Node>, vscode.Disposable {
  private readonly changed = new vscode.EventEmitter<void>();
  readonly onDidChangeTreeData = this.changed.event;
  private readonly sub: vscode.Disposable;

  constructor(private readonly index: StudyIndex) {
    this.sub = index.onDidChange(() => this.changed.fire());
  }

  private agenda() {
    const items: Deadline[] = [];
    for (const s of this.index.store.summaries()) {
      const text = this.index.store.read(s.path);
      if (text && /\bdue\b/.test(text)) items.push(...collectDeadlines(parse(toInternal(text)), s.path, s.title));
    }
    return groupDeadlines(items, todayIso());
  }

  getTreeItem(el: Node): vscode.TreeItem {
    const item = new vscode.TreeItem(el.label, el.children ? vscode.TreeItemCollapsibleState.Expanded : vscode.TreeItemCollapsibleState.None);
    if (el.deadline) {
      item.description = `${el.deadline.due} · ${path.basename(el.deadline.path).replace(/\.md$/i, '')}`;
      item.command = { command: 'yamd.openAt', title: 'Open', arguments: [el.deadline.path, el.deadline.line] };
    }
    return item;
  }

  getChildren(el?: Node): Node[] {
    if (el) return (el.children ?? []).map((d): Node => ({ label: d.title, deadline: d }));
    const a = this.agenda();
    const groups: Node[] = [
      { label: `Overdue (${a.overdue.length})`, children: a.overdue },
      { label: `Today (${a.today.length})`, children: a.today },
      { label: `This week (${a.week.length})`, children: a.week },
      { label: `Later (${a.later.length})`, children: a.later },
    ];
    return groups.filter((g) => g.children?.length);
  }

  dispose() {
    this.sub.dispose();
    this.changed.dispose();
  }
}

/** Once a day, tells the user about cards to review and deadlines that are today or overdue. */
async function remind(context: vscode.ExtensionContext, index: StudyIndex): Promise<void> {
  if (!vscode.workspace.getConfiguration('yamd.study').get<boolean>('reminders', true) || !vscode.workspace.workspaceFolders?.length) return;
  const today = todayIso();
  if (!shouldRemind(context.workspaceState.get<string>('yamd.reminded'), today)) return;
  await index.whenReady();
  const schedule = await loadSchedule();
  const cards = collectCards(index);
  const queue = buildQueue(cards, schedule, today, 0);
  const items: Deadline[] = [];
  for (const s of index.store.summaries()) {
    const text = index.store.read(s.path);
    if (text && /\bdue\b/.test(text)) items.push(...collectDeadlines(parse(toInternal(text)), s.path, s.title));
  }
  const agenda = groupDeadlines(items.filter((d) => !d.done), today);
  const message = reminderMessage({ dueCards: queue.due.length, overdue: agenda.overdue.length, dueToday: agenda.today.length });
  if (!message) return;
  await context.workspaceState.update('yamd.reminded', today);
  const actions = [...(queue.due.length ? ['Review Cards'] : []), ...(agenda.overdue.length + agenda.today.length ? ['Show Deadlines'] : [])];
  const choice = await vscode.window.showInformationMessage(message, ...actions);
  if (choice === 'Review Cards') void vscode.commands.executeCommand('yamd.reviewCards');
  else if (choice === 'Show Deadlines') void vscode.commands.executeCommand('yamd.deadlines.focus');
}

export function registerStudy(context: vscode.ExtensionContext, index: StudyIndex, review: ReviewPanel, dashboard: DashboardPanel, timer: StudyTimer): void {
  const deadlines = new DeadlinesView(index);
  setTimeout(() => void remind(context, index), 4000);
  context.subscriptions.push(
    deadlines,
    vscode.window.registerTreeDataProvider('yamd.deadlines', deadlines),
    vscode.commands.registerCommand('yamd.openAt', (file: string, line: number) => openAt(file, line)),
    vscode.commands.registerCommand('yamd.reviewCards', (course?: unknown) => review.show(typeof course === 'string' && course ? course : undefined)),
    vscode.commands.registerCommand('yamd.openDashboard', () => dashboard.show()),
    vscode.commands.registerCommand('yamd.startStudyTimer', async () => {
      const list = courses(index);
      const course = list.length ? await vscode.window.showQuickPick(['(no course)', ...list], { placeHolder: 'Study session for…' }) : undefined;
      if (course === undefined && list.length) return;
      await timer.start(course && course !== '(no course)' ? course : undefined);
    }),
    vscode.commands.registerCommand('yamd.pauseStudyTimer', () => timer.pause()),
    vscode.commands.registerCommand('yamd.stopStudyTimer', () => timer.finish()),
    vscode.commands.registerCommand('yamd.studyTimerMenu', () => timer.menu(courses(index))),
    vscode.commands.registerCommand('yamd.newStudyNote', (uri?: vscode.Uri) => newStudyNote(uri)),
    vscode.commands.registerCommand('yamd.pruneCards', async () => {
      if (!requireFolder()) return;
      await index.whenReady();
      const live = new Set(collectCards(index).map((c) => c.id));
      const schedule = await loadSchedule();
      const before = Object.keys(schedule.cards).length;
      const kept = pruneSchedule(schedule, live);
      await writeData('srs.json', stringifySchedule(kept));
      void vscode.window.showInformationMessage(`YAMD: Removed the schedule of ${before - Object.keys(kept.cards).length} deleted cards.`);
    }),
  );
}
