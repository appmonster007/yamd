export {};
/** The flashcard review page: shows a card, reveals the answer, and reports the grade. */
interface Item {
  id: string;
  front: string;
  back: string;
  intervals: Record<'again' | 'hard' | 'good' | 'easy', number>;
  path: string;
  line: number;
  title: string;
}

declare function acquireVsCodeApi(): { postMessage(m: unknown): void };
const vscode = acquireVsCodeApi();
const root = document.getElementById('root') as HTMLElement;
let queue: Item[] = [];
let total = 0;
let done = 0;
let revealed = false;

const label = (days: number) => (days <= 0 ? 'now' : days === 1 ? '1 day' : days < 30 ? `${days} days` : `${Math.round(days / 30)} mo`);

function draw() {
  const card = queue[0];
  if (!card) {
    root.innerHTML = `<div class="finished"><h1>All done</h1><p>You reviewed ${done} card${done === 1 ? '' : 's'}.</p></div>`;
    return;
  }
  const grades = (['again', 'hard', 'good', 'easy'] as const)
    .map((g, i) => `<button data-grade="${g}" class="grade ${g}"><span>${g[0]?.toUpperCase()}${g.slice(1)}</span><small>${label(card.intervals[g])}</small><kbd>${i + 1}</kbd></button>`)
    .join('');
  root.innerHTML = `
<header><span>${done} / ${total}</span><button class="link" data-open>${card.title}</button></header>
<div class="progress"><span style="width:${total ? (done / total) * 100 : 0}%"></span></div>
<article class="card-face yamd-body">${card.front}</article>
${revealed ? `<hr><article class="card-face yamd-body">${card.back}</article><div class="grades">${grades}</div>` : '<div class="grades"><button class="primary" data-show>Show answer <kbd>Space</kbd></button></div>'}`;
}

function grade(g: 'again' | 'hard' | 'good' | 'easy') {
  const card = queue.shift();
  if (!card) return;
  vscode.postMessage({ type: 'grade', id: card.id, grade: g });
  if (g === 'again') queue.push(card);
  else done++;
  revealed = false;
  draw();
}

root.addEventListener('click', (e) => {
  const t = e.target as Element;
  if (t.closest('[data-show]')) {
    revealed = true;
    draw();
  } else if (t.closest('[data-open]') && queue[0]) {
    vscode.postMessage({ type: 'open', path: queue[0].path, line: queue[0].line });
  } else {
    const g = t.closest<HTMLElement>('[data-grade]')?.dataset['grade'];
    if (g) grade(g as 'again');
  }
});

document.addEventListener('keydown', (e) => {
  if (!queue[0]) return;
  if (!revealed && (e.key === ' ' || e.key === 'Enter')) {
    e.preventDefault();
    revealed = true;
    draw();
  } else if (revealed && '1234'.includes(e.key) && e.key.length === 1) grade((['again', 'hard', 'good', 'easy'] as const)[Number(e.key) - 1] as 'again');
});

window.addEventListener('message', (e: MessageEvent<{ type: string; items: Item[] }>) => {
  if (e.data.type !== 'queue') return;
  queue = e.data.items;
  total = queue.length;
  done = 0;
  revealed = false;
  draw();
});
vscode.postMessage({ type: 'ready' });
