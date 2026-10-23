import { buildTimeline, cardSource, hashText } from './kanban';
import type { KanbanCard, TimelineBoard, TimelineGroup } from './kanban';
import { findByHash, indentOf, reindent, rewriteCardTitleLine } from './kanbanEdit';
import type { CardRef, LineEdit } from './kanbanEdit';
import { parse, walkBlocks } from './parser';
import type { ContainerBlock, YamdDocument } from './types';

function findBoard(doc: YamdDocument, boardLine: number): TimelineBoard | null {
  let found: ContainerBlock | null = null;
  walkBlocks(doc.blocks, (b) => {
    if (!found && b.type === 'container' && b.name === 'timeline' && b.line === boardLine) found = b;
  });
  return found ? buildTimeline(found) : null;
}

/** Indentation for cards in a lane: that of its first card, or none. */
function groupIndent(lines: string[], group: TimelineGroup): number {
  const first = group.cards[0];
  return first ? indentOf(lines[first.line] ?? '') : 0;
}

function shiftDate(iso: string, days: number): string {
  const d = new Date(`${iso}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
}

function rewriteDateAttrs(line: string, newStart: string, newDue: string | undefined): string {
  let next = line.replace(/\bstart=[^\s}]+/, `start=${newStart}`);
  if (newDue !== undefined) next = next.replace(/\bdue=[^\s}]+/, `due=${newDue}`);
  return next;
}

/**
 * Reschedules a card (shifting `start=`/`due=` together, so its duration is kept) and, when
 * `toGroup` differs from its current lane, moves it under that lane's heading — there's no
 * "position within a lane" to preserve, since a timeline bar is placed by its own dates, not by
 * list order, so a cross-lane move always lands at the end of the target lane's cards.
 */
export function moveTimelineCard(source: string, boardLine: number, ref: CardRef, toGroup: number, newStart: string): LineEdit | null {
  const doc = parse(source);
  const board = findBoard(doc, boardLine);
  if (!board) return null;
  let fromGroupIndex = -1;
  let card: KanbanCard | undefined;
  board.groups.forEach((g, gi) => {
    const c = g.cards.find((x) => x.line === ref.line);
    if (c) {
      fromGroupIndex = gi;
      card = c;
    }
  });
  if (!card || !card.start || hashText(cardSource(doc.lines, card)) !== ref.hash) return null;
  const target = board.groups[toGroup];
  if (!target) return null;

  const deltaDays = Math.round((new Date(`${newStart}T00:00:00Z`).getTime() - new Date(`${card.start}T00:00:00Z`).getTime()) / 86400000);
  if (deltaDays === 0 && toGroup === fromGroupIndex) return null;
  const newDue = card.due ? shiftDate(card.due, deltaDays) : undefined;

  if (toGroup === fromGroupIndex) {
    const line = rewriteDateAttrs(doc.lines[card.line] ?? '', newStart, newDue);
    return { startLine: card.line, endLine: card.line, text: line };
  }

  const lines = doc.lines;
  let moved = lines.slice(card.line, card.endLine + 1);
  const delta = groupIndent(lines, target) - indentOf(moved[0] ?? '');
  if (target.cards.length > 0) moved = reindent(moved, delta);
  moved[0] = rewriteDateAttrs(moved[0] ?? '', newStart, newDue);

  // Work on the board body only: the lines between `:::timeline` and the closing fence.
  const bodyStart = board.line + 1;
  const bodyEnd = Math.min(board.endLine, lines.length) - 1;
  const closed = /^\s*:{3,}\s*$/.test(lines[board.endLine] ?? '');
  const lastBodyLine = closed ? bodyEnd : board.endLine;
  const body = lines.slice(bodyStart, lastBodyLine + 1);
  const rel = (n: number) => n - bodyStart;

  body.splice(rel(card.line), card.endLine - card.line + 1);
  const shift = (n: number) => (n > card!.endLine ? n - (card!.endLine - card!.line + 1) : n);

  let insertAt: number;
  let prefixBlank = false;
  if (target.cards.length === 0) {
    const after = target.line !== undefined ? shift(target.endLine ?? target.line) : board.line;
    insertAt = rel(after) + 1;
    prefixBlank = (body[insertAt - 1] ?? '').trim() !== '';
  } else {
    const last = target.cards[target.cards.length - 1] as KanbanCard;
    insertAt = rel(shift(last.endLine)) + 1;
  }
  const insertion = prefixBlank ? ['', ...moved] : moved;
  const next = body[insertAt];
  if (next !== undefined && /^\s*#{1,6}(\s|$)/.test(next)) insertion.push('');
  body.splice(insertAt, 0, ...insertion);

  return { startLine: bodyStart, endLine: lastBodyLine, text: body.join('\n') };
}

/**
 * Appends `- [ ] text {start=startDate}` to a lane (or, with `group: null` — no lanes targeted,
 * either because the board has none or none was specified — after the last card anywhere, or
 * right after the board opens if it has none at all).
 */
export function addTimelineCard(source: string, boardLine: number, group: number | null, text: string, startDate: string): LineEdit | null {
  const title = text.replace(/\s+/g, ' ').trim();
  if (!title) return null;
  const doc = parse(source);
  const board = findBoard(doc, boardLine);
  if (!board) return null;
  const line = `- [ ] ${title} {start=${startDate}}`;
  const target = group !== null ? board.groups[group] : undefined;
  if (target) {
    const last = target.cards[target.cards.length - 1];
    if (last) return { startLine: last.endLine, endLine: last.endLine, text: `${doc.lines[last.endLine] ?? ''}\n${line}` };
    if (target.line !== undefined) {
      const after = target.endLine ?? target.line;
      return { startLine: after, endLine: after, text: `${doc.lines[after] ?? ''}\n\n${line}` };
    }
  }
  const last = board.groups.flatMap((g) => g.cards).at(-1);
  if (last) return { startLine: last.endLine, endLine: last.endLine, text: `${doc.lines[last.endLine] ?? ''}\n${line}` };
  return { startLine: board.line, endLine: board.line, text: `${doc.lines[board.line] ?? ''}\n\n${line}` };
}

/** Replaces a timeline card's title text, keeping its checkbox, tags and attributes. */
export function renameTimelineCard(source: string, boardLine: number, ref: CardRef, title: string): LineEdit | null {
  const clean = title.replace(/\s+/g, ' ').trim();
  if (!clean) return null;
  const doc = parse(source);
  const board = findBoard(doc, boardLine);
  if (!board) return null;
  const card = findByHash(board.groups.flatMap((g) => g.cards), doc.lines, ref.line, ref.hash);
  if (!card) return null;
  return { startLine: card.line, endLine: card.line, text: rewriteCardTitleLine(doc.lines[card.line] ?? '', clean) };
}
