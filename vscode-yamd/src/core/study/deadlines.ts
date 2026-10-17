/**
 * Courses, deadlines and progress (§6.5). Notes name a `course` and a `due` date in their front
 * matter; tasks and kanban cards carry `{due=…}`. These functions gather and group them.
 */
import { attrString } from '../attrs';
import { plainText } from '../inline';
import { walkBlocks } from '../parser';
import type { YamdDocument } from '../types';
import { addDays, daysBetween } from './cards';

export interface Deadline {
  path: string;
  /** 0-based line of the task or card; 0 for a note's own due date. */
  line: number;
  title: string;
  /** `YYYY-MM-DD`. */
  due: string;
  done: boolean;
  course?: string;
  kind: 'note' | 'task';
}

const ISO = /^\d{4}-\d{2}-\d{2}/;

/** A front matter or attribute value as `YYYY-MM-DD`, or undefined. */
export function isoDate(value: unknown): string | undefined {
  if (value instanceof Date) return Number.isNaN(value.getTime()) ? undefined : value.toISOString().slice(0, 10);
  if (typeof value === 'string' && ISO.test(value.trim())) return value.trim().slice(0, 10);
  return undefined;
}

const DONE_STATUS = /^(done|complete|completed|submitted|finished)$/i;

export function courseOf(properties: Record<string, unknown>): string | undefined {
  const c = properties['course'];
  return typeof c === 'string' && c.trim() ? c.trim() : undefined;
}

export function collectDeadlines(doc: YamdDocument, path: string, noteTitle: string): Deadline[] {
  const fm = doc.frontMatter?.data ?? {};
  const course = courseOf(fm);
  const out: Deadline[] = [];
  const noteDue = isoDate(fm['due']);
  if (noteDue) {
    const status = fm['status'];
    out.push({ path, line: 0, title: noteTitle, due: noteDue, done: fm['done'] === true || (typeof status === 'string' && DONE_STATUS.test(status)), course, kind: 'note' });
  }
  walkBlocks(doc.blocks, (b) => {
    if (b.type !== 'list') return;
    for (const item of b.items) {
      const due = isoDate(attrString(item.attrs, 'due'));
      if (!due) continue;
      const first = item.children[0];
      let title = '';
      if (first?.type === 'paragraph') {
        const br = first.children.findIndex((n) => n.type === 'break');
        title = plainText(br === -1 ? first.children : first.children.slice(0, br)).replace(/(^|\s)#\S+/g, '').trim();
      }
      out.push({ path, line: item.line, title: title || '(untitled)', due, done: item.task === 'done', course, kind: 'task' });
    }
  });
  return out;
}

export interface Agenda {
  overdue: Deadline[];
  today: Deadline[];
  /** Within the next 7 days. */
  week: Deadline[];
  later: Deadline[];
  done: Deadline[];
}

export function groupDeadlines(items: Deadline[], today: string): Agenda {
  const agenda: Agenda = { overdue: [], today: [], week: [], later: [], done: [] };
  for (const d of [...items].sort((a, b) => a.due.localeCompare(b.due) || a.title.localeCompare(b.title))) {
    if (d.done) agenda.done.push(d);
    else if (d.due < today) agenda.overdue.push(d);
    else if (d.due === today) agenda.today.push(d);
    else if (d.due <= addDays(today, 7)) agenda.week.push(d);
    else agenda.later.push(d);
  }
  return agenda;
}

/** "today", "tomorrow", "in 3 days", "2 days ago". */
export function relativeDay(due: string, today: string): string {
  const n = daysBetween(today, due);
  if (n === 0) return 'today';
  if (n === 1) return 'tomorrow';
  if (n === -1) return 'yesterday';
  return n > 0 ? `in ${n} days` : `${-n} days ago`;
}

// ---- Progress ----

export interface NoteProgress {
  path: string;
  title: string;
  course?: string;
  tasksDone: number;
  tasksTotal: number;
  /** `YYYY-MM-DD` of the `reviewed` front matter, or the file's modification date. */
  lastTouched?: string;
}

export interface CourseProgress {
  course: string;
  notes: number;
  tasksDone: number;
  tasksTotal: number;
}

export const NO_COURSE = '(no course)';

export function courseProgress(notes: NoteProgress[]): CourseProgress[] {
  const map = new Map<string, CourseProgress>();
  for (const n of notes) {
    const key = n.course ?? NO_COURSE;
    const c = map.get(key) ?? { course: key, notes: 0, tasksDone: 0, tasksTotal: 0 };
    c.notes++;
    c.tasksDone += n.tasksDone;
    c.tasksTotal += n.tasksTotal;
    map.set(key, c);
  }
  return [...map.values()].sort((a, b) => (a.course === NO_COURSE ? 1 : b.course === NO_COURSE ? -1 : a.course.localeCompare(b.course)));
}

/** Notes in a course not opened or marked `reviewed` for `days` days, oldest first. */
export function staleTopics(notes: NoteProgress[], today: string, days = 14): NoteProgress[] {
  return notes
    .filter((n) => n.course && n.lastTouched && daysBetween(n.lastTouched, today) >= days)
    .sort((a, b) => (a.lastTouched ?? '').localeCompare(b.lastTouched ?? ''));
}
