/**
 * Live preview: which parts of a note's source an editor should hide, restyle or replace so it reads
 * rendered, with the syntax shown again where the cursor is (as in Obsidian). Pure functions over a
 * parsed note, kept free of `vscode` so they can be unit-tested; the extension turns the result into
 * editor decorations.
 */
import { walkBlocks } from './parser';
import type { Block, InlineNode, ListBlock, YamdDocument } from './types';

export type StyleKey =
  | 'h1' | 'h2' | 'h3' | 'h4' | 'h5' | 'h6'
  | 'bold' | 'italic' | 'boldItalic' | 'underline' | 'strike' | 'highlight' | 'sub' | 'sup'
  | 'code' | 'link' | 'math' | 'tag' | 'ref'
  | 'dim' | 'taskDone';

export type LineStyleKey = 'quote' | 'codeLine' | 'mathLine' | 'container' | 'rule';

export type Deco =
  /** Syntax characters that are hidden while the cursor is away from `reveal`. */
  | { kind: 'hide'; start: number; end: number; reveal: [number, number] }
  /** Styling for a span of text; always applied. */
  | { kind: 'style'; start: number; end: number; style: StyleKey }
  /** Styling for the whole line containing `start`; always applied. */
  | { kind: 'line'; start: number; line: LineStyleKey }
  /** A glyph shown in place of hidden syntax (a bullet, a checkbox), while the cursor is away from `reveal`. */
  | { kind: 'glyph'; start: number; glyph: string; reveal: [number, number] };

const HEADING_PREFIX = /^([\s>]*(?:[-*+]\s+|\d{1,9}[.)]\s+)?)(#{1,6})[ \t]+/;
const QUOTE_PREFIX = /^(?:[ \t]*>[ \t]?)+/;
const ITEM_PREFIX = /^([ \t>]*)([-*+]|\d{1,9}[.)])([ \t]+)(\[[ xX]\][ \t]+)?/;

const EMPHASIS_STYLE: Record<string, StyleKey> = {
  italic: 'italic',
  bold: 'bold',
  boldItalic: 'boldItalic',
  underline: 'underline',
  strike: 'strike',
  highlight: 'highlight',
  sub: 'sub',
  sup: 'sup',
};

/** Computes every decoration for a parsed note. Offsets are absolute positions in `doc.source`. */
export function computeDecorations(doc: YamdDocument): Deco[] {
  const out: Deco[] = [];
  const lineStart = (line: number) => doc.lineStarts[line] ?? 0;
  const lineEnd = (line: number) => lineStart(line) + (doc.lines[line]?.length ?? 0);
  const lineRange = (a: number, b = a): [number, number] => [lineStart(a), lineEnd(b)];

  if (doc.frontMatter) {
    for (let l = doc.frontMatter.line; l <= doc.frontMatter.endLine; l++) {
      if (lineEnd(l) > lineStart(l)) out.push({ kind: 'style', start: lineStart(l), end: lineEnd(l), style: 'dim' });
    }
  }

  const inline = (nodes: InlineNode[]) => {
    for (const n of nodes) inlineNode(n);
  };

  const wrapped = (n: { range: { start: number; end: number } }, children: InlineNode[], style?: StyleKey) => {
    const first = children[0];
    const last = children[children.length - 1];
    if (!first || !last || first.range.start < n.range.start || last.range.end > n.range.end) return;
    const reveal: [number, number] = [n.range.start, n.range.end];
    if (first.range.start > n.range.start) out.push({ kind: 'hide', start: n.range.start, end: first.range.start, reveal });
    if (n.range.end > last.range.end) out.push({ kind: 'hide', start: last.range.end, end: n.range.end, reveal });
    if (style && last.range.end > first.range.start) out.push({ kind: 'style', start: first.range.start, end: last.range.end, style });
  };

  const inlineNode = (n: InlineNode) => {
    switch (n.type) {
      case 'emphasis':
        wrapped(n, n.children, EMPHASIS_STYLE[n.kind]);
        inline(n.children);
        break;
      case 'link':
        if (n.kind === 'auto') out.push({ kind: 'style', start: n.range.start, end: n.range.end, style: 'link' });
        else {
          wrapped(n, n.children, 'link');
          inline(n.children);
        }
        break;
      case 'code': {
        const text = doc.source.slice(n.range.start, n.range.end);
        const ticks = /^`+/.exec(text)?.[0].length ?? 0;
        if (ticks && text.length > ticks * 2) {
          const reveal: [number, number] = [n.range.start, n.range.end];
          out.push({ kind: 'hide', start: n.range.start, end: n.range.start + ticks, reveal });
          out.push({ kind: 'hide', start: n.range.end - ticks, end: n.range.end, reveal });
          out.push({ kind: 'style', start: n.range.start + ticks, end: n.range.end - ticks, style: 'code' });
        }
        break;
      }
      case 'math':
        out.push({ kind: 'style', start: n.range.start, end: n.range.end, style: 'math' });
        break;
      case 'embed':
        out.push({ kind: 'style', start: n.range.start, end: n.range.end, style: 'link' });
        break;
      case 'tag':
        out.push({ kind: 'style', start: n.range.start, end: n.range.end, style: 'tag' });
        break;
      case 'crossRef':
      case 'citation':
      case 'footnoteRef':
        out.push({ kind: 'style', start: n.range.start, end: n.range.end, style: 'ref' });
        break;
      case 'span':
      case 'inlineFootnote':
      case 'directive':
        inline(n.children);
        break;
      default:
        break;
    }
  };

  const listItems = (b: ListBlock) => {
    for (const item of b.items) {
      const text = doc.lines[item.line] ?? '';
      const m = ITEM_PREFIX.exec(text);
      if (!m) continue;
      const base = lineStart(item.line);
      const indent = m[1]?.length ?? 0;
      const marker = m[2] ?? '';
      const reveal = lineRange(item.line);
      if (item.task) {
        // The bullet and the `[ ]` become one checkbox glyph.
        const end = base + m[0].length;
        out.push({ kind: 'hide', start: base + indent, end, reveal });
        out.push({ kind: 'glyph', start: base + indent, glyph: item.task === 'done' ? '☑ ' : '☐ ', reveal });
        if (item.task === 'done') out.push({ kind: 'style', start: end, end: lineEnd(item.line), style: 'taskDone' });
      } else if (!b.ordered) {
        out.push({ kind: 'hide', start: base + indent, end: base + indent + marker.length, reveal });
        out.push({ kind: 'glyph', start: base + indent, glyph: '•', reveal });
      }
    }
  };

  const block = (b: Block) => {
    switch (b.type) {
      case 'heading': {
        const m = HEADING_PREFIX.exec(doc.lines[b.line] ?? '');
        const start = lineStart(b.line);
        if (m) {
          const at = start + (m[1]?.length ?? 0);
          out.push({ kind: 'hide', start: at, end: start + m[0].length, reveal: lineRange(b.line) });
          out.push({ kind: 'style', start: start + m[0].length, end: lineEnd(b.line), style: `h${Math.min(b.level, 6)}` as StyleKey });
        }
        inline(b.children);
        break;
      }
      case 'paragraph':
        inline(b.children);
        break;
      case 'table':
        for (const cell of b.header) inline(cell.children);
        for (const row of b.rows) for (const cell of row) inline(cell.children);
        break;
      case 'list':
        listItems(b);
        break;
      case 'blockquote':
        for (let l = b.line; l <= b.endLine; l++) {
          const m = QUOTE_PREFIX.exec(doc.lines[l] ?? '');
          if (m) out.push({ kind: 'hide', start: lineStart(l), end: lineStart(l) + m[0].length, reveal: lineRange(l) });
          out.push({ kind: 'line', start: lineStart(l), line: 'quote' });
        }
        break;
      case 'code':
        for (let l = b.line; l <= b.endLine; l++) out.push({ kind: 'line', start: lineStart(l), line: 'codeLine' });
        out.push({ kind: 'style', start: lineStart(b.line), end: lineEnd(b.line), style: 'dim' });
        if (b.closed && b.endLine > b.line) out.push({ kind: 'style', start: lineStart(b.endLine), end: lineEnd(b.endLine), style: 'dim' });
        break;
      case 'math':
        for (let l = b.line; l <= b.endLine; l++) out.push({ kind: 'line', start: lineStart(l), line: 'mathLine' });
        break;
      case 'container':
        for (let l = b.line; l <= b.endLine; l++) out.push({ kind: 'line', start: lineStart(l), line: 'container' });
        out.push({ kind: 'style', start: lineStart(b.line), end: lineEnd(b.line), style: 'dim' });
        if (b.endLine > b.line) out.push({ kind: 'style', start: lineStart(b.endLine), end: lineEnd(b.endLine), style: 'dim' });
        break;
      case 'thematicBreak':
        out.push({ kind: 'hide', start: lineStart(b.line), end: lineEnd(b.line), reveal: lineRange(b.line) });
        out.push({ kind: 'line', start: lineStart(b.line), line: 'rule' });
        break;
      default:
        break;
    }
  };

  walkBlocks(doc.blocks, block);
  return out.filter((d) => ('end' in d ? d.end > d.start : true));
}

/**
 * Drops the hide and glyph decorations the cursor or selection touches, so that syntax shows where
 * the note is being edited. Touching is inclusive, so a cursor right next to a marker reveals it.
 */
export function applyReveal(decos: Deco[], selections: { start: number; end: number }[]): Deco[] {
  return decos.filter((d) => {
    if (d.kind !== 'hide' && d.kind !== 'glyph') return true;
    return !selections.some((s) => s.start <= d.reveal[1] && s.end >= d.reveal[0]);
  });
}
