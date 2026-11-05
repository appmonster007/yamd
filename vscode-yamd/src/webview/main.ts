// Runs inside the preview webview.
import { boardEdit, root, vscode } from './shared';
import { restoreCollapsed, restoreFocus, position } from './kanban';
import './calendar';
import './timeline';
import './gallery';



type ToWebview =
  | { type: 'update'; html: string; full?: boolean }
  | { type: 'scroll'; line: number }




/** Set while the preview scrolls itself, so the scroll handler can ignore it. */
let syncing = false;

function lineElements(): HTMLElement[] {
  // Lines inside embeds belong to other notes.
  return Array.from(root.querySelectorAll<HTMLElement>('[data-line]')).filter((el) => !el.parentElement?.closest('[data-source]'));
}

/** Scrolls so the element for the last block starting at or before `line` is at the top. */
function scrollToLine(line: number) {
  let target: HTMLElement | undefined;
  for (const el of lineElements()) {
    const l = Number(el.dataset['line']);
    if (l <= line && (!target || l >= Number(target.dataset['line']))) target = el;
  }
  syncing = true;
  if (target) window.scrollTo({ top: target.getBoundingClientRect().top + window.scrollY - 8 });
  else window.scrollTo({ top: 0 });
  requestAnimationFrame(() => (syncing = false));
}

/** The top-level blocks of the last page received, as HTML, in the order they are in `root`. */
let lastBlocks: string[] = [];

/**
 * Shows new HTML by replacing only the top-level blocks that changed. Typing in one paragraph then
 * leaves every other block alone, so images don't reload, open `<details>` stay open, selections and
 * scroll position survive, and a long note doesn't re-layout. `full` replaces everything, which a
 * refused edit needs in order to undo changes the page made ahead of the source.
 */
function update(html: string, full = false) {
  const y = window.scrollY;
  const template = document.createElement('template');
  template.innerHTML = html;
  const incoming = Array.from(template.content.children);
  const incomingHtml = incoming.map((el) => el.outerHTML);
  const current = Array.from(root.children);

  if (full || current.length !== lastBlocks.length) {
    // The page and the record of it disagree, or a full refresh was asked for.
    root.replaceChildren(...incoming);
    lastBlocks = incomingHtml;
    addCopyButtons(root);
  } else {
    // Keep the blocks that start and end the same, and swap only the ones in between.
    let head = 0;
    while (head < lastBlocks.length && head < incomingHtml.length && lastBlocks[head] === incomingHtml[head]) head++;
    let tail = 0;
    while (
      tail < lastBlocks.length - head &&
      tail < incomingHtml.length - head &&
      lastBlocks[lastBlocks.length - 1 - tail] === incomingHtml[incomingHtml.length - 1 - tail]
    ) {
      tail++;
    }
    const removed = current.slice(head, current.length - tail);
    const added = incoming.slice(head, incoming.length - tail);
    const anchor = current[current.length - tail] ?? null;
    for (const el of removed) el.remove();
    for (const el of added) root.insertBefore(el, anchor);
    lastBlocks = incomingHtml;
    for (const el of added) {
      addCopyButtons(el);
    }
  }
  restoreCollapsed();
  restoreFocus();
  window.scrollTo({ top: y });
}

// ---- Code blocks ----

/** `scope` itself and the elements inside it that match `selector`. */
function matching<T extends HTMLElement>(scope: ParentNode, selector: string): T[] {
  const inside = Array.from(scope.querySelectorAll<T>(selector));
  return scope instanceof HTMLElement && scope.matches(selector) ? [scope as T, ...inside] : inside;
}

function addCopyButtons(scope: ParentNode) {
  for (const block of matching<HTMLElement>(scope, '.code-block')) {
    if (block.querySelector(':scope > .code-copy')) continue;
    const button = document.createElement('button');
    button.type = 'button';
    button.className = 'code-copy';
    button.textContent = 'Copy';
    button.setAttribute('aria-label', 'Copy code');
    block.append(button);
  }
}

root.addEventListener('click', (event) => {
  const button = (event.target as Element).closest<HTMLButtonElement>('.code-copy');
  const code = button?.parentElement?.querySelector('pre code');
  if (!button || !code) return;
  void navigator.clipboard.writeText((code.textContent ?? '').replace(/\n$/, '')).then(() => {
    button.textContent = 'Copied';
    button.classList.add('copied');
    setTimeout(() => {
      button.textContent = 'Copy';
      button.classList.remove('copied');
    }, 1200);
  });
});

// ---- Quiz mode: hidden answers (`:cloze[…]`) are shown when clicked ----

function toggleCloze(target: EventTarget | null): boolean {
  const cloze = (target as Element | null)?.closest<HTMLElement>('.cloze-hidden');
  if (!cloze) return false;
  cloze.classList.toggle('revealed');
  return true;
}

root.addEventListener('click', (event) => {
  if (toggleCloze(event.target)) event.preventDefault();
});
root.addEventListener('keydown', (event) => {
  if ((event.key === 'Enter' || event.key === ' ') && toggleCloze(event.target)) event.preventDefault();
});

// ---- Task checkboxes ----

root.addEventListener('change', (event) => {
  const box = event.target;
  if (!(box instanceof HTMLInputElement) || !box.classList.contains('task-toggle')) return;
  boardEdit('task', 'toggle', null, { line: Number(box.dataset['line']), hash: box.dataset['hash'] ?? '' }, { done: box.checked }, box.dataset['source']);
});

/** The source line of the block at the top of the viewport. */
function topLine(): number {
  let line = 0;
  let best = -Infinity;
  for (const el of lineElements()) {
    const top = el.getBoundingClientRect().top;
    if (top <= 16 && top > best) {
      best = top;
      line = Number(el.dataset['line']);
    }
  }
  return line;
}

// Double-clicking prose opens the source at that line, as in VS Code's Markdown preview. Interactive
// blocks (boards, tasks, database views) keep their own double-click behavior.
document.addEventListener('dblclick', (event) => {
  const target = event.target as Element | null;
  if (!target || target.closest('input, button, textarea, select, a, summary, .kanban, .kanban-calendar, .kanban-timeline, .kanban-gallery')) return;
  let el = target.closest<HTMLElement>('[data-line]');
  // Lines inside an embed belong to another note.
  if (!el || el.closest('[data-source]')) return;
  vscode.postMessage({ type: 'editAt', line: Number(el.dataset['line']) });
});

let revealTimer: number | undefined;
window.addEventListener('scroll', () => {
  if (syncing) return;
  window.clearTimeout(revealTimer);
  revealTimer = window.setTimeout(() => vscode.postMessage({ type: 'reveal', line: topLine() }), 60);
});

window.addEventListener('message', (event: MessageEvent<ToWebview>) => {
  const m = event.data;
  if (m.type === 'update') update(m.html, m.full);
  else if (m.type === 'scroll' && !syncing) scrollToLine(m.line);
});

// Show alt text in place of images that fail to load.
document.addEventListener(
  'error',
  (event) => {
    const img = event.target;
    if (!(img instanceof HTMLImageElement)) return;
    const span = document.createElement('span');
    span.className = 'image-missing';
    span.textContent = img.alt || img.getAttribute('src') || 'Missing image';
    img.replaceWith(span);
  },
  true,
);

document.addEventListener('click', (event) => {
  const link = (event.target as Element | null)?.closest('a');
  const href = link?.getAttribute('href');
  if (!link || !href) return;
  event.preventDefault();
  if (href.startsWith('#')) {
    const id = decodeURIComponent(href.slice(1));
    document.getElementById(id)?.scrollIntoView({ block: 'start' });
    return;
  }
  // Links inside an embed are relative to the embedded note; an embed's title link is relative to the outer one.
  const from = link.classList.contains('embed-title') ? link.parentElement?.parentElement : link;
  const source = from?.closest<HTMLElement>('[data-source]')?.dataset['source'];
  vscode.postMessage({ type: 'link', href, source });
});

vscode.postMessage({ type: 'ready' });

