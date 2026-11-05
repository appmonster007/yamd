/** Text for the insert commands: callouts, figure and table targets, and widgets made from a selection. */
import { PLAIN_TYPES, STUDY_TYPES, typeLabel } from '../build/callouts';
import { scanFences } from '../widgets/fences';
import { suggestId } from '../widgets/widgetLint';

export interface CalloutChoice {
  type: string;
  label: string;
  description: string;
}

const DESCRIPTIONS: Record<string, string> = {
  definition: 'Numbered; a term and its meaning',
  theorem: 'Numbered; a statement',
  lemma: 'Numbered; a helper result',
  proof: 'Numbered; an argument',
  example: 'Numbered; a worked example',
  question: 'Numbered; something to answer',
  remark: 'Numbered; a side note',
  summary: 'Numbered; a recap',
  derivation: 'Numbered; steps of a calculation',
  note: 'A plain note',
  tip: 'A tip',
  important: 'Something important',
  warning: 'A warning',
  caution: 'A caution',
  danger: 'A danger',
  card: 'A flashcard: the title is the question, the body the answer',
};

export const CALLOUT_CHOICES: CalloutChoice[] = [...STUDY_TYPES, ...PLAIN_TYPES].map((type) => ({ type, label: typeLabel(type), description: DESCRIPTIONS[type] ?? '' }));

const slug = (text: string) =>
  text
    .toLowerCase()
    .replace(/[^\p{L}\p{N}]+/gu, '-')
    .replace(/^-|-$/g, '')
    .slice(0, 30);

/** `thm-euclid`: the prefix plus a slug of the text, made unique among `taken`. */
export function idFrom(prefix: string, text: string, taken: Iterable<string>): string {
  const used = new Set(taken);
  const base = `${prefix}-${slug(text) || 'x'}`;
  if (!used.has(base)) return base;
  for (let n = 2; ; n++) if (!used.has(`${base}-${n}`)) return `${base}-${n}`;
}

const PREFIX: Record<string, string> = { definition: 'def', theorem: 'thm', lemma: 'lem', proof: 'prf', example: 'ex', question: 'q', remark: 'rem', summary: 'sum', derivation: 'der' };

/** A callout ready to type into. Study callouts get a `^id` so they can be referred to. */
export function calloutBlock(type: string, title: string, taken: Iterable<string> = []): string {
  const prefix = PREFIX[type];
  const id = prefix && title.trim() ? ` ^${idFrom(prefix, title, taken)}` : '';
  return `> [!${type}]${title.trim() ? ` ${title.trim()}` : ''}${id}\n> `;
}

/** A figure with its caption as alt text and a `^fig-…` target below it. */
export function figureBlock(caption: string, imagePath: string, taken: Iterable<string>): string {
  const id = idFrom('fig', caption, taken);
  return `![${caption.replace(/[[\]]/g, '')}](${imagePath.split('/').map(encodeURIComponent).join('/')})\n\n^${id}`;
}

export function tableBlock(caption: string, taken: Iterable<string>): string {
  const id = idFrom('tbl', caption, taken);
  return `Table: ${caption}\n\n| Column | Column |\n| ------ | ------ |\n|        |        |\n\n^${id}`;
}

export function equationBlock(label: string, taken: Iterable<string>): string {
  const id = idFrom('eq', label, taken);
  return `$$\n\n$$\n\n^${id}`;
}

export type SelectionWidget = 'kanban' | 'calendar' | 'timeline' | 'gallery';

/**
 * Wraps selected text in a widget fence with a free id. A board needs a column, so a selection that
 * has no heading gets `## Todo` first.
 */
export function selectionToWidget(selected: string, type: SelectionWidget, existingText: string): string {
  const taken = scanFencesIds(existingText);
  const id = suggestId(type, taken);
  let body = selected.replace(/^\n+|\s+$/g, '');
  if (type === 'kanban' && !/^#{1,6}\s/m.test(body)) body = `## Todo\n${body}`;
  // A fence inside the selection must not close ours.
  const ticks = '`'.repeat(Math.max(3, longestFence(body) + 1));
  return `${ticks}${type} ${id}\n${body}\n${ticks}`;
}

function longestFence(text: string): number {
  return Math.max(0, ...[...text.matchAll(/^[ \t]*(`{3,})/gm)].map((m) => (m[1] as string).length));
}

function scanFencesIds(text: string): string[] {
  return scanFences(text.split('\n')).flatMap((f) => (f.id === undefined ? [] : [f.id]));
}
