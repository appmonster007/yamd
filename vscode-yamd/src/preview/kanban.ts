// Runs inside the preview webview.
import { boardEdit, root, state, vscode } from './shared';

// ---- Kanban boards ----



/** What to focus after the next render: a card by board, column and index, or a column's add box. */
export let pendingFocus: { board: number; column: number; index?: number; add?: boolean } | undefined;

export const boardOf = (el: Element) => el.closest<HTMLElement>('.kanban');
export const isInteractive = (el: Element) => boardOf(el)?.hasAttribute('data-interactive') ?? false;
export const columnKey = (section: HTMLElement) =>
  `${boardOf(section)?.dataset['board']}:${section.querySelector('.kanban-column-title')?.textContent ?? ''}`;

export function cardRef(card: HTMLElement) {
  return { line: Number(card.dataset['line']), hash: card.dataset['hash'] ?? '' };
}

export function columnsOf(board: HTMLElement): HTMLElement[] {
  return Array.from(board.querySelectorAll<HTMLElement>(':scope > .kanban-columns > .kanban-column'));
}

export function cardsIn(list: Element, except?: Element): HTMLElement[] {
  return Array.from(list.querySelectorAll<HTMLElement>(':scope > .kanban-card')).filter((c) => c !== except);
}

/** Moves a card in the DOM right away, then asks the extension to move it in the source. */
export function move(card: HTMLElement, toColumn: number, toIndex: number) {
  const board = boardOf(card);
  const target = board && columnsOf(board)[toColumn]?.querySelector<HTMLElement>('.kanban-cards');
  if (!board || !target) return;
  const others = cardsIn(target, card);
  target.insertBefore(card, others[toIndex] ?? null);
  card.focus();
  const boardLine = Number(board.dataset['board']);
  pendingFocus = { board: boardLine, column: toColumn, index: toIndex };
  boardEdit('kanban', 'move', board, cardRef(card), { toColumn, toIndex }, board.dataset['source']);
}

export function position(card: HTMLElement) {
  const list = card.parentElement as HTMLElement;
  return { column: Number(list.dataset['column']), index: cardsIn(list).indexOf(card) };
}

export function restoreFocus() {
  const f = pendingFocus;
  pendingFocus = undefined;
  if (!f) return;
  const board = root.querySelector<HTMLElement>(`.kanban[data-board="${f.board}"]`);
  const column = board && columnsOf(board)[f.column];
  if (!column) return;
  const el = f.add
    ? column.querySelector<HTMLElement>('.kanban-add-input')
    : cardsIn(column.querySelector('.kanban-cards') as Element)[f.index ?? 0];
  el?.focus();
}

export function setCollapsed(section: HTMLElement, collapsed: boolean) {
  section.classList.toggle('collapsed', collapsed);
  const button = section.querySelector<HTMLElement>('.kanban-collapse');
  button?.setAttribute('aria-expanded', String(!collapsed));
  const title = section.getAttribute('aria-label') ?? '';
  button?.setAttribute('aria-label', `${collapsed ? 'Expand' : 'Collapse'} ${title}`);
}

export function restoreCollapsed() {
  const collapsed = new Set(state().collapsed ?? []);
  for (const section of Array.from(root.querySelectorAll<HTMLElement>('.kanban-column'))) {
    if (collapsed.has(columnKey(section))) setCollapsed(section, true);
  }
}

root.addEventListener('click', (event) => {
  const button = (event.target as Element).closest<HTMLElement>('.kanban-collapse');
  const section = button?.closest<HTMLElement>('.kanban-column');
  if (!section) return;
  const collapsed = !section.classList.contains('collapsed');
  setCollapsed(section, collapsed);
  const keys = new Set(state().collapsed ?? []);
  if (collapsed) keys.add(columnKey(section));
  else keys.delete(columnKey(section));
  vscode.setState({ ...state(), collapsed: [...keys] });
});

// Drag and drop.
export let dragged: HTMLElement | null = null;
export const indicator = document.createElement('div');
indicator.className = 'kanban-drop-indicator';

/** Index among the column's cards (without the dragged one) where a drop at `y` lands. */
export function dropIndex(list: HTMLElement, y: number): number {
  const cards = cardsIn(list, dragged ?? undefined);
  const i = cards.findIndex((c) => {
    const r = c.getBoundingClientRect();
    return y < r.top + r.height / 2;
  });
  return i === -1 ? cards.length : i;
}

root.addEventListener('dragstart', (event) => {
  const card = (event.target as Element).closest<HTMLElement>('.kanban-card');
  if (!card || !isInteractive(card)) return;
  dragged = card;
  card.classList.add('dragging');
  event.dataTransfer?.setData('text/plain', card.getAttribute('aria-label') ?? '');
  if (event.dataTransfer) event.dataTransfer.effectAllowed = 'move';
});

root.addEventListener('dragover', (event) => {
  const list = (event.target as Element).closest<HTMLElement>('.kanban-column')?.querySelector<HTMLElement>('.kanban-cards');
  if (!dragged || !list || boardOf(list) !== boardOf(dragged)) return;
  event.preventDefault();
  if (event.dataTransfer) event.dataTransfer.dropEffect = 'move';
  const cards = cardsIn(list, dragged);
  list.insertBefore(indicator, cards[dropIndex(list, event.clientY)] ?? null);
});

root.addEventListener('drop', (event) => {
  const list = indicator.parentElement;
  if (!dragged || !list) return;
  event.preventDefault();
  const toIndex = dropIndex(list, event.clientY);
  indicator.remove();
  const card = dragged;
  const from = position(card);
  const toColumn = Number(list.dataset['column']);
  if (from.column !== toColumn || from.index !== toIndex) move(card, toColumn, toIndex);
});

root.addEventListener('dragend', () => {
  dragged?.classList.remove('dragging');
  dragged = null;
  indicator.remove();
});

// Keyboard moves: Alt+Up/Down within a column, Alt+Left/Right to the neighboring column.
root.addEventListener('keydown', (event) => {
  const card = (event.target as Element).closest<HTMLElement>('.kanban-card');
  if (!card || event.target !== card || !event.altKey || !isInteractive(card)) return;
  const board = boardOf(card);
  if (!board) return;
  const { column, index } = position(card);
  const columnCount = columnsOf(board).length;
  const count = (c: number) => cardsIn(columnsOf(board)[c]?.querySelector('.kanban-cards') as Element, card).length;
  let to: { column: number; index: number } | undefined;
  if (event.key === 'ArrowUp' && index > 0) to = { column, index: index - 1 };
  else if (event.key === 'ArrowDown' && index < count(column)) to = { column, index: index + 1 };
  else if (event.key === 'ArrowLeft' && column > 0) to = { column: column - 1, index: count(column - 1) };
  else if (event.key === 'ArrowRight' && column < columnCount - 1) to = { column: column + 1, index: count(column + 1) };
  if (!to) return;
  event.preventDefault();
  move(card, to.column, to.index);
});

// Adding cards.
root.addEventListener('submit', (event) => {
  const form = (event.target as Element).closest<HTMLFormElement>('.kanban-add');
  const input = form?.querySelector<HTMLInputElement>('.kanban-add-input');
  const board = form && boardOf(form);
  if (!form || !input || !board) return;
  event.preventDefault();
  const text = input.value.trim();
  if (!text) return;
  const column = Number(form.dataset['column']);
  const boardLine = Number(board.dataset['board']);
  pendingFocus = { board: boardLine, column, add: true };
  boardEdit('kanban', 'add', board, undefined, { column, text }, board.dataset['source']);
  input.value = '';
});

// Editing a card title in place.
root.addEventListener('dblclick', (event) => {
  const text = (event.target as Element).closest<HTMLElement>('.kanban-card-text');
  const card = text?.closest<HTMLElement>('.kanban-card');
  const board = card && boardOf(card);
  if (!text || !card || !board || !isInteractive(card)) return;
  const input = document.createElement('input');
  input.type = 'text';
  input.className = 'kanban-title-input';
  input.value = text.dataset['title'] ?? text.textContent ?? '';
  input.setAttribute('aria-label', 'Card title');
  const original = text.innerHTML;
  let done = false;
  const finish = (save: boolean) => {
    if (done) return;
    done = true;
    const title = input.value.trim();
    if (save && title && title !== text.dataset['title']) {
      const { column, index } = position(card);
      pendingFocus = { board: Number(board.dataset['board']), column, index };
      text.textContent = title;
      boardEdit('kanban', 'rename', board, cardRef(card), { title }, board.dataset['source']);
    } else {
      text.innerHTML = original;
    }
    card.draggable = true;
    card.focus();
  };
  input.addEventListener('keydown', (e) => {
    e.stopPropagation();
    if (e.key === 'Enter') finish(true);
    else if (e.key === 'Escape') finish(false);
  });
  input.addEventListener('blur', () => finish(true));
  card.draggable = false;
  text.replaceChildren(input);
  input.focus();
  input.select();
});

/**
 * Swaps `el`'s content for a text input seeded with `title`, calling `onSave` with the trimmed
 * value on Enter/blur (if it changed), or restoring the original content on Escape/empty. Shared
 * by calendar and timeline's in-place rename, which (unlike kanban's `.kanban-card-text`) have no
 * separate text node to swap — the whole element's content stands in for it.
 */
export function startRename(el: HTMLElement, title: string, onSave: (value: string) => void) {
  const input = document.createElement('input');
  input.type = 'text';
  input.className = 'kanban-title-input';
  input.value = title;
  input.setAttribute('aria-label', 'Title');
  const original = el.innerHTML;
  let done = false;
  const finish = (save: boolean) => {
    if (done) return;
    done = true;
    const value = input.value.trim();
    if (save && value && value !== title) onSave(value);
    else el.innerHTML = original;
    el.draggable = true;
    el.focus();
  };
  input.addEventListener('keydown', (e) => {
    e.stopPropagation();
    if (e.key === 'Enter') finish(true);
    else if (e.key === 'Escape') finish(false);
  });
  input.addEventListener('blur', () => finish(true));
  el.draggable = false;
  el.replaceChildren(input);
  input.focus();
  input.select();
}
