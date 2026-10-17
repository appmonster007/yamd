import { attrNumber, attrString } from './attrs';
import type { Attrs, Block, ContainerBlock, InlineNode, ListItem } from './types';

export interface KanbanCard {
  /** Title inlines (the item's first line), with tags removed. */
  title: InlineNode[];
  /** Inlines from the rest of the item's first paragraph. */
  bodyInline: InlineNode[];
  /** Blocks after the item's first paragraph. */
  body: Block[];
  tags: string[];
  done: boolean;
  hasCheckbox: boolean;
  attrs?: Attrs;
  due?: string;
  owner?: string;
  line: number;
  endLine: number;
}

export interface KanbanColumn {
  title: InlineNode[];
  attrs?: Attrs;
  limit?: number;
  complete: boolean;
  /** Non-list blocks under the heading, shown as the column description. */
  description: Block[];
  cards: KanbanCard[];
  line: number;
  /** Last line of the column's content (the heading line when it is empty). */
  endLine: number;
}

export interface KanbanBoard {
  title?: string;
  /** Blocks before the first column heading (reported as Y603). */
  preamble: Block[];
  columns: KanbanColumn[];
  /** The `:::kanban` line and the closing `:::` line (or last line when unclosed). */
  line: number;
  endLine: number;
}

const TAG = /(^|\s)#([\p{L}\p{N}_/-]*[\p{L}_/-][\p{L}\p{N}_/-]*)(?=\s|$)/gu;

/** Removes `#tags` from text nodes and returns them. */
function extractTags(nodes: InlineNode[]): { nodes: InlineNode[]; tags: string[] } {
  const tags: string[] = [];
  const out = nodes.map((n): InlineNode => {
    if (n.type === 'tag') {
      tags.push(n.name);
      return { type: 'text', value: '', range: n.range };
    }
    if (n.type !== 'text') return n;
    const value = n.value.replace(TAG, (_m, lead: string, tag: string) => {
      tags.push(tag);
      return lead;
    });
    return { ...n, value };
  });
  const kept = out.filter((n) => !(n.type === 'text' && n.value === ''));
  // Trim whitespace left at the end of the title.
  const last = kept[kept.length - 1];
  if (last?.type === 'text') kept[kept.length - 1] = { ...last, value: last.value.replace(/\s+$/, '') };
  return { nodes: kept.filter((n) => !(n.type === 'text' && n.value === '')), tags };
}

function card(item: ListItem): KanbanCard {
  const [first, ...rest] = item.children;
  let titleNodes: InlineNode[] = [];
  let bodyInline: InlineNode[] = [];
  let body = item.children;
  if (first?.type === 'paragraph') {
    const br = first.children.findIndex((n) => n.type === 'break');
    titleNodes = br === -1 ? first.children : first.children.slice(0, br);
    bodyInline = br === -1 ? [] : first.children.slice(br + 1);
    body = rest;
  }
  const { nodes, tags } = extractTags(titleNodes);
  return {
    title: nodes,
    bodyInline,
    body,
    tags,
    done: item.task === 'done',
    hasCheckbox: item.task !== undefined,
    attrs: item.attrs,
    due: attrString(item.attrs, 'due'),
    owner: attrString(item.attrs, 'owner'),
    line: item.line,
    endLine: item.endLine,
  };
}

/** Builds the board model from a `:::kanban` container. */
export function buildBoard(container: ContainerBlock): KanbanBoard {
  const board: KanbanBoard = {
    title: attrString(container.attrs, 'title'),
    preamble: [],
    columns: [],
    line: container.line,
    endLine: container.endLine,
  };
  let column: KanbanColumn | undefined;
  for (const b of container.children) {
    if (b.type === 'heading') {
      column = {
        title: b.children,
        attrs: b.attrs,
        limit: attrNumber(b.attrs, 'limit'),
        complete: b.attrs?.values['complete'] === true,
        description: [],
        cards: [],
        line: b.line,
        endLine: b.line,
      };
      board.columns.push(column);
    } else if (!column) {
      board.preamble.push(b);
    } else {
      if (b.type === 'list') column.cards.push(...b.items.map(card));
      else column.description.push(b);
      column.endLine = Math.max(column.endLine, b.endLine);
    }
  }
  return board;
}

/** FNV-1a hash used to check that a card's source hasn't changed since it was rendered. */
export function hashText(text: string): string {
  let h = 0x811c9dc5;
  for (let i = 0; i < text.length; i++) {
    h ^= text.charCodeAt(i);
    h = Math.imul(h, 0x01000193);
  }
  return (h >>> 0).toString(36);
}

/** The source text of a card, for hashing. */
export function cardSource(lines: string[], c: { line: number; endLine: number }): string {
  return lines.slice(c.line, c.endLine + 1).join('\n');
}
