/**
 * What the sidebar views list, as plain data. The extension turns these into tree items, so the
 * contents of each view are tested without VS Code.
 */
import { scanCallouts, typeLabel } from '../build/callouts';
import { collectTargets } from '../build/refs';
import { buildQueue } from '../study/cards';
import type { Card, Schedule } from '../study/cards';
import { formatMinutes } from '../study/studylog';
import type { DashboardData } from '../study/dashboard';
import { scanWidgets } from '../widgets/fences';
import { fencedLines } from '../build/callouts';
import { extractFrontMatter } from '../markdown/frontmatter';
import { findMentions, namesOf } from '../notes/mentions';
import type { Mention } from '../notes/mentions';

export interface SidebarNode {
  label: string;
  description?: string;
  /** A VS Code theme icon name, such as `calendar`. */
  icon?: string;
  /** Line in the active note to open or reveal. */
  line?: number;
  /** A note to open (with `line`) instead of the active one. */
  path?: string;
  /** The widget block starting at `line` should open in its panel. */
  widget?: boolean;
  /** Arguments for the review command (a course name). */
  review?: string;
  /** An unlinked mention: where it is and what to link it to. */
  mention?: { path: string; line: number; col: number; length: number; target: string; text: string };
  children?: SidebarNode[];
}

const WIDGET_ICONS: Record<string, string> = { kanban: 'project', calendar: 'calendar', timeline: 'graph-line', gallery: 'file-media', sql: 'table' };

/** The widget blocks in a note, in order. */
export function widgetNodes(lines: string[]): SidebarNode[] {
  return scanWidgets(lines).map((w) => ({
    label: w.label,
    description: `${w.type === 'sql' ? 'query' : w.type} · line ${w.startLine + 1}${w.type === 'sql' && w.attrs['view'] ? ` · ${w.attrs['view']}` : ''}`,
    icon: WIDGET_ICONS[w.type] ?? 'symbol-misc',
    line: w.startLine,
    widget: true,
  }));
}

/** The note's headings as a tree: a heading's children are the deeper headings under it. */
export function headingNodes(lines: string[]): SidebarNode[] {
  const fenced = fencedLines(lines);
  const fm = extractFrontMatter(lines);
  const roots: SidebarNode[] = [];
  const stack: { level: number; node: SidebarNode }[] = [];
  lines.forEach((text, line) => {
    if (fenced.has(line) || (fm && line <= fm.endLine)) return;
    const m = /^(#{1,6})\s+(.+?)\s*#*\s*$/.exec(text);
    if (!m) return;
    const level = (m[1] as string).length;
    const node: SidebarNode = { label: (m[2] as string).replace(/\s*\^[\w-]+$/, ''), description: `h${level}`, icon: 'symbol-string', line };
    while (stack.length && (stack[stack.length - 1] as { level: number }).level >= level) stack.pop();
    const parent = stack[stack.length - 1]?.node;
    if (parent) (parent.children ??= []).push(node);
    else roots.push(node);
    stack.push({ level, node });
  });
  return roots;
}

/** Notes that name this one without linking to it, grouped by note. */
export function mentionNodes(selfPath: string, selfLines: string[], notes: { path: string; text: string }[], name: (path: string) => string): SidebarNode[] {
  const self = namesOf(selfPath, selfLines);
  const byNote = new Map<string, Mention[]>();
  for (const m of findMentions(self, notes, selfPath)) byNote.set(m.path, [...(byNote.get(m.path) ?? []), m]);
  return [...byNote.entries()]
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([path, list]) => ({
      label: name(path),
      description: `${list.length} ${list.length === 1 ? 'mention' : 'mentions'}`,
      icon: 'markdown',
      path,
      line: list[0]?.line ?? 0,
      children: list.map<SidebarNode>((m) => ({
        label: m.snippet,
        description: `line ${m.line + 1}`,
        icon: 'link',
        path,
        line: m.line,
        mention: { path, line: m.line, col: m.col, length: m.length, target: self.target, text: m.text },
      })),
    }));
}

/** The note's callouts and cross-reference targets. */
export function outlineNodes(lines: string[]): SidebarNode[] {
  const callouts = scanCallouts(lines).map<SidebarNode>((c) => ({
    label: c.number !== undefined ? `${typeLabel(c.type)} ${c.number}${c.title ? `: ${c.title}` : ''}` : `${typeLabel(c.type)}${c.title ? `: ${c.title}` : ''}`,
    ...(c.id ? { description: `^${c.id}` } : {}),
    icon: c.type === 'card' ? 'symbol-event' : c.number !== undefined ? 'symbol-class' : 'info',
    line: c.startLine,
  }));
  const targets = collectTargets(lines)
    .filter((t) => !callouts.some((c) => c.line === t.line))
    .map<SidebarNode>((t) => ({ label: t.label, description: `^${t.id}`, icon: t.kind === 'Figure' ? 'file-media' : t.kind === 'Table' ? 'table' : 'symbol-operator', line: t.line }));
  const out: SidebarNode[] = [];
  const headings = headingNodes(lines);
  if (headings.length) out.push({ label: 'Headings', icon: 'list-tree', children: headings });
  if (callouts.length) out.push({ label: `Callouts (${callouts.length})`, icon: 'comment', children: callouts });
  if (targets.length) out.push({ label: `Figures, tables and equations (${targets.length})`, icon: 'references', children: targets });
  return out;
}

/** Data files named by query blocks across the notes, each with the notes that use it. */
export function dataFileNodes(notes: { path: string; lines: string[] }[], resolve: (note: string, source: string) => string, name: (path: string) => string): SidebarNode[] {
  const byFile = new Map<string, { note: string; line: number }[]>();
  for (const n of notes) {
    for (const w of scanWidgets(n.lines)) {
      if (w.type !== 'sql' || !w.attrs['source']) continue;
      const file = resolve(n.path, w.attrs['source']);
      byFile.set(file, [...(byFile.get(file) ?? []), { note: n.path, line: w.startLine }]);
    }
  }
  return [...byFile.entries()]
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([file, uses]) => ({
      label: name(file),
      description: `${uses.length} ${uses.length === 1 ? 'query' : 'queries'}`,
      icon: /\.csv$/i.test(file) ? 'table' : /\.json$/i.test(file) ? 'json' : 'database',
      path: file,
      children: uses.map((u) => ({ label: name(u.note), description: `line ${u.line + 1}`, icon: 'markdown', path: u.note, line: u.line })),
    }));
}

/** Cards due, new and later, then the same by course. */
export function cardNodes(cards: Card[], schedule: Schedule, today: string, newLimit: number): SidebarNode[] {
  if (!cards.length) return [];
  const all = buildQueue(cards, schedule, today, newLimit);
  const out: SidebarNode[] = [
    { label: `Due today: ${all.due.length}`, icon: 'bell', review: '' },
    { label: `New: ${all.fresh.length}`, icon: 'sparkle', review: '' },
    { label: `Scheduled later: ${all.later}`, icon: 'history' },
  ];
  const courses = [...new Set(cards.map((c) => c.course).filter((c): c is string => !!c))].sort();
  if (courses.length) {
    out.push({
      label: 'By course',
      icon: 'mortar-board',
      children: courses.map((course) => {
        const q = buildQueue(cards, schedule, today, newLimit, course);
        return { label: course, description: `${q.due.length} due · ${q.fresh.length} new`, icon: 'book', review: course };
      }),
    });
  }
  return out;
}

/** Course progress, stale topics and study time. */
export function studyNodes(d: DashboardData): SidebarNode[] {
  const out: SidebarNode[] = [];
  if (d.courses.length) {
    out.push({
      label: 'Courses',
      icon: 'mortar-board',
      children: d.courses.map((c) => ({ label: c.course, description: `${c.tasksDone}/${c.tasksTotal} tasks · ${c.notes} ${c.notes === 1 ? 'note' : 'notes'}`, icon: 'book' })),
    });
  }
  if (d.stale.length) {
    out.push({
      label: `Not touched in ${d.staleDays}+ days (${d.stale.length})`,
      icon: 'history',
      children: d.stale.map((n) => ({ label: d.label(n.path), ...(n.lastTouched ? { description: n.lastTouched } : {}), icon: 'markdown', path: n.path, line: 0 })),
    });
  }
  out.push({
    label: 'Study time',
    icon: 'watch',
    children: [
      { label: `This week: ${formatMinutes(d.study.weekMinutes)}`, icon: 'clock' },
      { label: `Total: ${formatMinutes(d.study.totalMinutes)}`, icon: 'graph' },
      { label: `Streak: ${d.study.streak} ${d.study.streak === 1 ? 'day' : 'days'}`, icon: 'flame' },
    ],
  });
  return out;
}
