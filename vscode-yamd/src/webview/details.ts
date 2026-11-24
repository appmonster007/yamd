// Runs inside the preview webview: the card details form and the filter bar.
import { boardEdit, root } from './shared';

interface Details {
  due: string;
  start: string;
  owner: string;
  tags: string;
  body: string;
}

const KIND: [string, string][] = [['.kanban-timeline', 'timeline'], ['.kanban-calendar', 'calendar'], ['.kanban', 'kanban']];
const kindOf = (board: Element) => KIND.find(([sel]) => board.matches(sel))?.[1] ?? 'kanban';

let open: HTMLElement | undefined;

function close() {
  open?.remove();
  open = undefined;
}

function field(label: string, input: HTMLElement): HTMLElement {
  const l = document.createElement('label');
  l.className = 'details-field';
  const s = document.createElement('span');
  s.textContent = label;
  l.append(s, input);
  return l;
}

function input(type: string, name: string, value: string, placeholder = ''): HTMLInputElement {
  const i = document.createElement('input');
  i.type = type;
  i.name = name;
  i.value = value;
  i.placeholder = placeholder;
  return i;
}

function openForm(card: HTMLElement) {
  const board = card.closest<HTMLElement>('[data-board]');
  if (!board || !card.dataset['details']) return;
  const kind = kindOf(board);
  const d = JSON.parse(card.dataset['details']) as Details;
  close();
  const form = document.createElement('form');
  form.className = 'details-form';
  form.setAttribute('role', 'dialog');
  form.setAttribute('aria-label', 'Edit details');
  const title = document.createElement('div');
  title.className = 'details-title';
  title.textContent = card.dataset['title'] ?? card.querySelector('.kanban-card-text')?.textContent ?? 'Details';
  const body = document.createElement('textarea');
  body.name = 'body';
  body.rows = 5;
  body.value = d.body;
  const fields = [field('Due', input('date', 'due', d.due))];
  if (kind === 'timeline') fields.unshift(field('Start', input('date', 'start', d.start)));
  fields.push(field('Owner', input('text', 'owner', d.owner, 'name')), field('Tags', input('text', 'tags', d.tags, '#tag #another')), field('Notes', body));
  const actions = document.createElement('div');
  actions.className = 'details-actions';
  const save = document.createElement('button');
  save.type = 'submit';
  save.textContent = 'Save';
  const cancel = document.createElement('button');
  cancel.type = 'button';
  cancel.textContent = 'Cancel';
  cancel.className = 'secondary';
  cancel.addEventListener('click', close);
  actions.append(save, cancel);
  form.append(title, ...fields, actions);
  form.addEventListener('submit', (e) => {
    e.preventDefault();
    const data = new FormData(form);
    const get = (k: string) => String(data.get(k) ?? '');
    boardEdit(kind, 'details', board, { line: Number(card.dataset['line']), hash: card.dataset['hash'] ?? '' }, { due: get('due'), start: get('start'), owner: get('owner'), tags: get('tags'), body: get('body') }, board.dataset['source']);
    close();
  });
  form.addEventListener('keydown', (e) => {
    if (e.key === 'Escape') close();
  });
  board.append(form);
  open = form;
  (form.querySelector('input') as HTMLElement | null)?.focus();
}

root.addEventListener('click', (event) => {
  const button = (event.target as Element).closest<HTMLElement>('.card-edit');
  if (!button) return;
  const card = button.closest<HTMLElement>('[data-details]');
  if (card) openForm(card);
});

// ---- Filter: show only the cards that match some text, an owner (@name) or a tag (#tag) ----

const CARDS = '.kanban-card, .db-event, .db-timeline-bar, .db-timeline-item, .db-card';

function applyFilter(board: HTMLElement, query: string) {
  const terms = query.toLowerCase().split(/\s+/).filter(Boolean);
  for (const card of Array.from(board.querySelectorAll<HTMLElement>(CARDS))) {
    const text = (card.textContent ?? '').toLowerCase();
    const owner = (card.dataset['owner'] ?? '').toLowerCase();
    const tags = (card.dataset['tags'] ?? '').toLowerCase().split(/\s+/);
    const show = terms.every((t) => (t.startsWith('@') ? owner === t.slice(1) : t.startsWith('#') ? tags.includes(t.slice(1)) : text.includes(t)));
    card.classList.toggle('filtered-out', !show);
  }
}

const filters = new Map<string, string>();

/** Adds a filter box to each interactive board that doesn't have one, restoring what was typed. */
export function addFilterBars() {
  for (const board of Array.from(root.querySelectorAll<HTMLElement>('[data-board][data-interactive]'))) {
    if (board.querySelector(':scope > .board-filter')) continue;
    if (!board.querySelector(CARDS)) continue;
    const box = document.createElement('input');
    box.type = 'search';
    box.className = 'board-filter';
    box.placeholder = 'Filter: text, @owner, #tag';
    box.setAttribute('aria-label', 'Filter cards');
    const key = board.dataset['board'] ?? '';
    box.value = filters.get(key) ?? '';
    box.addEventListener('input', () => {
      filters.set(key, box.value);
      applyFilter(board, box.value);
    });
    board.prepend(box);
    if (box.value) applyFilter(board, box.value);
  }
}
