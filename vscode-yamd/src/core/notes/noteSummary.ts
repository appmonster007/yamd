/** What one note contains: its links, headings, tags and properties. */
import { posix } from 'node:path';
import { plainText } from '../markdown/inline';
import { parse, walkBlocks } from '../markdown/parser';
import type { Block, InlineNode, Range, YamdDocument } from '../markdown/types';
import { stripNoteExt, splitTarget } from './noteResolve';

interface NoteLink {
  kind: 'wiki' | 'embed' | 'markdown';
  /** The target as written, without `|label`. */
  target: string;
  file: string;
  heading?: string;
  blockId?: string;
  /** The whole link in the source. */
  range: Range;
  /** The file part of the target in the source, for rename edits. */
  fileRange: Range;
  line: number;
  /** The source line the link is on, trimmed and shortened, for listing backlinks without the note's text. */
  snippet: string;
}

interface NoteHeading {
  text: string;
  id: string;
  level: number;
  line: number;
}

export interface NoteSummary {
  path: string;
  title: string;
  aliases: string[];
  tags: string[];
  headings: NoteHeading[];
  blocks: { id: string; line: number }[];
  links: NoteLink[];
  tasks: { line: number; done: boolean; text: string }[];
  properties: Record<string, unknown>;
}

const SCHEME = /^[a-z][a-z0-9+.-]*:/i;

function lineOf(doc: YamdDocument, offset: number): number {
  let lo = 0;
  let hi = doc.lineStarts.length - 1;
  while (lo < hi) {
    const mid = (lo + hi + 1) >> 1;
    if ((doc.lineStarts[mid] ?? 0) <= offset) lo = mid;
    else hi = mid - 1;
  }
  return lo;
}

function stringList(value: unknown): string[] {
  if (typeof value === 'string') return value.split(',').map((s) => s.trim()).filter(Boolean);
  if (Array.isArray(value)) return value.filter((v) => typeof v === 'string' || typeof v === 'number').map(String);
  return [];
}

/** Inline content owned directly by a block. */
export function blockInlines(b: Block): InlineNode[][] {
  switch (b.type) {
    case 'paragraph':
    case 'heading':
      return [b.children];
    case 'table':
      return [...b.header, ...b.rows.flat()].map((c) => c.children);
    case 'leaf':
      return [b.label];
    default:
      return [];
  }
}

export function walkInline(nodes: InlineNode[], visit: (n: InlineNode) => void) {
  for (const n of nodes) {
    visit(n);
    if ('children' in n && Array.isArray(n.children)) walkInline(n.children, visit);
  }
}

/** Every inline node in a document, including footnotes. */
function eachInline(doc: YamdDocument, visit: (n: InlineNode) => void): void {
  const roots = [...doc.blocks, ...[...doc.footnotes.values()].flatMap((f) => f.children)];
  walkBlocks(roots, (b) => blockInlines(b).forEach((nodes) => walkInline(nodes, visit)));
}

/** Links and embeds in a document, with the source range of each target's file part. */
function noteLinks(doc: YamdDocument): NoteLink[] {
  const links: NoteLink[] = [];
  const src = doc.source;
  eachInline(doc, (n) => {
    if (n.type === 'link' && n.kind === 'wiki') {
      const inner = src.slice(n.range.start + 2, n.range.end - 2);
      const target = (inner.split('|')[0] ?? '').trim();
      const lead = inner.length - inner.trimStart().length;
      const parts = splitTarget(target);
      const start = n.range.start + 2 + lead;
      links.push({ kind: 'wiki', target, ...parts, range: n.range, fileRange: { start, end: start + parts.file.length }, line: lineOf(doc, n.range.start), snippet: '' });
    } else if (n.type === 'embed') {
      const inner = src.slice(n.range.start + 3, n.range.end - 2);
      const lead = inner.length - inner.trimStart().length;
      const start = n.range.start + 3 + lead;
      links.push({
        kind: 'embed',
        target: n.target,
        file: n.file,
        heading: n.heading,
        blockId: n.blockId,
        range: n.range,
        fileRange: { start, end: start + n.file.length },
        line: lineOf(doc, n.range.start),
        snippet: '',
      });
    } else if ((n.type === 'link' && n.kind === 'inline') || (n.type === 'image' && n.label === undefined)) {
      const href = n.type === 'link' ? n.href : n.src;
      if (!href || SCHEME.test(href) || href.startsWith('#') || href.startsWith('//')) return;
      const raw = src.slice(n.range.start, n.range.end);
      const open = raw.lastIndexOf('](');
      if (open === -1) return;
      const destStart = n.range.start + open + 2 + (/^\s*<?/.exec(raw.slice(open + 2))?.[0].length ?? 0);
      const written = /^[^\s#)>]*/.exec(src.slice(destStart))?.[0] ?? '';
      let file = written;
      try {
        file = decodeURIComponent(written);
      } catch {
        // Keep it as written.
      }
      const anchor = href.includes('#') ? href.slice(href.indexOf('#') + 1) : undefined;
      links.push({
        kind: 'markdown',
        target: href,
        file,
        heading: anchor && !anchor.startsWith('^') ? anchor : undefined,
        blockId: anchor?.startsWith('^') ? anchor.slice(1) : undefined,
        range: n.range,
        fileRange: { start: destStart, end: destStart + written.length },
        line: lineOf(doc, n.range.start),
        snippet: '',
      });
    }
  });
  for (const l of links) l.snippet = (doc.lines[l.line] ?? '').trim().slice(0, 200);
  return links;
}

/** Builds the index summary of one note. */
export function summarize(path: string, text: string, parsed?: YamdDocument): NoteSummary {
  const doc = parsed ?? parse(text);
  const fm = doc.frontMatter?.data ?? {};
  const headings: NoteHeading[] = [];
  const blocks: { id: string; line: number }[] = [];
  const tasks: NoteSummary['tasks'] = [];
  walkBlocks(doc.blocks, (b) => {
    if (b.type === 'heading' && !b.inBoard) headings.push({ text: plainText(b.children).trim(), id: b.id, level: b.level, line: b.line });
    if (b.type === 'paragraph' && b.blockId) blocks.push({ id: b.blockId, line: b.line });
    if (b.type === 'list') {
      for (const item of b.items) {
        const first = item.children[0];
        if (item.task) tasks.push({ line: item.line, done: item.task === 'done', text: first?.type === 'paragraph' ? plainText(first.children).trim() : '' });
      }
    }
  });
  const tags = new Set(stringList(fm['tags']).map((t) => t.replace(/^#/, '')));
  eachInline(doc, (n) => {
    if (n.type === 'tag') tags.add(n.name);
  });
  const fmTitle = typeof fm['title'] === 'string' ? fm['title'] : undefined;
  const firstHeading = headings[0]?.text;
  const title = fmTitle ?? (firstHeading && !firstHeading.includes('{{') ? firstHeading : undefined) ?? stripNoteExt(posix.basename(path));
  return {
    path,
    title,
    aliases: stringList(fm['aliases'] ?? fm['alias']),
    tags: [...tags],
    headings,
    blocks,
    links: noteLinks(doc),
    tasks,
    properties: fm,
  };
}
