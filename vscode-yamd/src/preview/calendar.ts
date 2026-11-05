// Runs inside the preview webview.
import { boardEdit, root } from './shared';
import { move, startRename } from './kanban';

// ---- Calendar ----

export const calBoardOf = (el: Element) => el.closest<HTMLElement>('.kanban-calendar');
export const calIsInteractive = (el: Element) => calBoardOf(el)?.hasAttribute('data-interactive') ?? false;
export const calRef = (card: HTMLElement) => ({ line: Number(card.dataset['line']), hash: card.dataset['hash'] ?? '' });

export function calMove(card: HTMLElement, toDate: string) {
  const board = calBoardOf(card);
  if (!board) return;
  boardEdit('calendar', 'move', board, calRef(card), { toDate }, board.dataset['source']);
}

export let calDragged: HTMLElement | null = null;

root.addEventListener('dragstart', (event) => {
  const card = (event.target as Element).closest<HTMLElement>('.db-event');
  if (!card || !calIsInteractive(card)) return;
  calDragged = card;
  card.classList.add('dragging');
  event.dataTransfer?.setData('text/plain', card.textContent ?? '');
  if (event.dataTransfer) event.dataTransfer.effectAllowed = 'move';
});

root.addEventListener('dragover', (event) => {
  const day = (event.target as Element).closest<HTMLElement>('.db-day');
  if (!calDragged || !day?.dataset['date'] || calBoardOf(day) !== calBoardOf(calDragged)) return;
  event.preventDefault();
  if (event.dataTransfer) event.dataTransfer.dropEffect = 'move';
  if (!day.classList.contains('drop-target')) {
    root.querySelectorAll('.db-day.drop-target').forEach((d) => d.classList.remove('drop-target'));
    day.classList.add('drop-target');
  }
});

root.addEventListener('drop', (event) => {
  const day = (event.target as Element).closest<HTMLElement>('.db-day');
  if (!calDragged || !day?.dataset['date']) return;
  event.preventDefault();
  day.classList.remove('drop-target');
  calMove(calDragged, day.dataset['date']);
});

root.addEventListener('dragend', (event) => {
  if (!calDragged) return;
  calDragged.classList.remove('dragging');
  calDragged = null;
  if (event.target && (event.target as Element).closest('.kanban-calendar')) {
    root.querySelectorAll('.db-day.drop-target').forEach((d) => d.classList.remove('drop-target'));
  }
});

// Alt+Left/Right shift the due date by a day, Alt+Up/Down by a week.
root.addEventListener('keydown', (event) => {
  const card = (event.target as Element).closest<HTMLElement>('.db-event');
  if (!card || event.target !== card || !event.altKey || !calIsInteractive(card)) return;
  const current = card.closest<HTMLElement>('.db-day')?.dataset['date'];
  if (!current) return;
  const deltaDays =
    event.key === 'ArrowLeft' ? -1 : event.key === 'ArrowRight' ? 1 : event.key === 'ArrowUp' ? -7 : event.key === 'ArrowDown' ? 7 : undefined;
  if (deltaDays === undefined) return;
  event.preventDefault();
  const d = new Date(`${current}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + deltaDays);
  calMove(card, d.toISOString().slice(0, 10));
});

root.addEventListener('submit', (event) => {
  const form = (event.target as Element).closest<HTMLFormElement>('.kanban-add');
  const board = form && calBoardOf(form);
  if (!form || !board || !form.dataset['date']) return;
  const input = form.querySelector<HTMLInputElement>('.kanban-add-input');
  if (!input) return;
  event.preventDefault();
  const text = input.value.trim();
  if (!text) return;
  boardEdit('calendar', 'add', board, undefined, { date: form.dataset['date'], text }, board.dataset['source']);
  input.value = '';
});

root.addEventListener('dblclick', (event) => {
  const card = (event.target as Element).closest<HTMLElement>('.db-event');
  const board = card && calBoardOf(card);
  if (!card || !board || !calIsInteractive(card)) return;
  startRename(card, card.dataset['title'] ?? card.textContent ?? '', (title) => {
    boardEdit('calendar', 'rename', board, calRef(card), { title }, board.dataset['source']);
  });
});

// The agenda is a below-the-grid list (never inside a day cell, which is too narrow to show full
// detail without cropping): clicking a day or week number lists every event in that range, and
// clicking one event narrows the list to just that item, already expanded. This applies to any
// `.db-calendar` grid — the editable `:::calendar` board and the read-only `::db{type=calendar}`
// view alike — not just interactive ones.

export const calGridOf = (el: Element) => el.closest<HTMLElement>('.db-calendar');

export function calFormatDate(iso: string): string {
  const d = new Date(`${iso}T00:00:00Z`);
  return d.toLocaleDateString(undefined, { month: 'long', day: 'numeric', year: 'numeric', timeZone: 'UTC' });
}

export function calShowAgenda(grid: HTMLElement, title: string, events: HTMLElement[], expandAll: boolean) {
  const agenda = grid.querySelector<HTMLElement>('.db-agenda');
  const list = agenda?.querySelector<HTMLElement>('.db-agenda-list');
  const titleEl = agenda?.querySelector<HTMLElement>('.db-agenda-title');
  if (!agenda || !list || !titleEl) return;
  list.replaceChildren();
  for (const original of events) {
    const clone = original.cloneNode(true) as HTMLElement;
    clone.removeAttribute('draggable');
    clone.classList.toggle('expanded', expandAll);
    list.appendChild(clone);
  }
  titleEl.textContent = title;
  agenda.hidden = false;
  agenda.scrollIntoView({ block: 'nearest' });
}

// Click a day's or week's number to list every event in that range below the calendar.
root.addEventListener('click', (event) => {
  const target = event.target as Element;
  const dayNumber = target.closest<HTMLElement>('.db-day-number');
  const weekNumber = target.closest<HTMLElement>('.db-week-number');
  if (!dayNumber && !weekNumber) return;
  const scope = dayNumber?.closest<HTMLElement>('.db-day') ?? weekNumber?.closest<HTMLElement>('.db-week');
  const grid = calGridOf(dayNumber ?? weekNumber!);
  if (!scope || !grid) return;
  const events = Array.from(scope.querySelectorAll<HTMLElement>('.db-event'));
  if (!events.length) return;
  const date = dayNumber ? scope.dataset['date'] : undefined;
  const title = date ? calFormatDate(date) : weekNumber ? `Week ${weekNumber.dataset['week']}` : '';
  calShowAgenda(grid, title, events, false);
});

// Click an event's summary to list just that one item below the calendar, already expanded — unless
// it's already in the agenda, where clicking its summary instead expands/collapses it in place.
// Skipped when the click is on its checkbox, so ticking a task doesn't also open/toggle the card.
root.addEventListener('click', (event) => {
  const target = event.target as Element;
  if (target.closest('input[type="checkbox"]')) return;
  const summary = target.closest<HTMLElement>('.db-event-summary');
  const card = summary?.closest<HTMLElement>('.db-event');
  if (!summary || !card) return;
  if (card.closest('.db-agenda')) {
    if (card.querySelector('.db-event-detail')) card.classList.toggle('expanded');
    return;
  }
  const grid = calGridOf(card);
  if (!grid) return;
  calShowAgenda(grid, card.dataset['title'] ?? card.textContent ?? '', [card], true);
});

// Close the agenda.
root.addEventListener('click', (event) => {
  const closeButton = (event.target as Element).closest<HTMLElement>('.db-agenda-close');
  const agenda = closeButton?.closest<HTMLElement>('.db-agenda');
  if (agenda) agenda.hidden = true;
});
