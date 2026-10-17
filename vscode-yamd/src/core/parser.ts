/**
 * YAMD parser: GFM (via micromark and mdast) plus YAMD's own syntax, converted into YAMD's block
 * and inline types with source positions.
 */
import { directiveFromMarkdown } from 'mdast-util-directive';
import { fromMarkdown } from 'mdast-util-from-markdown';
import { frontmatterFromMarkdown } from 'mdast-util-frontmatter';
import { gfmFromMarkdown } from 'mdast-util-gfm';
import { mathFromMarkdown } from 'mdast-util-math';
import { directive } from 'micromark-extension-directive';
import { frontmatter } from 'micromark-extension-frontmatter';
import { gfm } from 'micromark-extension-gfm';
import { math } from 'micromark-extension-math';
import { parse as micromarkParse, postprocess, preprocess } from 'micromark';
import { attrNumber, mergeAttrs, parseAttrBlock, parseAttrs } from './attrs';
import { extractFrontMatter, lookupVariable } from './frontmatter';
import { KNOWN_INLINE_DIRECTIVES, plainText } from './inline';
import { yamdFromMarkdown } from './micromark/mdast';
import { yamdSyntax } from './micromark/syntax';
import { SlugRegistry, slugify } from './slug';
import type { Align, Attrs, Block, Diagnostic, FootnoteDef, InlineNode, ListItem, Range, RefDef, TableCell, YamdDocument } from './types';

export const KNOWN_CONTAINERS = new Set([
  'note',
  'tip',
  'warning',
  'danger',
  'details',
  'columns',
  'column',
  'figure',
  'table',
  'html',
  'kanban',
]);
export const KNOWN_LEAVES = new Set(['toc', 'include', 'pagebreak', 'embed', 'bibliography', 'db']);

/* eslint-disable @typescript-eslint/no-explicit-any */
/** An mdast node, including YAMD's custom node types. */
type MNode = any;

const EXTENSIONS = [frontmatter(['yaml']), gfm(), { flow: math().flow }, { flow: directive().flow }, yamdSyntax()];
const MDAST_EXTENSIONS = [
  frontmatterFromMarkdown(['yaml']),
  gfmFromMarkdown(),
  mathFromMarkdown(),
  directiveFromMarkdown(),
  yamdFromMarkdown(),
];

function toMdast(source: string): MNode {
  return fromMarkdown(source, { extensions: EXTENSIONS, mdastExtensions: MDAST_EXTENSIONS });
}

/** Tokens for YAMD syntax that GFM reads as text. Math is left out: GitHub renders `$` math too. */
const YAMD_ONLY_TOKENS = new Set([
  'yamdVariable',
  'yamdCritic',
  'yamdAttributes',
  'yamdAttributesFlow',
  'yamdComment',
  'yamdCitation',
  'yamdWikilink',
  'yamdEmbed',
  'yamdTag',
  'yamdBlockId',
  'yamdScript',
  'yamdInlineFootnote',
  'yamdTextDirective',
  'yamdMark',
  'yamdIns',
  'directiveContainer',
  'directiveLeaf',
]);

/**
 * Source offsets where YAMD-only syntax starts (the first character of each construct), used to
 * escape Markdown that YAMD would otherwise read differently.
 */
export function yamdSyntaxOffsets(source: string): number[] {
  const rawLines = source.split('\n');
  const prepared = prepareLines(rawLines);
  const offsets = new Set<number>();
  const lineStarts: number[] = [];
  let at = 0;
  for (const line of rawLines) {
    lineStarts.push(at);
    at += line.length + 1;
  }
  for (const n of prepared.commentOpeners) offsets.add((lineStarts[n] ?? 0) + (rawLines[n] ?? '').indexOf('%'));
  const events = postprocess(
    micromarkParse({ extensions: EXTENSIONS }).document().write(preprocess()(prepared.text.join('\n'), undefined, true)),
  );
  for (const [kind, token] of events) {
    if (kind === 'enter' && YAMD_ONLY_TOKENS.has(token.type)) offsets.add(token.start.offset);
  }
  return [...offsets].sort((a, b) => a - b);
}

const DIRECTIVE_LINE = /^(\s*)(:{2,})([A-Za-z][\w-]*)(\[[^\]\n]*\])?([ \t]*)(\{[^{}\n]*\})?([ \t]*)$/;
const FENCE_LINE = /^\s{0,3}(`{3,}|~{3,})/;

const COMMENT_OPEN = /^ {0,3}%%/;

/** True when a `%%` opening line also closes, with text after it (an inline comment instead). */
function closesInline(line: string): boolean {
  const rest = line.replace(COMMENT_OPEN, '');
  const close = rest.indexOf('%%');
  return close >= 0 && rest.slice(close + 2).trim() !== '';
}

/**
 * Rewrites lines before micromark sees them, keeping every offset:
 * - micromark's directive syntax doesn't allow a space before `{attrs}` and has its own attribute
 *   rules, so directive lines keep only `:::name` or `::name[label]` and their attributes are
 *   parsed with YAMD's rules instead.
 * - `%%` block comments (a line starting with `%%` to a line ending with `%%`) become blank lines.
 */
function prepareLines(lines: string[]): {
  text: string[];
  attrs: Map<number, Attrs | undefined>;
  comments: Set<number>;
  /** First line of each block comment. */
  commentOpeners: number[];
} {
  const attrs = new Map<number, Attrs | undefined>();
  const comments = new Set<number>();
  const commentOpeners: number[] = [];
  let fence: string | null = null;
  let inComment = false;
  const blank = (line: string, n: number) => {
    comments.add(n);
    return line.replace(/[^\r]/g, ' ');
  };
  const text = lines.map((line, n) => {
    if (inComment) {
      if (/%%\s*\r?$/.test(line)) inComment = false;
      return blank(line, n);
    }
    const f = FENCE_LINE.exec(line);
    if (f) {
      const marker = f[1] ?? '';
      if (fence === null) fence = marker;
      else if (marker[0] === fence[0] && marker.length >= fence.length && line.trim() === marker) fence = null;
      return line;
    }
    if (fence !== null) return line;
    if (COMMENT_OPEN.test(line) && !closesInline(line)) {
      const rest = line.replace(COMMENT_OPEN, '');
      inComment = !/%%\s*\r?$/.test(rest);
      commentOpeners.push(n);
      return blank(line, n);
    }
    const m = DIRECTIVE_LINE.exec(line);
    if (!m || !m[6]) return line;
    attrs.set(n, parseAttrBlock(m[6]) ?? undefined);
    const keep = (m[1] ?? '') + (m[2] ?? '') + (m[3] ?? '') + (m[4] ?? '');
    return keep + ' '.repeat(line.length - keep.length);
  });
  return { text, attrs, comments, commentOpeners };
}

class Adapter {
  readonly diagnostics: Diagnostic[] = [];
  readonly footnotes = new Map<string, FootnoteDef>();
  readonly refs = new Map<string, RefDef>();
  readonly verbatim = new Set<number>();

  constructor(
    readonly source: string,
    readonly lines: string[],
    readonly directiveAttrs: Map<number, Attrs | undefined>,
  ) {}

  private startLine(n: MNode): number {
    return (n.position?.start.line ?? 1) - 1;
  }

  private endLine(n: MNode): number {
    return (n.position?.end.line ?? 1) - 1;
  }

  private range(n: MNode, base = 0): Range {
    return { start: (n.position?.start.offset ?? 0) + base, end: (n.position?.end.offset ?? 0) + base };
  }

  private markVerbatim(n: MNode) {
    for (let l = this.startLine(n); l <= this.endLine(n); l++) this.verbatim.add(l);
  }

  blocks(nodes: MNode[]): Block[] {
    const out: Block[] = [];
    let pending: Attrs | undefined;
    let pendingLine = -2;
    for (const n of nodes) {
      switch (n.type) {
        case 'yaml':
          this.markVerbatim(n);
          continue;
        case 'definition': {
          const id = String(n.identifier);
          if (!this.refs.has(id)) this.refs.set(id, { url: n.url ?? '', title: n.title ?? undefined });
          continue;
        }
        case 'footnoteDefinition': {
          const id = String(n.identifier);
          if (!this.footnotes.has(id)) {
            this.footnotes.set(id, { id, children: this.blocks(n.children ?? []), line: this.startLine(n) });
          }
          continue;
        }
        case 'yamdAttributesFlow': {
          const raw = String(n.value).trim();
          pending = mergeAttrs(pending, parseAttrs(raw.slice(1, -1)) ?? undefined);
          pendingLine = this.endLine(n);
          continue;
        }
        default:
          break;
      }
      const b = this.block(n);
      if (!b) continue;
      // Attributes apply only to the block directly below them.
      if (pending && pendingLine === b.line - 1) {
        b.attrs = mergeAttrs(pending, b.attrs);
        if (b.type === 'list') b.start = attrNumber(b.attrs, 'start') ?? b.start;
      }
      pending = undefined;
      out.push(b);
    }
    return out;
  }

  private block(n: MNode): Block | null {
    const line = this.startLine(n);
    const endLine = this.endLine(n);
    switch (n.type) {
      case 'paragraph': {
        const children = this.inline(n.children ?? []);
        const blockId = takeBlockId(children);
        return {
          type: 'paragraph',
          children,
          rawLines: this.lines.slice(line, endLine + 1).map((l) => l.trim()),
          blockId,
          line,
          endLine,
        };
      }
      case 'heading': {
        const children = this.inline(n.children ?? []);
        const attrs = takeTrailingAttrs(children);
        return { type: 'heading', level: n.depth, children, id: '', attrs, line, endLine };
      }
      case 'thematicBreak':
        return { type: 'thematicBreak', line, endLine };
      case 'blockquote':
        return { type: 'blockquote', children: this.blocks(n.children ?? []), line, endLine };
      case 'list':
        return this.list(n);
      case 'code':
        return this.code(n);
      case 'math': {
        this.markVerbatim(n);
        return { type: 'math', value: n.value ?? '', attrs: n.meta ? (parseAttrBlock(n.meta) ?? undefined) : undefined, line, endLine };
      }
      case 'html':
        this.markVerbatim(n);
        return { type: 'html', value: n.value ?? '', line, endLine };
      case 'table':
        return this.table(n);
      case 'containerDirective':
        return this.container(n);
      case 'leafDirective':
        return this.leaf(n);
      default:
        return null;
    }
  }

  private list(n: MNode): Block {
    const line = this.startLine(n);
    const first = this.lines[line] ?? '';
    const marker = /^\s*(?:([-*+])|\d{1,9}([.)]))/.exec(first);
    const items: ListItem[] = (n.children ?? []).map((item: MNode) => {
      const children = this.blocks(item.children ?? []);
      let attrs: Attrs | undefined;
      // Attributes at the end of an item's first line belong to the item.
      const p = children[0];
      if (p?.type === 'paragraph' && p.line === this.startLine(item)) attrs = takeFirstLineAttrs(p.children);
      return {
        line: this.startLine(item),
        endLine: this.endLine(item),
        task: item.checked === true ? 'done' : item.checked === false ? 'open' : undefined,
        attrs,
        spread: Boolean(item.spread),
        children,
      };
    });
    return {
      type: 'list',
      ordered: Boolean(n.ordered),
      start: n.start ?? 1,
      spread: Boolean(n.spread) || items.some((it) => it.spread),
      marker: marker?.[1] ?? marker?.[2] ?? '-',
      items,
      line,
      endLine: this.endLine(n),
    };
  }

  private code(n: MNode): Block {
    const line = this.startLine(n);
    const endLine = this.endLine(n);
    this.markVerbatim(n);
    const opening = /^\s*(`{3,}|~{3,})/.exec(this.lines[line] ?? '');
    let closed = true;
    if (opening) {
      const fence = opening[1] ?? '```';
      const last = (this.lines[endLine] ?? '').trim();
      closed = endLine > line && last.length >= fence.length && [...last].every((c) => c === fence[0]);
      if (!closed) {
        const start = this.range(n).start;
        this.diagnostics.push({
          code: 'Y501',
          severity: 'error',
          message: `Code fence is never closed. Add a closing ${fence} line.`,
          range: { start, end: start + (this.lines[line] ?? '').trimEnd().length - (/^\s*/.exec(this.lines[line] ?? '')?.[0].length ?? 0) },
        });
      }
    }
    const meta = String(n.meta ?? '').trim();
    const attrs = meta ? (parseAttrBlock(meta) ?? undefined) : undefined;
    return { type: 'code', lang: n.lang ?? '', value: n.value ?? '', closed, attrs, line, endLine };
  }

  private table(n: MNode): Block {
    const rows: TableCell[][] = (n.children ?? []).map((row: MNode) =>
      (row.children ?? []).map((cell: MNode) => {
        const children = this.inline(cell.children ?? []);
        return { children, attrs: takeTrailingAttrs(children) };
      }),
    );
    const align: Align[] = (n.align ?? []).map((a: string | null) => (a === 'left' || a === 'right' || a === 'center' ? a : null));
    return {
      type: 'table',
      align,
      header: rows[0] ?? [],
      rows: rows.slice(1),
      line: this.startLine(n),
      endLine: this.endLine(n),
    };
  }

  private unknownDirective(name: string, start: number, prefix: string) {
    this.diagnostics.push({
      code: 'Y601',
      severity: 'warning',
      message: `Unknown directive "${prefix}${name}". Its content is shown as normal text.`,
      range: { start, end: start + name.length },
    });
  }

  private nameOffset(n: MNode): number {
    const line = this.startLine(n);
    const text = this.lines[line] ?? '';
    const m = /^\s*:+/.exec(text);
    return (n.position?.start.offset ?? 0) - (n.position?.start.column ?? 1) + 1 + (m?.[0].length ?? 0);
  }

  private container(n: MNode): Block {
    const line = this.startLine(n);
    const endLine = this.endLine(n);
    const name = String(n.name);
    if (!KNOWN_CONTAINERS.has(name)) this.unknownDirective(name, this.nameOffset(n), ':::');
    const attrs = this.directiveAttrs.get(line);
    const closed = endLine > line && /^\s*:{3,}\s*$/.test(this.lines[endLine] ?? '');
    const raw = this.lines.slice(line + 1, closed ? endLine : endLine + 1).join('\n');
    if (name === 'html') {
      this.markVerbatim(n);
      return { type: 'container', name, children: [], raw, attrs, line, endLine };
    }
    // The directive's label paragraph (from `:::name[label]`) is ignored; YAMD uses attributes.
    const content = (n.children ?? []).filter((c: MNode) => !(c.type === 'paragraph' && c.data?.directiveLabel));
    return { type: 'container', name, children: this.blocks(content), raw, attrs, line, endLine };
  }

  private leaf(n: MNode): Block {
    const line = this.startLine(n);
    const name = String(n.name);
    if (!KNOWN_LEAVES.has(name)) this.unknownDirective(name, this.nameOffset(n), '::');
    const rawLabel = /^\s*::[A-Za-z][\w-]*\[([^\]\n]*)\]/.exec(this.lines[line] ?? '')?.[1] ?? '';
    return {
      type: 'leaf',
      name,
      rawLabel,
      label: this.inline(n.children ?? []),
      attrs: this.directiveAttrs.get(line),
      line,
      endLine: this.endLine(n),
    };
  }

  /**
   * Splits text at newlines into text and soft breaks. Each break's range runs from the end of the
   * line's text (before trailing spaces) to the start of the next line's text (after any `>` or
   * indentation), so replacing it joins the lines.
   */
  private splitBreaks(value: string, range: Range): InlineNode[] {
    if (!value.includes('\n')) return value ? [{ type: 'text', value, range }] : [];
    const raw = this.source.slice(range.start, range.end);
    // Newlines from character references (`&#10;`) are text, not line breaks.
    if (raw.split('\n').length !== value.split('\n').length) return [{ type: 'text', value, range }];
    const out: InlineNode[] = [];
    let from = range.start;
    let search = 0;
    value.split('\n').forEach((part, i) => {
      if (i > 0) {
        const nl = raw.indexOf('\n', search);
        const lineEnd = nl < 0 ? raw.length : nl;
        search = lineEnd + 1;
        const prefix = /^[ \t]*(?:>[ \t]?)*[ \t]*/.exec(raw.slice(search))?.[0].length ?? 0;
        const textEnd = range.start + lineEnd - (/[ \t]*\r?$/.exec(raw.slice(0, lineEnd))?.[0].length ?? 0);
        const prev = out[out.length - 1];
        if (prev?.type === 'text') prev.range = { start: prev.range.start, end: textEnd };
        out.push({ type: 'break', soft: true, range: { start: textEnd, end: range.start + search + prefix } });
        from = range.start + search + prefix;
      }
      if (part) out.push({ type: 'text', value: part, range: { start: from, end: range.end } });
    });
    return out;
  }

  /** Parses inline content of a raw span, with positions shifted to the original source. */
  private fragment(text: string, base: number): InlineNode[] {
    const tree = toMdast(text);
    const nodes: MNode[] = [];
    for (const c of tree.children ?? []) {
      if (c.type === 'paragraph') {
        if (nodes.length) nodes.push({ type: 'text', value: '\n', position: c.position });
        nodes.push(...(c.children ?? []));
      }
    }
    return this.inline(nodes, base);
  }

  inline(nodes: MNode[], base = 0): InlineNode[] {
    const out: InlineNode[] = [];
    for (const n of nodes) out.push(...this.inlineNode(n, base));
    return attachAttributes(out);
  }

  private inlineNode(n: MNode, base: number): InlineNode[] {
    const range = this.range(n, base);
    const kids = () => this.inline(n.children ?? [], base);
    const value = String(n.value ?? '');
    switch (n.type) {
      case 'text':
        return this.splitBreaks(value, range);
      case 'emphasis':
        return [{ type: 'emphasis', kind: 'italic', children: kids(), range }];
      case 'strong':
        return [{ type: 'emphasis', kind: 'bold', children: kids(), range }];
      case 'delete':
        return [{ type: 'emphasis', kind: 'strike', children: kids(), range }];
      case 'yamdMark':
        return [{ type: 'emphasis', kind: 'highlight', children: kids(), range }];
      case 'yamdIns':
        return [{ type: 'emphasis', kind: 'underline', children: kids(), range }];
      case 'inlineCode':
        return [{ type: 'code', value: value.replace(/\r?\n/g, ' '), range }];
      case 'break':
        return [{ type: 'break', range }];
      case 'html':
        return [{ type: 'html', value, range }];
      case 'link': {
        const children = kids();
        const text = plainText(children);
        const url = String(n.url ?? '');
        const auto = text === url || `mailto:${text}` === url || `http://${text}` === url;
        return [{ type: 'link', kind: auto ? 'auto' : 'inline', href: url, title: n.title ?? undefined, children, range }];
      }
      case 'linkReference':
        return [{ type: 'link', kind: 'reference', href: '', label: String(n.identifier), children: kids(), range }];
      case 'image':
        return [{ type: 'image', src: String(n.url ?? ''), alt: String(n.alt ?? ''), title: n.title ?? undefined, range }];
      case 'imageReference':
        return [{ type: 'image', src: '', label: String(n.identifier), alt: String(n.alt ?? ''), range }];
      case 'footnoteReference':
        return [{ type: 'footnoteRef', id: String(n.identifier), range }];
      case 'yamdVariable': {
        const path = value.slice(2, -2).trim();
        return [{ type: 'variable', path, raw: value, range }];
      }
      case 'yamdCritic':
        return [this.critic(value, range)];
      case 'yamdAttributes': {
        const attrs = parseAttrs(value.slice(1, -1));
        return attrs ? [{ type: 'attrs', attrs, raw: value, range }] : [{ type: 'text', value, range }];
      }
      case 'yamdComment':
        return [];
      case 'yamdCitation': {
        const inner = value.slice(1, -1);
        const keys = [...inner.matchAll(/@([^\s;,\]]+)/g)].map((m) => m[1] ?? '');
        const only = keys[0] ?? '';
        if (keys.length === 1 && /^(fig|tbl|eq|sec):/.test(only) && inner.trim() === `@${only}`) {
          return [{ type: 'crossRef', id: only, range }];
        }
        return keys.length ? [{ type: 'citation', raw: inner, range }] : [{ type: 'text', value, range }];
      }
      case 'yamdWikilink':
        return [this.wikilink(value.slice(2, -2), range)];
      case 'yamdEmbed':
        return [this.embed(value.slice(3, -2), range)];
      case 'yamdTag':
        return [{ type: 'tag', name: value.slice(1), range }];
      case 'yamdBlockId':
        return [{ type: 'blockid', id: value.slice(1), range } as unknown as InlineNode];
      case 'yamdScript': {
        const sup = value.startsWith('^');
        const inner = value.startsWith('^{') || value.startsWith('_{') ? value.slice(2, -1) : value.slice(1);
        return [{ type: 'emphasis', kind: sup ? 'sup' : 'sub', children: [{ type: 'text', value: inner, range }], range }];
      }
      case 'yamdInlineFootnote':
        return [{ type: 'inlineFootnote', children: this.fragment(value.slice(2, -1), range.start + 2), range }];
      case 'yamdTextDirective':
        return [this.textDirective(value, range)];
      case 'yamdMathText':
        return [{ type: 'math', value: value.slice(1, -1), range }];
      default:
        return n.children ? kids() : value ? [{ type: 'text', value, range }] : [];
    }
  }

  private critic(value: string, range: Range): InlineNode {
    const tag = value.slice(0, 3);
    const inner = value.slice(3, -3);
    const base = range.start + 3;
    switch (tag) {
      case '{++':
        return { type: 'review', kind: 'insert', children: this.fragment(inner, base), range };
      case '{--':
        return { type: 'review', kind: 'delete', children: this.fragment(inner, base), range };
      case '{~~': {
        const arrow = inner.indexOf('~>');
        return {
          type: 'reviewSubstitute',
          from: this.fragment(inner.slice(0, arrow), base),
          to: this.fragment(inner.slice(arrow + 2), base + arrow + 2),
          range,
        };
      }
      case '{==':
        return { type: 'reviewHighlight', children: this.fragment(inner, base), range };
      default:
        return { type: 'reviewComment', value: inner.trim(), range };
    }
  }

  private wikilink(inner: string, range: Range): InlineNode {
    const pipe = inner.indexOf('|');
    const target = (pipe === -1 ? inner : inner.slice(0, pipe)).trim();
    const hash = target.indexOf('#');
    const file = hash === -1 ? target : target.slice(0, hash);
    const anchor = hash === -1 ? '' : target.slice(hash + 1);
    const path = file === '' ? '' : /\.[A-Za-z0-9]+$/.test(file) ? file : `${file}.yamd`;
    const href = path + (anchor ? `#${anchor.startsWith('^') ? anchor : slugify(anchor)}` : '');
    const children: InlineNode[] =
      pipe === -1
        ? [{ type: 'text', value: target, range }]
        : this.fragment(inner.slice(pipe + 1), range.start + 2 + pipe + 1);
    return { type: 'link', kind: 'wiki', href, children, range };
  }

  private embed(inner: string, range: Range): InlineNode {
    const target = inner.split('|')[0]?.trim() ?? '';
    const hash = target.indexOf('#');
    const file = hash === -1 ? target : target.slice(0, hash);
    const anchor = hash === -1 ? undefined : target.slice(hash + 1);
    return {
      type: 'embed',
      target,
      file,
      heading: anchor && !anchor.startsWith('^') ? anchor : undefined,
      blockId: anchor?.startsWith('^') ? anchor.slice(1) : undefined,
      range,
    };
  }

  private textDirective(value: string, range: Range): InlineNode {
    const m = /^:([A-Za-z][\w-]*)\[/.exec(value);
    const name = m?.[1] ?? '';
    const labelStart = (m?.[0].length ?? 0);
    let depth = 0;
    let labelEnd = labelStart;
    for (; labelEnd < value.length; labelEnd++) {
      const c = value[labelEnd];
      if (c === '\\') labelEnd++;
      else if (c === '[') depth++;
      else if (c === ']') {
        if (depth === 0) break;
        depth--;
      }
    }
    const attrsText = value.slice(labelEnd + 1);
    const attrs = attrsText.startsWith('{') ? (parseAttrs(attrsText.slice(1, -1)) ?? undefined) : undefined;
    if (!KNOWN_INLINE_DIRECTIVES.has(name)) {
      this.diagnostics.push({
        code: 'Y601',
        severity: 'warning',
        message: `Unknown directive ":${name}". Its content is shown as plain text.`,
        range: { start: range.start, end: range.start + 1 + name.length },
      });
    }
    return {
      type: 'directive',
      name,
      children: this.fragment(value.slice(labelStart, labelEnd), range.start + labelStart),
      attrs,
      range,
    };
  }
}

/** Splits text on newlines into text and line break nodes: in YAMD, every newline is a line break. */

/** Attaches `{attrs}` that directly follow an image, link or `[span]`. */
function attachAttributes(nodes: InlineNode[]): InlineNode[] {
  const out: InlineNode[] = [];
  for (const n of nodes) {
    if (n.type !== 'attrs') {
      out.push(n);
      continue;
    }
    const prev = out[out.length - 1];
    if (prev && prev.range.end === n.range.start && (prev.type === 'image' || prev.type === 'link')) {
      prev.attrs = mergeAttrs(prev.attrs, n.attrs);
      prev.range = { start: prev.range.start, end: n.range.end };
      continue;
    }
    if (prev?.type === 'embed' && prev.range.end === n.range.start) {
      // The embed's range stays on `![[...]]`, which link edits rely on.
      prev.attrs = mergeAttrs(prev.attrs, n.attrs);
      continue;
    }
    if (prev?.type === 'text' && prev.value.endsWith(']')) {
      const span = makeSpan(out, n);
      if (span) continue;
    }
    out.push(n);
  }
  return out;
}

/** Turns `[content]` (text nodes plus anything between) followed by attributes into a span. */
function makeSpan(out: InlineNode[], attrs: Extract<InlineNode, { type: 'attrs' }>): boolean {
  const last = out[out.length - 1] as Extract<InlineNode, { type: 'text' }>;
  for (let j = out.length - 1; j >= 0; j--) {
    const node = out[j];
    if (node?.type !== 'text') continue;
    const searchIn = j === out.length - 1 ? node.value.slice(0, -1) : node.value;
    const open = searchIn.lastIndexOf('[');
    if (open === -1) continue;
    const inner: InlineNode[] = [];
    const startRange = node.range;
    if (j === out.length - 1) {
      inner.push({ type: 'text', value: node.value.slice(open + 1, -1), range: node.range });
    } else {
      inner.push({ type: 'text', value: node.value.slice(open + 1), range: node.range });
      inner.push(...out.slice(j + 1, out.length - 1));
      inner.push({ type: 'text', value: last.value.slice(0, -1), range: last.range });
    }
    const before = node.value.slice(0, open);
    out.splice(j, out.length - j);
    if (before) out.push({ type: 'text', value: before, range: startRange });
    out.push({
      type: 'span',
      children: inner.filter((x) => !(x.type === 'text' && x.value === '')),
      attrs: attrs.attrs,
      range: { start: startRange.start, end: attrs.range.end },
    });
    return true;
  }
  return false;
}

/** Removes trailing `{attrs}` (and the whitespace before it) from inline content. */
function takeTrailingAttrs(children: InlineNode[]): Attrs | undefined {
  trimEnd(children);
  const last = children[children.length - 1];
  if (last?.type !== 'attrs') return undefined;
  children.pop();
  trimEnd(children);
  return last.attrs;
}

/** Removes `{attrs}` at the end of the first line (before the first break). */
function takeFirstLineAttrs(children: InlineNode[]): Attrs | undefined {
  const br = children.findIndex((c) => c.type === 'break');
  if (br === -1) return takeTrailingAttrs(children);
  const firstLine = children.slice(0, br);
  const attrs = takeTrailingAttrs(firstLine);
  if (attrs) children.splice(0, br, ...firstLine);
  return attrs;
}

/** Removes a trailing ` ^block-id` marker. */
function takeBlockId(children: InlineNode[]): string | undefined {
  trimEnd(children);
  const last = children[children.length - 1] as unknown as { type: string; id?: string } | undefined;
  if (last?.type !== 'blockid') {
    // A block ID that isn't at the end stays visible as text.
    for (let i = 0; i < children.length; i++) {
      const c = children[i] as unknown as { type: string; id?: string; range: Range };
      if (c.type === 'blockid') children[i] = { type: 'text', value: `^${c.id}`, range: c.range };
    }
    return undefined;
  }
  children.pop();
  trimEnd(children);
  // Block IDs before a line break, on earlier lines, become text again.
  takeBlockId(children);
  return last.id;
}

function trimEnd(children: InlineNode[]) {
  for (;;) {
    const last = children[children.length - 1];
    if (last?.type !== 'text') return;
    const trimmed = last.value.replace(/[ \t]+$/, '');
    if (trimmed === last.value) return;
    if (trimmed === '') children.pop();
    else children[children.length - 1] = { ...last, value: trimmed };
  }
}

/** Walks every block, including those nested in lists, quotes and containers. */
export function walkBlocks(blocks: Block[], visit: (b: Block) => void): void {
  for (const b of blocks) {
    visit(b);
    if (b.type === 'list') b.items.forEach((it) => walkBlocks(it.children, visit));
    else if (b.type === 'blockquote' || b.type === 'container') walkBlocks(b.children, visit);
  }
}

/** Flags headings inside `:::kanban` containers, which are board columns rather than document sections. */
function markBoardHeadings(blocks: Block[], inBoard = false): void {
  for (const b of blocks) {
    if (b.type === 'heading' && inBoard) b.inBoard = true;
    else if (b.type === 'container') markBoardHeadings(b.children, inBoard || b.name === 'kanban');
    else if (b.type === 'blockquote') markBoardHeadings(b.children, inBoard);
    else if (b.type === 'list') b.items.forEach((it) => markBoardHeadings(it.children, inBoard));
  }
}

function assignHeadingIds(doc: YamdDocument): void {
  const registry = new SlugRegistry();
  walkBlocks(doc.blocks, (b) => {
    if (b.attrs?.id) registry.reserve(b.attrs.id);
  });
  const resolve = (path: string) => lookupVariable(doc.frontMatter, path);
  walkBlocks(doc.blocks, (b) => {
    if (b.type === 'heading') b.id = b.attrs?.id ?? registry.unique(slugify(plainText(b.children, resolve)));
  });
}

export function parse(source: string): YamdDocument {
  const rawLines = source.split('\n');
  const lineStarts: number[] = [];
  const lines: string[] = [];
  let offset = 0;
  for (const raw of rawLines) {
    lineStarts.push(offset);
    lines.push(raw.endsWith('\r') ? raw.slice(0, -1) : raw);
    offset += raw.length + 1;
  }

  const prepared = prepareLines(rawLines);
  const tree = toMdast(prepared.text.join('\n'));
  const adapter = new Adapter(source, lines, prepared.attrs);
  for (const n of prepared.comments) adapter.verbatim.add(n);
  const blocks = adapter.blocks(tree.children ?? []);

  const doc: YamdDocument = {
    source,
    lines,
    lineStarts,
    frontMatter: extractFrontMatter(lines),
    blocks,
    footnotes: adapter.footnotes,
    refs: adapter.refs,
    verbatimLines: adapter.verbatim,
    diagnostics: adapter.diagnostics,
  };
  markBoardHeadings(doc.blocks);
  assignHeadingIds(doc);
  return doc;
}
