// Runs inside the preview webview.
import { boardEdit, root, vscode } from './shared';
import { move } from './kanban';

// ---- Gallery ----

const galBoardOf = (el: Element) => el.closest<HTMLElement>('.kanban-gallery');
const galIsInteractive = (el: Element) => galBoardOf(el)?.hasAttribute('data-interactive') ?? false;
const galRef = (card: HTMLElement) => ({ line: Number(card.dataset['line']), hash: card.dataset['hash'] ?? '' });

function galCardsIn(gallery: Element, except?: Element): HTMLElement[] {
  return Array.from(gallery.querySelectorAll<HTMLElement>(':scope > .db-card')).filter((c) => c !== except);
}

/** Where in reading order (top-to-bottom, left-to-right) a drop at (x, y) lands, in a wrapping grid. */
function galDropIndex(gallery: Element, x: number, y: number): number {
  const cards = galCardsIn(gallery, galDragged ?? undefined);
  const i = cards.findIndex((c) => {
    const r = c.getBoundingClientRect();
    if (y < r.top) return true;
    if (y < r.bottom) return x < r.left + r.width / 2;
    return false;
  });
  return i === -1 ? cards.length : i;
}

function galMove(card: HTMLElement, toIndex: number) {
  const board = galBoardOf(card);
  if (!board) return;
  boardEdit('gallery', 'move', board, galRef(card), { toIndex }, board.dataset['source']);
}

let galDragged: HTMLElement | null = null;

root.addEventListener('dragstart', (event) => {
  const card = (event.target as Element).closest<HTMLElement>('.db-card');
  if (!card || !galIsInteractive(card)) return;
  galDragged = card;
  card.classList.add('dragging');
  event.dataTransfer?.setData('text/plain', '');
  if (event.dataTransfer) event.dataTransfer.effectAllowed = 'move';
});

root.addEventListener('dragover', (event) => {
  const gallery = (event.target as Element).closest<HTMLElement>('.db-gallery');
  if (!galDragged || !gallery || galBoardOf(gallery) !== galBoardOf(galDragged)) return;
  event.preventDefault();
  if (event.dataTransfer) event.dataTransfer.dropEffect = 'move';
});

root.addEventListener('drop', (event) => {
  const gallery = (event.target as Element).closest<HTMLElement>('.db-gallery');
  if (!galDragged || !gallery) return;
  event.preventDefault();
  const card = galDragged;
  const toIndex = galDropIndex(gallery, (event as DragEvent).clientX, (event as DragEvent).clientY);
  const from = galCardsIn(gallery).indexOf(card);
  if (from !== toIndex) {
    gallery.insertBefore(card, galCardsIn(gallery, card)[toIndex] ?? null);
    card.focus();
    galMove(card, toIndex);
  }
});

root.addEventListener('dragend', () => {
  galDragged?.classList.remove('dragging');
  galDragged = null;
});

// Alt+Left/Right swaps a card with its neighbor.
root.addEventListener('keydown', (event) => {
  const card = (event.target as Element).closest<HTMLElement>('.db-card');
  if (!card || event.target !== card || !event.altKey || !galIsInteractive(card)) return;
  const gallery = card.parentElement;
  if (!gallery) return;
  const cards = galCardsIn(gallery);
  const index = cards.indexOf(card);
  let to: number | undefined;
  if (event.key === 'ArrowLeft' && index > 0) to = index - 1;
  else if (event.key === 'ArrowRight' && index < cards.length - 1) to = index + 1;
  else return;
  event.preventDefault();
  const anchor = to < index ? cards[to] : (cards[to + 1] ?? null);
  gallery.insertBefore(card, anchor ?? null);
  card.focus();
  galMove(card, to);
});

root.addEventListener('submit', (event) => {
  const form = (event.target as Element).closest<HTMLFormElement>('.gallery-add');
  const board = form && galBoardOf(form);
  if (!form || !board) return;
  event.preventDefault();
  const image = form.querySelector<HTMLInputElement>('.gallery-add-image');
  const caption = form.querySelector<HTMLInputElement>('.gallery-add-caption');
  const path = image?.value.trim();
  if (!path) return;
  boardEdit('gallery', 'add', board, undefined, { image: path, caption: caption?.value.trim() ?? '' }, board.dataset['source']);
  if (image) image.value = '';
  if (caption) caption.value = '';
});


// ---- Image picker and enlarge ----

root.addEventListener('click', (event) => {
  const pick = (event.target as Element).closest<HTMLElement>('.gallery-pick');
  if (pick) {
    vscode.postMessage({ type: 'pickImage' });
    return;
  }
  // Clicking an image enlarges it; clicking the enlarged view (or pressing Escape) closes it.
  const img = (event.target as Element).closest<HTMLImageElement>('.db-card img');
  if (!img || (event.target as Element).closest('a, button, input')) return;
  const box = document.createElement('div');
  box.className = 'lightbox';
  box.setAttribute('role', 'dialog');
  box.setAttribute('aria-label', img.alt || 'Image');
  box.tabIndex = -1;
  const big = document.createElement('img');
  big.src = img.src;
  big.alt = img.alt;
  box.append(big);
  if (img.alt) {
    const cap = document.createElement('div');
    cap.className = 'lightbox-caption';
    cap.textContent = img.alt;
    box.append(cap);
  }
  const close = () => {
    box.remove();
    document.removeEventListener('keydown', onKey);
  };
  const onKey = (e: KeyboardEvent) => {
    if (e.key === 'Escape') close();
  };
  document.addEventListener('keydown', onKey);
  box.addEventListener('click', close);
  document.body.append(box);
  box.focus();
});
