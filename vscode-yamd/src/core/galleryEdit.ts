import { buildGallery, cardSource, hashText } from './kanban';
import type { GalleryBoard } from './kanban';
import { findByHash } from './kanbanEdit';
import type { CardRef, LineEdit } from './kanbanEdit';
import { parse, walkBlocks } from './parser';
import type { ContainerBlock, YamdDocument } from './types';

function findBoard(doc: YamdDocument, boardLine: number): GalleryBoard | null {
  let found: ContainerBlock | null = null;
  walkBlocks(doc.blocks, (b) => {
    if (!found && b.type === 'container' && b.name === 'gallery' && b.line === boardLine) found = b;
  });
  return found ? buildGallery(found) : null;
}

/**
 * Reorders a gallery card to `toIndex` (counted with the card removed) — a gallery has no lanes
 * or dates, just position, so this is a flat reorder, the same shape as kanban's within-column
 * move but with no column dimension.
 */
export function moveGalleryCard(source: string, boardLine: number, ref: CardRef, toIndex: number): LineEdit | null {
  const doc = parse(source);
  const board = findBoard(doc, boardLine);
  if (!board) return null;
  const card = findByHash(board.cards, doc.lines, ref.line, ref.hash);
  if (!card) return null;

  const lines = doc.lines;
  const moved = lines.slice(card.line, card.endLine + 1);

  const bodyStart = board.line + 1;
  const bodyEnd = Math.min(board.endLine, lines.length) - 1;
  const closed = /^\s*:{3,}\s*$/.test(lines[board.endLine] ?? '');
  const lastBodyLine = closed ? bodyEnd : board.endLine;
  const body = lines.slice(bodyStart, lastBodyLine + 1);
  const rel = (n: number) => n - bodyStart;

  body.splice(rel(card.line), card.endLine - card.line + 1);
  const shift = (n: number) => (n > card.endLine ? n - (card.endLine - card.line + 1) : n);

  const remaining = board.cards.filter((c) => c !== card);
  let insertAt: number;
  if (remaining.length === 0) {
    insertAt = 0;
  } else if (toIndex < remaining.length) {
    insertAt = rel(shift((remaining[Math.max(0, toIndex)] as (typeof remaining)[number]).line));
  } else {
    insertAt = rel(shift((remaining[remaining.length - 1] as (typeof remaining)[number]).endLine)) + 1;
  }
  const prefixBlank = insertAt > 0 && (body[insertAt - 1] ?? '').trim() !== '';
  const insertion = prefixBlank ? ['', ...moved] : moved;
  body.splice(insertAt, 0, ...insertion);

  return { startLine: bodyStart, endLine: lastBodyLine, text: body.join('\n') };
}

/** Appends an `![alt](path)` plus caption paragraph to the gallery. */
export function addGalleryCard(source: string, boardLine: number, imagePath: string, caption: string): LineEdit | null {
  const path = imagePath.trim();
  if (!path) return null;
  const doc = parse(source);
  const board = findBoard(doc, boardLine);
  if (!board) return null;
  const cap = caption.replace(/\s+/g, ' ').trim();
  const alt = cap || 'Image';
  const block = cap ? `![${alt}](${path})\n${cap}` : `![${alt}](${path})`;
  const last = board.cards[board.cards.length - 1];
  if (last) return { startLine: last.endLine, endLine: last.endLine, text: `${doc.lines[last.endLine] ?? ''}\n\n${block}` };
  return { startLine: board.line, endLine: board.line, text: `${doc.lines[board.line] ?? ''}\n\n${block}` };
}
