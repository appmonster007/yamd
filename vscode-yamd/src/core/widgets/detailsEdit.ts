/**
 * Edits a card's details (due, start, owner, tags and body text) from a form. Works on any card list
 * item of a kanban, calendar or timeline board: the title line's `{key=value}` attributes and tags are
 * rewritten, the body lines under it are replaced, and everything else is left alone.
 */
import { buildBoard, buildCalendarCards, buildTimeline, cardSource, hashText } from './kanban';
import type { KanbanCard } from './kanban';
import { parse, walkBlocks } from '../markdown/parser';
import type { ContainerBlock } from '../markdown/types';
import type { CardRef, LineEdit } from './kanbanEdit';

export interface CardDetails {
  due: string;
  start: string;
  owner: string;
  /** Space or comma separated, with or without `#`. */
  tags: string;
  /** Body lines as typed, without the list indent. */
  body: string;
}

const ITEM_PREFIX = /^(\s*)([-*+]|\d{1,9}[.)])([ \t]+)(\[[ xX]\][ \t]+)?/;
const TAG = /(?:^|\s)#[\p{L}\p{N}_/-]*[\p{L}_/-][\p{L}\p{N}_/-]*(?=\s|$)/gu;

/** Splits `{a=1 b="x y"}` text into ordered key/value pairs, keeping the quoting that was used. */
function pairs(attrText: string): [string, string][] {
  return [...attrText.matchAll(/([A-Za-z_][\w-]*)=("[^"]*"|'[^']*'|[^\s}]+)/g)].map((m) => [m[1] as string, m[2] as string]);
}

const quote = (v: string) => (/\s/.test(v) ? `"${v.replace(/"/g, "'")}"` : v);

/** The title line with its attributes and tags set from `d`. */
export function rewriteDetailsLine(line: string, d: Pick<CardDetails, 'due' | 'start' | 'owner' | 'tags'>, keys: { start: boolean }): string {
  const prefix = ITEM_PREFIX.exec(line)?.[0] ?? '';
  const rest = line.slice(prefix.length);
  const attrMatch = /\s*\{([^{}]*)\}\s*$/.exec(rest);
  const withoutAttrs = attrMatch ? rest.slice(0, attrMatch.index) : rest;
  const title = withoutAttrs.replace(TAG, '').replace(/\s+/g, ' ').trim();
  const tags = d.tags.split(/[\s,]+/).map((t) => t.replace(/^#/, '').trim()).filter(Boolean);
  const set = new Map(pairs(attrMatch?.[1] ?? ''));
  const apply = (key: string, value: string) => {
    if (value.trim()) set.set(key, quote(value.trim()));
    else set.delete(key);
  };
  apply('due', d.due);
  if (keys.start) apply('start', d.start);
  apply('owner', d.owner);
  const attrs = set.size ? ` {${[...set].map(([k, v]) => `${k}=${v}`).join(' ')}}` : '';
  return `${prefix}${[title, ...tags.map((t) => `#${t}`)].join(' ')}${attrs}`;
}

/** The first line's text under the bullet is the title; body lines are indented to line up under it. */
function bodyIndent(line: string): string {
  const m = ITEM_PREFIX.exec(line);
  return m ? `${m[1] ?? ''}${' '.repeat((m[2] ?? '').length + (m[3] ?? '').length)}` : '  ';
}

/** Current details of a card, as the form shows them. */
export function detailsOf(lines: string[], card: KanbanCard): CardDetails {
  const first = lines[card.line] ?? '';
  const indent = bodyIndent(first);
  const body = lines.slice(card.line + 1, card.endLine + 1).map((l) => (l.startsWith(indent) ? l.slice(indent.length) : l.trimStart()));
  while (body.length && body[body.length - 1]?.trim() === '') body.pop();
  return { due: card.due ?? '', start: card.start ?? '', owner: card.owner ?? '', tags: card.tags.map((t) => `#${t}`).join(' '), body: body.join('\n') };
}

function cardsOf(source: string, kind: string, boardLine: number): { lines: string[]; cards: KanbanCard[] } | null {
  const doc = parse(source);
  let found: ContainerBlock | null = null;
  walkBlocks(doc.blocks, (b) => {
    if (!found && b.type === 'container' && b.name === kind && b.line === boardLine) found = b;
  });
  if (!found) return null;
  if (kind === 'kanban') return { lines: doc.lines, cards: buildBoard(found).columns.flatMap((c) => c.cards) };
  if (kind === 'calendar') return { lines: doc.lines, cards: buildCalendarCards(found).cards };
  if (kind === 'timeline') return { lines: doc.lines, cards: buildTimeline(found).groups.flatMap((g) => g.cards) };
  return null;
}

export function setCardDetails(source: string, kind: string, boardLine: number, ref: CardRef, d: CardDetails): LineEdit | null {
  const found = cardsOf(source, kind, boardLine);
  const card = found?.cards.find((c) => c.line === ref.line);
  if (!found || !card || hashText(cardSource(found.lines, card)) !== ref.hash) return null;
  if (d.due && !/^\d{4}-\d{2}-\d{2}$/.test(d.due.trim())) return null;
  if (d.start && !/^\d{4}-\d{2}-\d{2}$/.test(d.start.trim())) return null;
  const first = rewriteDetailsLine(found.lines[card.line] ?? '', d, { start: kind === 'timeline' });
  const indent = bodyIndent(found.lines[card.line] ?? '');
  const body = d.body.replace(/\s+$/, '').split('\n').filter((l, i, all) => !(all.length === 1 && l === '')).map((l) => (l.trim() ? `${indent}${l}` : ''));
  const text = [first, ...body].join('\n');
  const old = found.lines.slice(card.line, card.endLine + 1);
  while (old.length > 1 && old[old.length - 1]?.trim() === '') old.pop();
  const oldEnd = card.line + old.length - 1;
  return text === old.join('\n') ? null : { startLine: card.line, endLine: oldEnd, text };
}
