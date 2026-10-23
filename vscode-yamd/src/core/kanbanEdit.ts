import { buildBoard, cardSource, hashText } from './kanban';
import type { KanbanBoard, KanbanCard, KanbanColumn } from './kanban';
import { parse, walkBlocks } from './parser';
import type { ContainerBlock, YamdDocument } from './types';

/** Replace lines [startLine, endLine] (inclusive) with `text`. */
export interface LineEdit {
  startLine: number;
  endLine: number;
  text: string;
}

export interface CardRef {
  line: number;
  hash: string;
}

export const ITEM_PREFIX = /^(\s*)([-*+]|\d{1,9}[.)])([ \t]+)(\[[ xX]\][ \t]+)?/;

/** The first card/row in `items` whose `line` matches and whose source still hashes to `hash`. */
export function findByHash<T extends { line: number; endLine: number }>(items: T[], lines: string[], line: number, hash: string): T | undefined {
  const found = items.find((c) => c.line === line);
  return found && hashText(cardSource(lines, found)) === hash ? found : undefined;
}

function findBoard(doc: YamdDocument, boardLine: number): KanbanBoard | null {
  let found: ContainerBlock | null = null;
  walkBlocks(doc.blocks, (b) => {
    if (!found && b.type === 'container' && b.name === 'kanban' && b.line === boardLine) found = b;
  });
  return found ? buildBoard(found) : null;
}

function findCard(board: KanbanBoard, line: number): { column: KanbanColumn; card: KanbanCard } | null {
  for (const column of board.columns) {
    const card = column.cards.find((c) => c.line === line);
    if (card) return { column, card };
  }
  return null;
}

export const indentOf = (s: string) => /^\s*/.exec(s)?.[0].length ?? 0;

/** Indentation for cards in a column: that of its first card, or none. */
function cardIndent(lines: string[], column: KanbanColumn): number {
  const first = column.cards[0];
  return first ? indentOf(lines[first.line] ?? '') : 0;
}

/** Re-indents lines by a uniform delta, keeping relative nesting. */
export function reindent(cardLines: string[], delta: number): string[] {
  if (delta === 0) return cardLines;
  return cardLines.map((l) => {
    if (l.trim() === '') return l;
    if (delta > 0) return ' '.repeat(delta) + l;
    const remove = Math.min(-delta, indentOf(l));
    return l.slice(remove);
  });
}

/** Sets the checkbox on a card's first line, if it has one. */
function setDone(line: string, done: boolean): string {
  return line.replace(/^(\s*(?:[-*+]|\d{1,9}[.)])[ \t]+)\[[ xX]\]/, `$1[${done ? 'x' : ' '}]`);
}

/** The line after which new content for a column goes when it has no cards. */
function emptyColumnInsertLine(column: KanbanColumn): number {
  return column.endLine;
}

/**
 * Moves a card to `toIndex` within column `toColumn` (indices counted with the card removed).
 * Returns one edit covering the board's body, or null if the board or card no longer matches.
 */
export function moveCard(
  source: string,
  boardLine: number,
  ref: CardRef,
  toColumn: number,
  toIndex: number,
): LineEdit | null {
  const doc = parse(source);
  const board = findBoard(doc, boardLine);
  if (!board) return null;
  const found = findCard(board, ref.line);
  if (!found || hashText(cardSource(doc.lines, found.card)) !== ref.hash) return null;
  const target = board.columns[toColumn];
  if (!target) return null;

  const { card, column: fromColumn } = found;
  const lines = doc.lines;
  let moved = lines.slice(card.line, card.endLine + 1);
  const delta = cardIndent(lines, target === fromColumn ? fromColumn : target) - indentOf(moved[0] ?? '');
  if (target.cards.length > 0 || target === fromColumn) moved = reindent(moved, delta);
  if (target.complete !== fromColumn.complete && card.hasCheckbox) {
    moved[0] = setDone(moved[0] ?? '', target.complete);
  }

  // Work on the board body only: the lines between `:::kanban` and the closing fence.
  const bodyStart = board.line + 1;
  const bodyEnd = Math.min(board.endLine, lines.length) - 1;
  const closed = /^\s*:{3,}\s*$/.test(lines[board.endLine] ?? '');
  const lastBodyLine = closed ? bodyEnd : board.endLine;
  const body = lines.slice(bodyStart, lastBodyLine + 1);
  const rel = (n: number) => n - bodyStart;

  // Remove the card.
  body.splice(rel(card.line), card.endLine - card.line + 1);
  const shift = (n: number) => (n > card.endLine ? n - (card.endLine - card.line + 1) : n);

  // Find the insertion point in the shortened body.
  const remaining = target.cards.filter((c) => c !== card);
  let insertAt: number;
  let prefixBlank = false;
  if (remaining.length === 0) {
    const after = target === fromColumn ? target.line : shift(emptyColumnInsertLine(target));
    insertAt = rel(after) + 1;
    prefixBlank = (body[insertAt - 1] ?? '').trim() !== '';
  } else if (toIndex < remaining.length) {
    insertAt = rel(shift((remaining[Math.max(0, toIndex)] as KanbanCard).line));
  } else {
    insertAt = rel(shift((remaining[remaining.length - 1] as KanbanCard).endLine)) + 1;
  }
  const insertion = prefixBlank ? ['', ...moved] : moved;
  // Keep a blank line before a following heading.
  const next = body[insertAt];
  if (next !== undefined && /^\s*#{1,6}(\s|$)/.test(next)) insertion.push('');
  body.splice(insertAt, 0, ...insertion);

  return { startLine: bodyStart, endLine: lastBodyLine, text: body.join('\n') };
}

/** Appends `- [ ] text` to a column. */
export function addCard(source: string, boardLine: number, toColumn: number, text: string): LineEdit | null {
  const title = text.replace(/\s+/g, ' ').trim();
  if (!title) return null;
  const doc = parse(source);
  const board = findBoard(doc, boardLine);
  const column = board?.columns[toColumn];
  if (!board || !column) return null;
  const indent = ' '.repeat(cardIndent(doc.lines, column));
  const line = `${indent}- [ ] ${title}`;
  const last = column.cards[column.cards.length - 1];
  if (last) return { startLine: last.endLine, endLine: last.endLine, text: `${doc.lines[last.endLine] ?? ''}\n${line}` };
  const after = column.endLine;
  return { startLine: after, endLine: after, text: `${doc.lines[after] ?? ''}\n\n${line}` };
}

/** Rewrites a card's title line, keeping its marker, checkbox, tags and attributes. */
export function rewriteCardTitleLine(line: string, title: string): string {
  const prefix = ITEM_PREFIX.exec(line)?.[0] ?? '';
  const rest = line.slice(prefix.length);
  const attrs = /\s*\{[^{}]*\}\s*$/.exec(rest)?.[0] ?? '';
  const withoutAttrs = rest.slice(0, rest.length - attrs.length);
  const tags = withoutAttrs.match(/(?:^|\s)#[\p{L}\p{N}_/-]*[\p{L}_/-][\p{L}\p{N}_/-]*(?=\s|$)/gu) ?? [];
  const newTags = tags.filter((t) => !title.includes(t.trim())).join('');
  return `${prefix}${title}${newTags}${attrs}`;
}

/** Replaces a card's title text, keeping its marker, checkbox, tags and attributes. */
export function renameCard(source: string, boardLine: number, ref: CardRef, title: string): LineEdit | null {
  const clean = title.replace(/\s+/g, ' ').trim();
  if (!clean) return null;
  const doc = parse(source);
  const board = findBoard(doc, boardLine);
  const found = board && findCard(board, ref.line);
  if (!found || hashText(cardSource(doc.lines, found.card)) !== ref.hash) return null;
  return { startLine: ref.line, endLine: ref.line, text: rewriteCardTitleLine(doc.lines[ref.line] ?? '', clean) };
}

/** The editable title text of a card: its first line without marker, checkbox, tags or attributes. */
export function cardTitleSource(line: string): string {
  const prefix = ITEM_PREFIX.exec(line)?.[0] ?? '';
  return line
    .slice(prefix.length)
    .replace(/\s*\{[^{}]*\}\s*$/, '')
    .replace(/(^|\s)#[\p{L}\p{N}_/-]*[\p{L}_/-][\p{L}\p{N}_/-]*(?=\s|$)/gu, '$1')
    .trim();
}

/** Ticks or unticks the task on `line`, if its text still hashes to `hash`. */
export function toggleTask(source: string, line: number, hash: string, done: boolean): LineEdit | null {
  const text = source.split('\n')[line]?.replace(/\r$/, '');
  if (text === undefined || hashText(text) !== hash) return null;
  const next = setDone(text, done);
  return next === text ? null : { startLine: line, endLine: line, text: next };
}
