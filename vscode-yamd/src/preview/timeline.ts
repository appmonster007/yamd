// Runs inside the preview webview.
import { boardEdit, root } from './shared';
import { move, position, startRename } from './kanban';

// ---- Timeline ----

export const tlBoardOf = (el: Element) => el.closest<HTMLElement>('.kanban-timeline');
export const tlIsInteractive = (el: Element) => tlBoardOf(el)?.hasAttribute('data-interactive') ?? false;
export const tlRef = (bar: HTMLElement) => ({ line: Number(bar.dataset['line']), hash: bar.dataset['hash'] ?? '' });

/** Converts an x position within a track to an ISO date, using the timeline's own start/end range. */
export function tlDateAt(track: HTMLElement, clientX: number): string | undefined {
  const timeline = tlBoardOf(track)?.querySelector<HTMLElement>('.db-timeline');
  const start = timeline?.dataset['start'];
  const end = timeline?.dataset['end'];
  if (!start || !end) return undefined;
  const rect = track.getBoundingClientRect();
  const frac = rect.width ? Math.min(1, Math.max(0, (clientX - rect.left) / rect.width)) : 0;
  const s = new Date(`${start}T00:00:00Z`).getTime();
  const e = new Date(`${end}T00:00:00Z`).getTime();
  return new Date(s + frac * Math.max(e - s, 86400000)).toISOString().slice(0, 10);
}

export function tlMove(bar: HTMLElement, toGroup: number, newStart: string) {
  const board = tlBoardOf(bar);
  if (!board) return;
  boardEdit('timeline', 'move', board, tlRef(bar), { toGroup, newStart }, board.dataset['source']);
}

export let tlDragged: HTMLElement | null = null;

// A vertical line + date label that follows the cursor during a drag, so the user can see exactly
// where it will land before dropping — otherwise there's no feedback at all about the target date.
export const tlCursor = document.createElement('div');
tlCursor.className = 'db-timeline-cursor';
export const tlCursorLabel = document.createElement('div');
tlCursorLabel.className = 'db-timeline-cursor-label';
tlCursor.append(tlCursorLabel);

root.addEventListener('dragstart', (event) => {
  const bar = (event.target as Element).closest<HTMLElement>('.db-timeline-bar');
  if (!bar || !tlIsInteractive(bar)) return;
  tlDragged = bar;
  bar.classList.add('dragging');
  event.dataTransfer?.setData('text/plain', bar.textContent ?? '');
  if (event.dataTransfer) event.dataTransfer.effectAllowed = 'move';
});

root.addEventListener('dragover', (event) => {
  const row = (event.target as Element).closest<HTMLElement>('.db-timeline-row');
  const track = row?.querySelector<HTMLElement>('.db-timeline-track');
  if (!tlDragged || !row || !track || tlBoardOf(row) !== tlBoardOf(tlDragged)) return;
  event.preventDefault();
  if (event.dataTransfer) event.dataTransfer.dropEffect = 'move';
  if (!row.classList.contains('drop-target')) {
    root.querySelectorAll('.db-timeline-row.drop-target').forEach((r) => r.classList.remove('drop-target'));
    row.classList.add('drop-target');
  }
  const newStart = tlDateAt(track, event.clientX);
  if (newStart) {
    const rect = track.getBoundingClientRect();
    const pct = rect.width ? ((event.clientX - rect.left) / rect.width) * 100 : 0;
    tlCursorLabel.textContent = newStart;
    tlCursor.style.left = `${Math.min(100, Math.max(0, pct))}%`;
    if (tlCursor.parentElement !== track) track.append(tlCursor);
  }
});

root.addEventListener('drop', (event) => {
  const row = (event.target as Element).closest<HTMLElement>('.db-timeline-row');
  const track = row?.querySelector<HTMLElement>('.db-timeline-track');
  if (!tlDragged || !row || !track) return;
  event.preventDefault();
  row.classList.remove('drop-target');
  tlCursor.remove();
  const newStart = tlDateAt(track, event.clientX);
  if (newStart) tlMove(tlDragged, Number(row.dataset['group']), newStart);
});

root.addEventListener('dragend', () => {
  tlDragged?.classList.remove('dragging');
  tlDragged = null;
  tlCursor.remove();
  root.querySelectorAll('.db-timeline-row.drop-target').forEach((r) => r.classList.remove('drop-target'));
});

// Alt+Left/Right reschedules by a day; Alt+Up/Down moves to the neighboring lane.
root.addEventListener('keydown', (event) => {
  const bar = (event.target as Element).closest<HTMLElement>('.db-timeline-bar');
  if (!bar || event.target !== bar || !event.altKey || !tlIsInteractive(bar)) return;
  const board = tlBoardOf(bar);
  const row = bar.closest<HTMLElement>('.db-timeline-row');
  const start = bar.dataset['start'];
  if (!board || !row || !start) return;
  const group = Number(row.dataset['group']);
  const rows = Array.from(board.querySelectorAll<HTMLElement>('.db-timeline-row'));
  let toGroup = group;
  let deltaDays = 0;
  if (event.key === 'ArrowLeft') deltaDays = -1;
  else if (event.key === 'ArrowRight') deltaDays = 1;
  else if (event.key === 'ArrowUp' && group > 0) toGroup = group - 1;
  else if (event.key === 'ArrowDown' && group < rows.length - 1) toGroup = group + 1;
  else return;
  event.preventDefault();
  let newStart = start;
  if (deltaDays) {
    const d = new Date(`${start}T00:00:00Z`);
    d.setUTCDate(d.getUTCDate() + deltaDays);
    newStart = d.toISOString().slice(0, 10);
  }
  tlMove(bar, toGroup, newStart);
});

root.addEventListener('submit', (event) => {
  const form = (event.target as Element).closest<HTMLFormElement>('.kanban-add');
  const board = form && tlBoardOf(form);
  if (!form || !board || form.dataset['group'] === undefined) return;
  const input = form.querySelector<HTMLInputElement>('.kanban-add-input');
  if (!input) return;
  event.preventDefault();
  const text = input.value.trim();
  if (!text) return;
  const group = form.dataset['group'] === '' ? null : Number(form.dataset['group']);
  boardEdit('timeline', 'add', board, undefined, { group, text }, board.dataset['source']);
  input.value = '';
});

root.addEventListener('dblclick', (event) => {
  const bar = (event.target as Element).closest<HTMLElement>('.db-timeline-bar');
  const board = bar && tlBoardOf(bar);
  if (!bar || !board || !tlIsInteractive(bar)) return;
  startRename(bar, bar.dataset['title'] ?? bar.textContent ?? '', (title) => {
    boardEdit('timeline', 'rename', board, tlRef(bar), { title }, board.dataset['source']);
  });
});
