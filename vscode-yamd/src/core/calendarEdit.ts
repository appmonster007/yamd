import { buildCalendarCards } from './kanban';
import type { CalendarBoard } from './kanban';
import { findByHash, rewriteCardTitleLine } from './kanbanEdit';
import type { CardRef, LineEdit } from './kanbanEdit';
import { parse, walkBlocks } from './parser';
import type { ContainerBlock, YamdDocument } from './types';

function findBoard(doc: YamdDocument, boardLine: number): CalendarBoard | null {
  let found: ContainerBlock | null = null;
  walkBlocks(doc.blocks, (b) => {
    if (!found && b.type === 'container' && b.name === 'calendar' && b.line === boardLine) found = b;
  });
  return found ? buildCalendarCards(found) : null;
}

/**
 * Moves a card to a new day by rewriting its `{due=...}` value. Unlike a kanban card, a calendar
 * card's line never moves — only which day it's placed on changes.
 */
export function moveCalendarCard(source: string, boardLine: number, ref: CardRef, toDate: string): LineEdit | null {
  const doc = parse(source);
  const board = findBoard(doc, boardLine);
  if (!board) return null;
  const card = findByHash(board.cards, doc.lines, ref.line, ref.hash);
  if (!card) return null;
  const line = doc.lines[card.line] ?? '';
  const next = line.replace(/\bdue=[^\s}]+/, `due=${toDate}`);
  return next === line ? null : { startLine: card.line, endLine: card.line, text: next };
}

/** Appends `- [ ] text {due=date}` to the calendar's card list. */
export function addCalendarCard(source: string, boardLine: number, date: string, text: string): LineEdit | null {
  const title = text.replace(/\s+/g, ' ').trim();
  if (!title) return null;
  const doc = parse(source);
  const board = findBoard(doc, boardLine);
  if (!board) return null;
  const line = `- [ ] ${title} {due=${date}}`;
  const last = board.cards[board.cards.length - 1];
  if (last) return { startLine: last.endLine, endLine: last.endLine, text: `${doc.lines[last.endLine] ?? ''}\n${line}` };
  return { startLine: board.line, endLine: board.line, text: `${doc.lines[board.line] ?? ''}\n\n${line}` };
}

/** Replaces a calendar card's title text, keeping its checkbox, tags and attributes. */
export function renameCalendarCard(source: string, boardLine: number, ref: CardRef, title: string): LineEdit | null {
  const clean = title.replace(/\s+/g, ' ').trim();
  if (!clean) return null;
  const doc = parse(source);
  const board = findBoard(doc, boardLine);
  if (!board) return null;
  const card = findByHash(board.cards, doc.lines, ref.line, ref.hash);
  if (!card) return null;
  return { startLine: card.line, endLine: card.line, text: rewriteCardTitleLine(doc.lines[card.line] ?? '', clean) };
}
