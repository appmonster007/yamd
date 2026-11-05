/** HTML for kanban boards and the calendar, timeline and gallery boards. */
import { plainText } from './inline';
import { cardSource, hashText } from '../widgets/kanban';
import type { CalendarBoard, GalleryBoard, TimelineBoard } from '../widgets/kanban';
import type { KanbanBoard, KanbanCard } from '../widgets/kanban';
import { cardTitleSource } from '../widgets/kanbanEdit';
import { escapeHtml, today, isoWeek } from './renderUtil';
import type { RenderOptions } from './render';
import type { Block, InlineNode, YamdDocument } from './types';

/** What the board renderers need from the renderer that calls them. */
export interface BoardContext {
  doc: YamdDocument;
  options: RenderOptions;
  blocks(blocks: Block[]): string;
  checkbox(line: number, done: boolean): string;
  image(n: Extract<InlineNode, { type: 'image' }>, inFigure?: boolean): string;
  inline(nodes: InlineNode[]): string;
}

export function renderBoard(ctx: BoardContext, board: KanbanBoard): string {
  const interactive = Boolean(ctx.options.interactive);
  const now = ctx.options.today ?? today();
  const source = ctx.options.sourcePath ? ` data-source="${escapeHtml(ctx.options.sourcePath)}"` : '';
  const columns = board.columns.map((col, ci) => {
    const count = col.cards.length;
    const over = col.limit !== undefined && count > col.limit;
    const classes = ['kanban-column', over ? 'over-limit' : '', col.complete ? 'complete' : ''].filter(Boolean).join(' ');
    const titleText = escapeHtml(plainText(col.title));
    const countText = col.limit !== undefined ? `${count}/${col.limit}` : `${count}`;
    const cards = col.cards.map((card, i) => renderCard(ctx, card, i, now, interactive)).join('\n');
    const description = col.description.length ? `<div class="kanban-column-description">${ctx.blocks(col.description)}</div>` : '';
    const add = interactive
      ? `<form class="kanban-add" data-column="${ci}"><input type="text" class="kanban-add-input" placeholder="Add card" aria-label="Add a card to ${titleText}"></form>`
      : '';
    return `<section class="${classes}" data-column="${ci}" data-line="${col.line}" aria-label="${titleText}">
<header class="kanban-column-header"><button type="button" class="kanban-collapse" aria-expanded="true" aria-label="Collapse ${titleText}">▾</button><span class="kanban-column-title">${ctx.inline(col.title)}</span><span class="kanban-count${over ? ' over' : ''}" title="${over ? 'Over the work-in-progress limit' : 'Cards'}">${countText}</span></header>
${description}<div class="kanban-cards" data-column="${ci}">${cards}</div>${add}
</section>`;
  });
  const title = board.title ? `<div class="kanban-title">${escapeHtml(board.title)}</div>` : '';
  const mode = interactive ? ' data-interactive' : '';
  return `<div class="kanban" data-line="${board.line}" data-board="${board.line}"${source}${mode}>${title}<div class="kanban-columns">\n${columns.join('\n')}\n</div></div>`;
}

function renderCard(ctx: BoardContext, card: KanbanCard, index: number, now: string, interactive: boolean): string {
  const overdue = card.due !== undefined && !card.done && card.due < now;
  const chips = card.tags.map((t) => `<span class="tag">#${escapeHtml(t)}</span>`).join('');
  const due = card.due ? `<span class="kanban-due${overdue ? ' overdue' : ''}" title="${overdue ? 'Overdue' : 'Due'}">${escapeHtml(card.due)}</span>` : '';
  const owner = card.owner ? `<span class="kanban-owner">@${escapeHtml(card.owner)}</span>` : '';
  const meta = chips || due || owner ? `<div class="kanban-card-meta">${chips}${due}${owner}</div>` : '';
  const bodyInline = card.bodyInline.length ? `<p>${ctx.inline(card.bodyInline)}</p>` : '';
  const bodyBlocks = card.body.length ? ctx.blocks(card.body) : '';
  const body = bodyInline || bodyBlocks ? `<div class="kanban-card-body">${bodyInline}${bodyBlocks}</div>` : '';
  const box = card.hasCheckbox ? `${ctx.checkbox(card.line, card.done)} ` : '';
  const hash = hashText(cardSource(ctx.doc.lines, card));
  const titleSource = escapeHtml(cardTitleSource(ctx.doc.lines[card.line] ?? ''));
  const drag = interactive ? ' draggable="true"' : '';
  const label = escapeHtml(plainText(card.title));
  return `<article class="kanban-card${card.done ? ' done' : ''}${overdue ? ' overdue' : ''}" tabindex="0"${drag} data-line="${card.line}" data-index="${index}" data-hash="${hash}" aria-label="${label}"><div class="kanban-card-title">${box}<span class="kanban-card-text" data-title="${titleSource}">${ctx.inline(card.title)}</span></div>${meta}${body}</article>`;
}

/** `:::calendar` is sugar for an implicit database rendered as a calendar (§6.2.1); a card with
 * no `{due=...}` isn't shown (Y606, reported by the linter, not here). */
const MONTH_NAMES = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];

/**
 * The month a calendar opens on: the next one with an event (counting today's), else the last one
 * that has any, else today's. An empty month would look like a broken widget.
 */
export function defaultMonth(cards: { due?: string }[], now: string): string {
  const months = [...new Set(cards.map((c) => c.due?.slice(0, 7)).filter((m): m is string => !!m && /^\d{4}-\d{2}$/.test(m)))].sort();
  const current = now.slice(0, 7);
  return months.find((m) => m >= current) ?? months[months.length - 1] ?? current;
}

export function renderCalendar(ctx: BoardContext, board: CalendarBoard): string {
  const interactive = Boolean(ctx.options.interactive);
  const source = ctx.options.sourcePath ? ` data-source="${escapeHtml(ctx.options.sourcePath)}"` : '';
  const now = ctx.options.today ?? today();
  const eventHtml = (c: KanbanCard): string => {
    const hash = hashText(cardSource(ctx.doc.lines, c));
    const drag = interactive ? ' draggable="true"' : '';
    const box = c.hasCheckbox ? `${ctx.checkbox(c.line, c.done)} ` : '';
    const titleSource = escapeHtml(cardTitleSource(ctx.doc.lines[c.line] ?? ''));
    const chips = c.tags.map((t) => `<span class="tag">#${escapeHtml(t)}</span>`).join('');
    const owner = c.owner ? `<span class="kanban-owner">@${escapeHtml(c.owner)}</span>` : '';
    const meta = chips || owner ? `<div class="kanban-card-meta">${chips}${owner}</div>` : '';
    const bodyInline = c.bodyInline.length ? `<p>${ctx.inline(c.bodyInline)}</p>` : '';
    const bodyBlocks = c.body.length ? ctx.blocks(c.body) : '';
    const detail = meta || bodyInline || bodyBlocks ? `<div class="db-event-detail">${bodyInline}${bodyBlocks}${meta}</div>` : '';
    return `<div class="db-event" tabindex="0" data-line="${c.line}" data-hash="${hash}" data-title="${titleSource}"${drag}><div class="db-event-summary">${box}${ctx.inline(c.title)}</div>${detail}</div>`;
  };
  interface Cell {
    html: string;
    iso?: string;
  }
  /** One month as a grid of weeks. `nav` adds the previous/next/today buttons the widget panel uses. */
  const grid = (month: string, nav: boolean): string => {
    const [y, m] = month.split('-').map(Number) as [number, number];
    const first = new Date(Date.UTC(y, m - 1, 1));
    const days = new Date(Date.UTC(y, m, 0)).getUTCDate();
    const offset = (first.getUTCDay() + 6) % 7;
    const byDay = new Map<number, KanbanCard[]>();
    for (const c of board.cards) {
      if (!c.due?.startsWith(month)) continue;
      const d = Number(c.due.slice(8, 10));
      byDay.set(d, [...(byDay.get(d) ?? []), c]);
    }
    const cells: Cell[] = [];
    for (let i = 0; i < offset; i++) cells.push({ html: '<div class="db-day empty"></div>' });
    for (let d = 1; d <= days; d++) {
      const iso = `${month}-${String(d).padStart(2, '0')}`;
      const items = (byDay.get(d) ?? []).map(eventHtml).join('');
      const add = interactive
        ? `<form class="kanban-add" data-date="${iso}"><input type="text" class="kanban-add-input" placeholder="Add" aria-label="Add a card on ${iso}"></form>`
        : '';
      cells.push({
        html: `<div class="db-day${iso === now ? ' today' : ''}" data-date="${iso}"><button type="button" class="db-day-number">${d}</button>${items}${add}</div>`,
        iso,
      });
    }
    while (cells.length % 7 !== 0) cells.push({ html: '<div class="db-day empty"></div>' });
    const weeks: string[] = [];
    for (let i = 0; i < cells.length; i += 7) {
      const week = cells.slice(i, i + 7);
      const firstIso = week.find((c) => c.iso)?.iso;
      const label = firstIso
        ? `<button type="button" class="db-week-number" data-week="${isoWeek(firstIso)}">Wk ${isoWeek(firstIso)}</button>`
        : '<span class="db-week-number empty"></span>';
      weeks.push(`<div class="db-week">${label}${week.map((c) => c.html).join('')}</div>`);
    }
    const weekdays = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'].map((w) => `<div class="db-weekday">${w}</div>`).join('');
    const titleText = `${MONTH_NAMES[m - 1]} ${y}`;
    const buttons = nav
      ? `<button type="button" class="db-month-nav" data-delta="-1" aria-label="Previous month">\u2039</button><button type="button" class="db-month-nav" data-delta="0">Today</button><button type="button" class="db-month-nav" data-delta="1" aria-label="Next month">\u203a</button>`
      : '';
    const agenda = `<div class="db-agenda" hidden><div class="db-agenda-header"><span class="db-agenda-title"></span><button type="button" class="db-agenda-close" aria-label="Close list">Close</button></div><div class="db-agenda-list"></div></div>`;
    return `<div class="db-calendar" data-month="${month}"><div class="db-calendar-header"><span class="db-month-title">${titleText}</span>${buttons}</div><div class="db-calendar-weekdays"><span class="db-week-number"></span>${weekdays}</div>${weeks.join('')}${agenda}</div>`;
  };
  // The widget panel shows one month at a time (with buttons to move); a static page lists every month that has events.
  const requested = ctx.options.month;
  const withEvents = [...new Set(board.cards.map((c) => c.due?.slice(0, 7)).filter((m): m is string => !!m && /^\d{4}-\d{2}$/.test(m)))].sort();
  const months = interactive ? [requested ?? defaultMonth(board.cards, now)] : requested ? [requested] : withEvents.length ? withEvents : [now.slice(0, 7)];
  const title = board.title ? `<div class="kanban-title">${escapeHtml(board.title)}</div>` : '';
  const mode = interactive ? ' data-interactive' : '';
  return `<div class="kanban-calendar" data-line="${board.line}" data-board="${board.line}"${mode}${source}>${title}${months.map((month) => grid(month, interactive)).join('')}</div>`;
}

/** `:::timeline` is a calendar stretched into bars via `{start=...}`/`{due=...}`; headings are
 * optional groups. A card with no `{start=...}` isn't shown (Y606, reported by the linter). */
export function renderTimeline(ctx: BoardContext, board: TimelineBoard): string {
  const interactive = Boolean(ctx.options.interactive);
  const source = ctx.options.sourcePath ? ` data-source="${escapeHtml(ctx.options.sourcePath)}"` : '';
  interface Item {
    card: KanbanCard;
    start: string;
    end: string;
  }
  const byLine = new Map<number, Item>();
  for (const g of board.groups) {
    for (const c of g.cards) {
      if (!c.start) continue;
      byLine.set(c.line, { card: c, start: c.start, end: c.due && c.due >= c.start ? c.due : c.start });
    }
  }
  const title = board.title ? `<div class="kanban-title">${escapeHtml(board.title)}</div>` : '';
  const mode = interactive ? ' data-interactive' : '';
  const items = [...byLine.values()];
  if (!items.length && !interactive) {
    return `<div class="kanban-timeline" data-line="${board.line}" data-board="${board.line}"${mode}${source}><div class="db-timeline db-empty">No dated cards.</div></div>`;
  }
  const time = (d: string) => new Date(d).getTime();
  const min = items.length ? Math.min(...items.map((i) => time(i.start))) : time(ctx.options.today ?? today());
  const max = items.length ? Math.max(...items.map((i) => time(i.end))) : min + 86400000 * 30;
  const span = Math.max(max - min, 86400000);
  const toDate = (t: number) => new Date(t).toISOString().slice(0, 10);
  const pct = (t: number) => ((t - min) / span) * 100;
  const bar = (i: Item) => {
    const left = pct(time(i.start));
    const width = Math.max(pct(time(i.end)) - left, 1.5);
    const label = escapeHtml(plainText(i.card.title));
    const box = i.card.hasCheckbox ? `${ctx.checkbox(i.card.line, i.card.done)} ` : '';
    const hash = hashText(cardSource(ctx.doc.lines, i.card));
    const drag = interactive ? ' draggable="true"' : '';
    const titleSource = escapeHtml(cardTitleSource(ctx.doc.lines[i.card.line] ?? ''));
    return `<div class="db-timeline-bar" tabindex="0" data-line="${i.card.line}" data-hash="${hash}" data-start="${i.start}" data-title="${titleSource}"${drag} style="left:${left}%;width:${width}%" title="${label}">${box}${ctx.inline(i.card.title)}</div>`;
  };
  // A month scale above the lanes, with a mark for today when it falls inside the range.
  const ticks: string[] = [];
  const startDate = new Date(min);
  const firstTick = Date.UTC(startDate.getUTCFullYear(), startDate.getUTCMonth() + (startDate.getUTCDate() === 1 ? 0 : 1), 1);
  ticks.push(`<span class="db-timeline-tick" style="left:0%">${MONTH_NAMES[startDate.getUTCMonth()]?.slice(0, 3)} ${startDate.getUTCFullYear()}</span>`);
  for (let t = firstTick; t <= max; t = Date.UTC(new Date(t).getUTCFullYear(), new Date(t).getUTCMonth() + 1, 1)) {
    if (t <= min) continue;
    const d = new Date(t);
    ticks.push(`<span class="db-timeline-tick" style="left:${pct(t)}%">${MONTH_NAMES[d.getUTCMonth()]?.slice(0, 3)}${d.getUTCMonth() === 0 ? ` ${d.getUTCFullYear()}` : ''}</span>`);
  }
  const nowTime = time(ctx.options.today ?? today());
  const todayMark = items.length && nowTime >= min && nowTime <= max ? `<span class="db-timeline-today" style="left:${pct(nowTime)}%" title="Today"></span>` : '';
  const axis = items.length ? `<div class="db-timeline-axis"><span class="db-timeline-label"></span><div class="db-timeline-scale">${ticks.join('')}${todayMark}</div></div>` : '';
  const rows = board.groups
    .map((g, gi) => {
      const bars = g.cards.map((c) => byLine.get(c.line)).filter((i): i is Item => i !== undefined).map(bar).join('');
      if (!bars && !interactive) return '';
      const label = g.title ? ctx.inline(g.title) : '';
      const add = interactive
        ? `<form class="kanban-add" data-group="${gi}"><input type="text" class="kanban-add-input" placeholder="Add" aria-label="Add a card to ${label || 'this lane'}"></form>`
        : '';
      return `<div class="db-timeline-row" data-group="${gi}"><span class="db-timeline-label">${label}</span><div class="db-timeline-track">${bars}</div>${add}</div>`;
    })
    .filter(Boolean)
    .join('');
  const globalAdd =
    interactive && board.groups.length === 0
      ? `<form class="kanban-add" data-group=""><input type="text" class="kanban-add-input" placeholder="Add a card" aria-label="Add a card"></form>`
      : '';
  return `<div class="kanban-timeline" data-line="${board.line}" data-board="${board.line}"${mode}${source}>${title}<div class="db-timeline" data-start="${toDate(min)}" data-end="${toDate(max)}">${axis}${rows}</div>${globalAdd}</div>`;
}

/** `:::gallery` is sugar for an implicit database rendered as a gallery (§6.2.1): each image
 * starts a card, and the paragraph(s) following it are its caption. */
export function renderGallery(ctx: BoardContext, board: GalleryBoard): string {
  const interactive = Boolean(ctx.options.interactive);
  const source = ctx.options.sourcePath ? ` data-source="${escapeHtml(ctx.options.sourcePath)}"` : '';
  const title = board.title ? `<div class="kanban-title">${escapeHtml(board.title)}</div>` : '';
  const mode = interactive ? ' data-interactive' : '';
  const cards = board.cards
    .map((c) => {
      const chips = c.tags.map((t) => `<span class="tag">#${escapeHtml(t)}</span>`).join('');
      const meta = chips ? `<div class="kanban-card-meta">${chips}</div>` : '';
      const bodyInline = c.bodyInline.length ? `<p>${ctx.inline(c.bodyInline)}</p>` : '';
      const bodyBlocks = c.body.length ? ctx.blocks(c.body) : '';
      // A list item's alt text is its caption; an image with its own caption paragraph shows that instead.
      const caption = !bodyInline && !bodyBlocks && c.image.alt ? `<p class="db-card-caption">${escapeHtml(c.image.alt)}</p>` : '';
      const hash = hashText(cardSource(ctx.doc.lines, c));
      const drag = interactive ? ' draggable="true"' : '';
      return `<article class="db-card" tabindex="0" data-line="${c.line}" data-hash="${hash}"${drag}>${ctx.image(c.image)}<div class="db-card-body">${caption}${bodyInline}${bodyBlocks}${meta}</div></article>`;
    })
    .join('\n');
  const add = interactive
    ? `<form class="gallery-add"><input type="text" class="gallery-add-image" placeholder="Image path" aria-label="New image path"><input type="text" class="gallery-add-caption" placeholder="Caption" aria-label="New image caption"><button type="submit">Add</button></form>`
    : '';
  return `<div class="kanban-gallery" data-line="${board.line}" data-board="${board.line}"${mode}${source}>${title}<div class="db-gallery">${cards}</div>${add}</div>`;
}
