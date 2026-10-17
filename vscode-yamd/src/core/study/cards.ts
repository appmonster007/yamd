/**
 * Flashcards (§6.4): `:::card` blocks, `::card[Q]{a="A"}` lines and `:cloze[answer]` deletions are
 * collected into cards, and a spaced-repetition schedule (SM-2) decides when each is due.
 * Everything here is pure; the extension keeps the schedule in a JSON file.
 */
import { attrString } from '../attrs';
import { hashText } from '../kanban';
import { walkBlocks } from '../parser';
import type { Block, Diagnostic, InlineNode, YamdDocument } from '../types';

export interface Card {
  /** Stable across moves: an explicit `{#id}`, or a hash of the card's text. */
  id: string;
  kind: 'qa' | 'cloze';
  /** YAMD source shown first. */
  front: string;
  /** YAMD source shown after the answer is revealed. */
  back: string;
  /** First source line (0-based). */
  line: number;
  path: string;
  /** The note's `course` front matter, if any. */
  course?: string;
}

const CLOZE = /:cloze\[((?:[^\]\\]|\\.)*)\](?:\{([^}]*)\})?/g;

function hasCloze(nodes: InlineNode[]): boolean {
  return nodes.some((n) => {
    if (n.type === 'directive' && n.name === 'cloze') return true;
    if ('children' in n && Array.isArray(n.children)) return hasCloze(n.children);
    return false;
  });
}

/** The group a cloze belongs to: `{n=2}` or its position among the paragraph's clozes. */
function groups(text: string): { group: string; start: number; end: number; answer: string }[] {
  const found: { group: string; start: number; end: number; answer: string }[] = [];
  let i = 0;
  for (const m of text.matchAll(CLOZE)) {
    i++;
    const n = /\bn=(\w+)/.exec(m[2] ?? '')?.[1];
    found.push({ group: n ?? String(i), start: m.index, end: m.index + m[0].length, answer: m[1] ?? '' });
  }
  return found;
}

/** The paragraph with one group hidden as `[…]` and the others shown as plain text. */
export function clozeFront(text: string, group: string): string {
  let out = '';
  let last = 0;
  for (const c of groups(text)) {
    out += text.slice(last, c.start) + (c.group === group ? '**[…]**' : c.answer);
    last = c.end;
  }
  return out + text.slice(last);
}

/** The paragraph with the hidden group shown in bold. */
export function clozeBack(text: string, group: string): string {
  let out = '';
  let last = 0;
  for (const c of groups(text)) {
    out += text.slice(last, c.start) + (c.group === group ? `**${c.answer}**` : c.answer);
    last = c.end;
  }
  return out + text.slice(last);
}

const slice = (doc: YamdDocument, from: number, to: number) => doc.lines.slice(from, to + 1).join('\n').trim();

/** Cards in one note, plus a `Y605` diagnostic for each card without an answer. */
export function extractCards(doc: YamdDocument, path: string): { cards: Card[]; diagnostics: Diagnostic[] } {
  const cards: Card[] = [];
  const diagnostics: Diagnostic[] = [];
  const course = typeof doc.frontMatter?.data['course'] === 'string' ? (doc.frontMatter.data['course'] as string) : undefined;
  const push = (c: Omit<Card, 'path' | 'course'>) => cards.push({ ...c, path, ...(course ? { course } : {}) });
  const lineRange = (line: number) => {
    const start = doc.lineStarts[line] ?? 0;
    return { start, end: start + (doc.lines[line]?.length ?? 0) };
  };

  walkBlocks(doc.blocks, (b: Block) => {
    if (b.type === 'container' && b.name === 'card') {
      const split = b.children.find((c) => c.type === 'thematicBreak');
      const closed = /^\s*:{3,}\s*$/.test(doc.lines[b.endLine] ?? '');
      const last = closed ? b.endLine - 1 : b.endLine;
      const front = split ? slice(doc, b.line + 1, split.line - 1) : slice(doc, b.line + 1, last);
      const back = split ? slice(doc, split.endLine + 1, last) : '';
      if (!split || !back) {
        diagnostics.push({ code: 'Y605', severity: 'warning', message: 'This card has no answer. Put a --- line between the question and the answer.', range: lineRange(b.line) });
        return;
      }
      push({ id: b.attrs?.id ?? `c${hashText(front)}`, kind: 'qa', front, back, line: b.line });
    } else if (b.type === 'leaf' && b.name === 'card') {
      const back = attrString(b.attrs, 'a') ?? attrString(b.attrs, 'answer');
      if (!back) {
        diagnostics.push({ code: 'Y605', severity: 'warning', message: 'This card has no answer. Add {a="…"}.', range: lineRange(b.line) });
        return;
      }
      push({ id: b.attrs?.id ?? `c${hashText(b.rawLabel)}`, kind: 'qa', front: b.rawLabel, back, line: b.line });
    } else if (b.type === 'paragraph' && hasCloze(b.children)) {
      const text = slice(doc, b.line, b.endLine);
      const seen = new Set<string>();
      for (const g of groups(text)) {
        if (seen.has(g.group)) continue;
        seen.add(g.group);
        push({ id: `z${hashText(text.replace(CLOZE, '$1'))}.${g.group}`, kind: 'cloze', front: clozeFront(text, g.group), back: clozeBack(text, g.group), line: b.line });
      }
    }
  });
  return { cards, diagnostics };
}

// ---- Scheduling ----

export type Grade = 'again' | 'hard' | 'good' | 'easy';
export const GRADES: Grade[] = ['again', 'hard', 'good', 'easy'];

export interface CardState {
  /** Next review date, `YYYY-MM-DD`. */
  due: string;
  /** Days between the last two reviews. */
  interval: number;
  ease: number;
  /** Successful reviews in a row. */
  reps: number;
  lapses: number;
  last: string;
}

const MIN_EASE = 1.3;

export function addDays(date: string, days: number): string {
  const d = new Date(`${date}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
}

export function daysBetween(from: string, to: string): number {
  return Math.round((Date.parse(`${to}T00:00:00Z`) - Date.parse(`${from}T00:00:00Z`)) / 86_400_000);
}

/** The state after answering with `grade` (SM-2, with a "hard" grade and an easy bonus). */
export function review(state: CardState | undefined, grade: Grade, today: string): CardState {
  const prev = state ?? { due: today, interval: 0, ease: 2.5, reps: 0, lapses: 0, last: today };
  let { ease, reps, lapses, interval } = prev;
  if (grade === 'again') {
    // A forgotten card comes back today, and its interval starts over.
    return { due: today, interval: 0, ease: Math.max(MIN_EASE, ease - 0.2), reps: 0, lapses: lapses + 1, last: today };
  }
  if (reps === 0) interval = grade === 'easy' ? 4 : 1;
  else if (reps === 1) interval = grade === 'hard' ? 3 : grade === 'easy' ? 8 : 6;
  else if (grade === 'hard') interval = Math.max(prev.interval + 1, Math.round(prev.interval * 1.2));
  else interval = Math.max(prev.interval + 1, Math.round(prev.interval * ease * (grade === 'easy' ? 1.3 : 1)));
  if (grade === 'hard') ease = Math.max(MIN_EASE, ease - 0.15);
  if (grade === 'easy') ease += 0.15;
  reps += 1;
  return { due: addDays(today, interval), interval, ease: Math.round(ease * 100) / 100, reps, lapses, last: today };
}

/** The interval each grade would give, for the buttons ("1d", "6d"). */
export function previewIntervals(state: CardState | undefined, today: string): Record<Grade, number> {
  const out = {} as Record<Grade, number>;
  for (const g of GRADES) out[g] = daysBetween(today, review(state, g, today).due);
  return out;
}

export interface Schedule {
  version: 1;
  cards: Record<string, CardState>;
}

export function parseSchedule(text: string | undefined): Schedule {
  try {
    const data = text ? (JSON.parse(text) as Partial<Schedule>) : undefined;
    if (data && typeof data === 'object' && data.cards && typeof data.cards === 'object') return { version: 1, cards: data.cards };
  } catch {
    // A damaged file starts a fresh schedule.
  }
  return { version: 1, cards: {} };
}

export function stringifySchedule(s: Schedule): string {
  const sorted = Object.fromEntries(Object.entries(s.cards).sort(([a], [b]) => a.localeCompare(b)));
  return `${JSON.stringify({ version: 1, cards: sorted }, null, 1)}\n`;
}

export interface Queue {
  due: Card[];
  fresh: Card[];
  /** Cards reviewed and not yet due. */
  later: number;
}

/** Cards to study today: due ones first (oldest first), then up to `newLimit` unseen ones. */
export function buildQueue(cards: Card[], schedule: Schedule, today: string, newLimit = 20, course?: string): Queue {
  const pool = course ? cards.filter((c) => c.course === course) : cards;
  const due: Card[] = [];
  const fresh: Card[] = [];
  let later = 0;
  const seen = new Set<string>();
  for (const c of pool) {
    if (seen.has(c.id)) continue;
    seen.add(c.id);
    const s = schedule.cards[c.id];
    if (!s) fresh.push(c);
    else if (s.due <= today) due.push(c);
    else later++;
  }
  due.sort((a, b) => (schedule.cards[a.id]?.due ?? '').localeCompare(schedule.cards[b.id]?.due ?? ''));
  return { due, fresh: fresh.slice(0, newLimit), later };
}

/** Drops the schedule of cards that no longer exist in any note. */
export function pruneSchedule(schedule: Schedule, liveIds: Set<string>): Schedule {
  return { version: 1, cards: Object.fromEntries(Object.entries(schedule.cards).filter(([id]) => liveIds.has(id))) };
}
