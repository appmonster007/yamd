/**
 * One entry point for every edit made from a rendered board or task checkbox. The preview sends a
 * `boardEdit` message; this turns it into the text change for the source, or `null` when the source
 * no longer matches what the preview showed.
 */
import { addCalendarCard, moveCalendarCard, renameCalendarCard } from './calendarEdit';
import { addGalleryCard, moveGalleryCard } from './galleryEdit';
import { addCard, moveCard, renameCard, toggleTask } from './kanbanEdit';
import type { CardRef, LineEdit } from './kanbanEdit';
import { addTimelineCard, moveTimelineCard, renameTimelineCard } from './timelineEdit';

type BoardKind = 'task' | 'kanban' | 'calendar' | 'timeline' | 'gallery';
type BoardOp = 'toggle' | 'move' | 'add' | 'rename';

/** A card as the preview saw it: its first line and the hash of its source when rendered. */
export type { CardRef };

export interface BoardEditMessage {
  type: 'boardEdit';
  kind: BoardKind;
  op: BoardOp;
  /** First line of the board (unused for tasks). */
  board: number;
  card?: CardRef;
  args: Record<string, unknown>;
  /** Path of an embedded note the element came from; without it, the previewed note. */
  source?: string;
}

type Args = Record<string, unknown>;
type Handler = (source: string, board: number, card: CardRef | undefined, a: Args) => LineEdit | null;

const str = (v: unknown) => (typeof v === 'string' ? v : '');
const num = (v: unknown) => (typeof v === 'number' && Number.isFinite(v) ? v : 0);

const HANDLERS: Record<string, Handler> = {
  'task.toggle': (s, _b, c, a) => (c ? toggleTask(s, c.line, c.hash, a['done'] === true) : null),
  'kanban.move': (s, b, c, a) => (c ? moveCard(s, b, c, num(a['toColumn']), num(a['toIndex'])) : null),
  'kanban.add': (s, b, _c, a) => addCard(s, b, num(a['column']), str(a['text'])),
  'kanban.rename': (s, b, c, a) => (c ? renameCard(s, b, c, str(a['title'])) : null),
  'calendar.move': (s, b, c, a) => (c ? moveCalendarCard(s, b, c, str(a['toDate'])) : null),
  'calendar.add': (s, b, _c, a) => addCalendarCard(s, b, str(a['date']), str(a['text'])),
  'calendar.rename': (s, b, c, a) => (c ? renameCalendarCard(s, b, c, str(a['title'])) : null),
  'timeline.move': (s, b, c, a) => (c ? moveTimelineCard(s, b, c, num(a['toGroup']), str(a['newStart'])) : null),
  'timeline.add': (s, b, _c, a) =>
    addTimelineCard(s, b, typeof a['group'] === 'number' ? a['group'] : null, str(a['text']), str(a['today']) || new Date().toISOString().slice(0, 10)),
  'timeline.rename': (s, b, c, a) => (c ? renameTimelineCard(s, b, c, str(a['title'])) : null),
  'gallery.move': (s, b, c, a) => (c ? moveGalleryCard(s, b, c, num(a['toIndex'])) : null),
  'gallery.add': (s, b, _c, a) => addGalleryCard(s, b, str(a['image']), str(a['caption'])),
};

export function computeBoardEdit(source: string, m: Pick<BoardEditMessage, 'kind' | 'op' | 'board' | 'card' | 'args'>): LineEdit | null {
  return HANDLERS[`${m.kind}.${m.op}`]?.(source, m.board, m.card, m.args) ?? null;
}
