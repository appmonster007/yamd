/** The study dashboard (§6.5): deadlines, course progress, cards due and study time, as HTML. */
import { escapeHtml as esc } from '../render';
import type { Agenda, CourseProgress, Deadline, NoteProgress } from './deadlines';
import { relativeDay } from './deadlines';
import type { HeatCell } from './studylog';
import { formatMinutes } from './studylog';

export interface DashboardData {
  today: string;
  agenda: Agenda;
  courses: CourseProgress[];
  stale: NoteProgress[];
  staleDays: number;
  cards: { due: number; fresh: number; later: number };
  study: { weekMinutes: number; totalMinutes: number; streak: number; byCourse: [string, number][]; heatmap: HeatCell[][] };
  /** Display name of a note path. */
  label: (path: string) => string;
}

const open = (path: string, line = 0) => `data-open="${esc(path)}" data-line="${line}"`;

function deadlineList(items: Deadline[], d: DashboardData, cls = ''): string {
  if (!items.length) return '<p class="empty">Nothing here.</p>';
  return `<ul class="deadlines ${cls}">${items
    .map(
      (i) =>
        `<li><button class="link" ${open(i.path, i.line)}>${esc(i.title)}</button> <span class="when">${esc(relativeDay(i.due, d.today))} · ${esc(i.due)}</span>${i.course ? ` <span class="chip">${esc(i.course)}</span>` : ''}${i.kind === 'task' ? ` <span class="from">${esc(d.label(i.path))}</span>` : ''}</li>`,
    )
    .join('')}</ul>`;
}

function bar(done: number, total: number): string {
  const pct = total ? Math.round((done / total) * 100) : 0;
  return `<div class="bar" role="img" aria-label="${pct}% done"><span style="width:${pct}%"></span></div>`;
}

export function dashboardBody(d: DashboardData): string {
  const a = d.agenda;
  const heat = d.study.heatmap
    .map((week) => `<div class="week">${week.map((c) => `<span class="cell l${c.level}${c.future ? ' future' : ''}" title="${esc(c.date)}: ${esc(formatMinutes(c.minutes))}"></span>`).join('')}</div>`)
    .join('');
  const courses = d.courses.length
    ? `<table><thead><tr><th>Course</th><th>Notes</th><th>Tasks</th><th>Progress</th></tr></thead><tbody>${d.courses
        .map((c) => `<tr><td>${esc(c.course)}</td><td>${c.notes}</td><td>${c.tasksDone}/${c.tasksTotal}</td><td>${bar(c.tasksDone, c.tasksTotal)}</td></tr>`)
        .join('')}</tbody></table>`
    : '<p class="empty">Add <code>course:</code> to a note’s front matter to group it here.</p>';
  const byCourse = d.study.byCourse.length ? `<ul class="plain">${d.study.byCourse.map(([c, m]) => `<li>${esc(c)} <span class="when">${esc(formatMinutes(m))}</span></li>`).join('')}</ul>` : '';
  return `
<h1>Study dashboard</h1>
<div class="grid">
<section><h2>Deadlines</h2>
${a.overdue.length ? `<h3 class="bad">Overdue (${a.overdue.length})</h3>${deadlineList(a.overdue, d, 'overdue')}` : ''}
<h3>Today</h3>${deadlineList(a.today, d)}
<h3>Next 7 days</h3>${deadlineList(a.week, d)}
<h3>Later</h3>${deadlineList(a.later.slice(0, 10), d)}
${a.done.length ? `<details><summary>Done (${a.done.length})</summary>${deadlineList(a.done.slice(-10), d, 'done')}</details>` : ''}
</section>
<section><h2>Flashcards</h2>
<p class="stats"><strong>${d.cards.due}</strong> due · <strong>${d.cards.fresh}</strong> new · ${d.cards.later} scheduled later</p>
<p><button class="primary" data-command="yamd.reviewCards">Review cards</button></p>
<h2>Study time</h2>
<p class="stats"><strong>${esc(formatMinutes(d.study.weekMinutes))}</strong> this week · <strong>${d.study.streak}</strong> day streak · ${esc(formatMinutes(d.study.totalMinutes))} in total</p>
<div class="heat" role="img" aria-label="Study time per day, last 26 weeks">${heat}</div>
${byCourse}
<p><button data-command="yamd.startStudyTimer">Start a timer</button></p>
</section>
<section class="wide"><h2>Course progress</h2>${courses}</section>
<section class="wide"><h2>Not reviewed in ${d.staleDays}+ days</h2>${
    d.stale.length ? `<ul class="plain">${d.stale.map((n) => `<li><button class="link" ${open(n.path)}>${esc(n.title)}</button> <span class="chip">${esc(n.course ?? '')}</span> <span class="when">last ${esc(n.lastTouched ?? '')}</span></li>`).join('')}</ul>` : '<p class="empty">Everything has been looked at recently.</p>'
  }</section>
</div>`;
}

export const DASHBOARD_CSS = `
body { font-family: var(--vscode-font-family); color: var(--vscode-foreground); padding: 0 1.5rem 2rem; }
h1 { font-weight: 600; } h2 { margin: 1.2rem 0 0.4rem; font-size: 1.1rem; } h3 { margin: 0.8rem 0 0.2rem; font-size: 0.9rem; opacity: 0.8; text-transform: uppercase; letter-spacing: 0.04em; }
.grid { display: grid; grid-template-columns: repeat(auto-fit, minmax(320px, 1fr)); gap: 0 2rem; } .wide { grid-column: 1 / -1; }
ul { padding-left: 0; list-style: none; } li { margin: 0.25rem 0; }
button { font: inherit; cursor: pointer; border: 1px solid var(--vscode-button-border, transparent); background: var(--vscode-button-secondaryBackground); color: var(--vscode-button-secondaryForeground); padding: 0.2rem 0.7rem; border-radius: 3px; }
button.primary { background: var(--vscode-button-background); color: var(--vscode-button-foreground); }
button.link { background: none; border: 0; padding: 0; color: var(--vscode-textLink-foreground); text-align: left; }
button:focus-visible { outline: 1px solid var(--vscode-focusBorder); }
.when, .from, .empty { opacity: 0.7; font-size: 0.85em; } .bad { color: var(--vscode-errorForeground); }
.chip { background: var(--vscode-badge-background); color: var(--vscode-badge-foreground); border-radius: 9px; padding: 0 0.5rem; font-size: 0.8em; }
.overdue .when { color: var(--vscode-errorForeground); opacity: 1; } .done button { text-decoration: line-through; }
table { border-collapse: collapse; width: 100%; } th, td { text-align: left; padding: 0.3rem 0.6rem; border-bottom: 1px solid var(--vscode-panel-border); }
.bar { height: 8px; background: var(--vscode-progressBar-background); background: color-mix(in srgb, var(--vscode-progressBar-background) 20%, transparent); border-radius: 4px; min-width: 120px; } .bar span { display: block; height: 100%; background: var(--vscode-progressBar-background); border-radius: 4px; }
.heat { display: flex; gap: 3px; margin: 0.5rem 0; overflow-x: auto; } .week { display: flex; flex-direction: column; gap: 3px; }
.cell { width: 11px; height: 11px; border-radius: 2px; background: color-mix(in srgb, var(--vscode-foreground) 10%, transparent); }
.cell.l1 { background: color-mix(in srgb, var(--vscode-charts-green) 35%, transparent); } .cell.l2 { background: color-mix(in srgb, var(--vscode-charts-green) 55%, transparent); } .cell.l3 { background: color-mix(in srgb, var(--vscode-charts-green) 80%, transparent); } .cell.l4 { background: var(--vscode-charts-green); } .cell.future { opacity: 0.25; }
.stats strong { font-size: 1.3em; }
`;

export type { NoteProgress };
