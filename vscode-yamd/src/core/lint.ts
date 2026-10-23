import { extractCards } from './study/cards';
import { lookupVariable } from './frontmatter';
import { buildBoard } from './kanban';
import { NOTE_EXT, resolveNote, splitTarget, summarize } from './notes';
import { slugify } from './slug';
import type { NoteLookup, NoteSummary } from './notes';
import { plainText } from './inline';
import { walkBlocks } from './parser';
import { sanitizeUrl } from './render';
import type { Block, Diagnostic, InlineNode, Range, Severity, YamdDocument } from './types';

export interface LintOptions {
  /**
   * Returns whether a relative path exists, resolved from the document's folder
   * (or from the project root for paths starting with `/`). Without it, file links aren't checked.
   */
  fileExists?: (path: string) => boolean;
  /** Other notes, for checking wikilinks, embeds and block references across notes. */
  notes?: { lookup: NoteLookup; path: string };
}

/** Full and collapsed references (`[text][label]`, `[label][]`) that GFM leaves as text when undefined. */
const UNRESOLVED_REF = /(?<![\\!\]])\[([^[\]\n]+)\]\[([^[\]\n]*)\]/g;
const UNRESOLVED_FOOTNOTE = /(?<!\\)\[\^([^\]\s]+)\](?!:)/g;
/** A line that ends a sentence or clause, so a following line break looks intentional. */
const LINE_END_PUNCTUATION = /[.!?:;]["'”’)\]*_`]*\s*$/;

const VAGUE_LINK_TEXT = new Set(['click here', 'here', 'link', 'this link', 'read more', 'more', 'this']);
const BLOCK_START = /^\s*(?:[-*+](?:\s|$)|\d{1,9}[.)](?:\s|$)|#|`{3}|~{3}|::|\{|\||\[\^|\$\$|%%)/;

export function lint(doc: YamdDocument, options: LintOptions = {}): Diagnostic[] {
  return [...new Linter(doc, options).run(), ...extractCards(doc, '').diagnostics];
}

function walkInline(nodes: InlineNode[], visit: (n: InlineNode) => void): void {
  for (const n of nodes) {
    visit(n);
    switch (n.type) {
      case 'emphasis':
      case 'link':
      case 'span':
      case 'review':
      case 'reviewHighlight':
      case 'directive':
      case 'inlineFootnote':
        walkInline(n.children, visit);
        break;
      case 'reviewSubstitute':
        walkInline(n.from, visit);
        walkInline(n.to, visit);
        break;
      default:
        break;
    }
  }
}

/** Inline content directly owned by a block (not by its child blocks). */
function blockInlines(b: Block): InlineNode[][] {
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

class Linter {
  private readonly out: Diagnostic[] = [];
  private readonly allBlocks: Block[] = [];
  private readonly ids = new Set<string>();

  constructor(
    private readonly doc: YamdDocument,
    private readonly options: LintOptions,
  ) {
    const roots = [...doc.blocks, ...[...doc.footnotes.values()].flatMap((f) => f.children)];
    walkBlocks(roots, (b) => this.allBlocks.push(b));
  }

  private report(code: string, severity: Severity, message: string, range: Range) {
    this.out.push({ code, severity, message, range });
  }

  private lineRange(line: number, startCol = 0, endCol?: number): Range {
    const start = this.doc.lineStarts[line] ?? 0;
    const text = this.doc.lines[line] ?? '';
    return { start: start + startCol, end: start + (endCol ?? text.length) };
  }

  run(): Diagnostic[] {
    this.collectIds();
    this.out.push(...this.doc.diagnostics);
    this.lineRules();
    this.inlineRules();
    this.headingRules();
    this.tableRules();
    this.paragraphRules();
    this.kanbanRules();
    this.blockIdRules();
    this.frontMatterRules();
    return this.out.sort((a, b) => a.range.start - b.range.start);
  }

  private collectIds() {
    for (const b of this.allBlocks) {
      if (b.type === 'heading') this.ids.add(b.id);
      if (b.attrs?.id) this.ids.add(b.attrs.id);
      if (b.type === 'paragraph' && b.blockId) this.ids.add(`^${b.blockId}`);
      if (b.type === 'list') b.items.forEach((it) => it.attrs?.id && this.ids.add(it.attrs.id));
      for (const nodes of blockInlines(b)) {
        walkInline(nodes, (n) => {
          if ((n.type === 'image' || n.type === 'span' || n.type === 'link') && n.attrs?.id) this.ids.add(n.attrs.id);
        });
      }
    }
  }

  private lineRules() {
    const { lines, verbatimLines } = this.doc;
    lines.forEach((text, no) => {
      if (verbatimLines.has(no)) return;
      const lead = /^\s*/.exec(text)?.[0] ?? '';
      if (lead.includes('\t') && text.trim() !== '') {
        this.report(
          'Y101',
          'warning',
          'Tabs in indentation count as 4 columns, which makes nesting hard to see. Use spaces instead.',
          this.lineRange(no, 0, lead.length),
        );
      }
      const trailing = /(\\+)\s*$/.exec(text);
      if (trailing && (trailing[1] ?? '').length % 2 === 1) {
        const col = trailing.index + (trailing[1] ?? '').length - 1;
        this.report(
          'Y201',
          'info',
          'This backslash is redundant: in YAMD a newline is already a line break, so you can remove it.',
          this.lineRange(no, col, col + 1),
        );
      }
      const hashtag = /^(\s*)(#{2,6})[^\s#]/.exec(text);
      if (hashtag) {
        const col = (hashtag[1] ?? '').length;
        this.report(
          'Y301',
          'warning',
          `"${text.trim().split(/\s/)[0]}" is plain text. Did you mean a heading? Add a space after "${hashtag[2]}".`,
          this.lineRange(no, col, col + (hashtag[2] ?? '').length + 1),
        );
      }
      const prev = lines[no - 1];
      if (
        prev !== undefined &&
        !verbatimLines.has(no - 1) &&
        /^\s*>/.test(prev) &&
        text.trim() !== '' &&
        !/^\s*>/.test(text) &&
        !BLOCK_START.test(text) &&
        lead.length >= (/^\s*/.exec(prev)?.[0].length ?? 0)
      ) {
        this.report(
          'Y401',
          'warning',
          'This line continues the quote above it without ">". Add ">" to make that clear, or add a blank line to end the quote.',
          this.lineRange(no, lead.length),
        );
      }
    });
  }

  private checkFile(path: string, range: Range, what: string) {
    if (!this.options.fileExists) return;
    let decoded = path;
    try {
      decoded = decodeURIComponent(path);
    } catch {
      // Keep the path as written.
    }
    if (!this.options.fileExists(decoded)) this.report('Y701', 'warning', `${what} "${decoded}" does not exist.`, range);
  }

  private checkHref(href: string, range: Range, what: string) {
    if (href.startsWith('#')) {
      const id = href.slice(1);
      if (id && !this.ids.has(id)) this.report('Y701', 'warning', `No element has the id "${id}".`, range);
      return;
    }
    const safe = sanitizeUrl(href);
    if (safe === null) {
      this.report('Y901', 'warning', `The URL scheme in "${href}" is not allowed, so this link is removed.`, range);
      return;
    }
    if (/^[a-z][a-z0-9+.-]*:/i.test(href) || href.startsWith('//')) return;
    const path = href.split('#')[0] ?? '';
    if (path) this.checkFile(path, range, what);
  }

  private inlineRules() {
    for (const b of this.allBlocks) {
      for (const nodes of blockInlines(b)) walkInline(nodes, (n) => this.inlineNode(n));
    }
  }

  private readonly summaries = new Map<string, NoteSummary | null>();

  private noteSummary(path: string): NoteSummary | null {
    if (!this.summaries.has(path)) {
      const lookup = this.options.notes?.lookup;
      const known = lookup?.summary?.(path);
      if (known) this.summaries.set(path, known);
      else {
        const text = lookup?.read(path);
        this.summaries.set(path, text === undefined ? null : summarize(path, text));
      }
    }
    return this.summaries.get(path) ?? null;
  }

  /** Checks a wikilink or embed target against other notes: Y701, Y709 and, for embeds, Y602. */
  private checkNoteTarget(raw: string, range: Range, embed: boolean) {
    const notes = this.options.notes;
    if (!notes) return false;
    const { file, heading, blockId } = splitTarget(raw);
    const r = resolveNote(notes.lookup, file, notes.path);
    if (!r) {
      this.report('Y701', 'warning', `No note or file matches "${file}".`, range);
      return true;
    }
    if (r.candidates.length > 1) {
      this.report('Y709', 'warning', `"${file}" matches ${r.candidates.length} notes: ${r.candidates.join(', ')}. The shortest path is used; write more of the path to choose.`, range);
    }
    if (!r.path.toLowerCase().endsWith(NOTE_EXT)) return true;
    const target = r.path === notes.path ? summarize(notes.path, this.doc.source, this.doc) : this.noteSummary(r.path);
    if (target && heading !== undefined && !target.headings.some((h) => h.id === heading || h.id === slugify(heading) || h.text.toLowerCase() === heading.toLowerCase())) {
      this.report('Y701', 'warning', `"${file || 'This note'}" has no heading "${heading}".`, range);
    }
    if (target && blockId !== undefined && !target.blocks.some((b) => b.id === blockId)) {
      this.report('Y701', 'warning', `"${file || 'This note'}" has no block "^${blockId}".`, range);
    }
    if (embed && heading === undefined && blockId === undefined && this.embedReaches(r.path, notes.path)) {
      this.report('Y602', 'error', `Embedding "${file}" creates a cycle: it embeds this note again.`, range);
    }
    return true;
  }

  /** Whether following whole-note embeds from `start` leads back to `goal`. */
  private embedReaches(start: string, goal: string): boolean {
    const notes = this.options.notes;
    if (!notes) return false;
    const seen = new Set<string>();
    const stack = [start];
    while (stack.length) {
      const path = stack.pop() as string;
      if (path === goal) return true;
      if (seen.has(path) || seen.size > 200) continue;
      seen.add(path);
      for (const l of this.noteSummary(path)?.links ?? []) {
        if (l.kind !== 'embed' || l.heading !== undefined || l.blockId !== undefined) continue;
        const next = resolveNote(notes.lookup, l.file, path);
        if (next) stack.push(next.path);
      }
    }
    return false;
  }

  private blockIdRules() {
    const seen = new Set<string>();
    for (const b of this.allBlocks) {
      if (b.type !== 'paragraph' || !b.blockId) continue;
      if (seen.has(b.blockId)) {
        this.report('Y708', 'error', `The block ID "^${b.blockId}" is already used in this note. Block IDs must be unique.`, this.lineRange(b.endLine));
      }
      seen.add(b.blockId);
    }
  }

  private inlineNode(n: InlineNode) {
    switch (n.type) {
      case 'embed':
        this.checkNoteTarget(n.target, n.range, true);
        break;
      case 'text':
        this.unresolvedReferences(n.value, n.range.start);
        break;
      case 'link': {
        let href = n.href;
        if (n.kind === 'wiki' && this.options.notes) {
          const inner = this.doc.source.slice(n.range.start + 2, n.range.end - 2);
          this.checkNoteTarget(inner, n.range, false);
          this.vagueText(n);
          break;
        }
        if (n.kind === 'reference') {
          const ref = this.doc.refs.get((n.label ?? '').toLowerCase());
          if (!ref) {
            this.report('Y701', 'warning', `The reference "[${n.label}]" is not defined.`, n.range);
            break;
          }
          href = ref.url;
        }
        this.checkHref(href, n.range, 'Linked file');
        this.vagueText(n);
        break;
      }
      case 'image': {
        const decorative = n.attrs?.values['decorative'] === true;
        if (!decorative && n.alt.trim() === '') {
          this.report(
            'Y702',
            'error',
            'Images need alt text that describes them. For purely decorative images, add {decorative}.',
            n.range,
          );
        }
        let src = n.src;
        if (n.label !== undefined) {
          const ref = this.doc.refs.get(n.label.toLowerCase());
          if (!ref) {
            this.report('Y701', 'warning', `The reference "[${n.label}]" is not defined.`, n.range);
            break;
          }
          src = ref.url;
        }
        if (sanitizeUrl(src, true) === null) {
          this.report('Y901', 'warning', `The URL scheme in "${src}" is not allowed, so this image is removed.`, n.range);
        } else if (!/^[a-z][a-z0-9+.-]*:/i.test(src) && src) {
          this.checkFile(src.split('#')[0] ?? src, n.range, 'Image');
        }
        break;
      }
      case 'crossRef':
        if (!this.ids.has(n.id)) this.report('Y701', 'warning', `No element has the id "${n.id}".`, n.range);
        break;
      case 'span': {
        const target = n.attrs.values['ref'];
        if (typeof target === 'string' && !this.ids.has(target)) {
          this.report('Y701', 'warning', `No element has the id "${target}".`, n.range);
        }
        break;
      }
      case 'footnoteRef':
        if (!this.doc.footnotes.has(n.id)) {
          this.report('Y701', 'warning', `The footnote "[^${n.id}]" is not defined.`, n.range);
        }
        break;
      case 'variable':
        if (n.path.startsWith('@')) {
          this.report(
            'Y802',
            'info',
            `"{{${n.path}}}" is a template placeholder, only replaced when a template is inserted. Run template insertion, or remove it if this note wasn't inserted from a template.`,
            n.range,
          );
        } else if (lookupVariable(this.doc.frontMatter, n.path) === undefined) {
          this.report(
            'Y801',
            'error',
            `The variable "${n.path}" is not defined. Add it under "vars:" in the front matter.`,
            n.range,
          );
        }
        break;
      default:
        break;
    }
  }

  private vagueText(n: Extract<InlineNode, { type: 'link' }>) {
    const text = plainText(n.children).trim().toLowerCase();
    if (VAGUE_LINK_TEXT.has(text)) {
      this.report(
        'Y706',
        'warning',
        `Link text "${text}" doesn't describe the destination. Use words that say where the link goes.`,
        n.range,
      );
    }
  }

  /** Reports `[text][label]` and `[^id]` that stayed text because nothing defines them. */
  private unresolvedReferences(text: string, base: number) {
    for (const m of text.matchAll(UNRESOLVED_REF)) {
      const label = (m[2] || m[1]) ?? '';
      const range = { start: base + m.index, end: base + m.index + m[0].length };
      this.report('Y701', 'warning', `The reference "[${label}]" is not defined, so this shows as plain text.`, range);
    }
    for (const m of text.matchAll(UNRESOLVED_FOOTNOTE)) {
      const range = { start: base + m.index, end: base + m.index + m[0].length };
      this.report('Y701', 'warning', `The footnote "[^${m[1]}]" is not defined, so this shows as plain text.`, range);
    }
  }

  private headingRules() {
    const hasTitle = typeof this.doc.frontMatter?.data['title'] === 'string';
    let prev: number | null = hasTitle ? 1 : null;
    let h1Count = 0;
    walkBlocks(this.doc.blocks, (b) => {
      if (b.type !== 'heading' || b.inBoard) return;
      const range = this.lineRange(b.line);
      if (prev !== null && b.level > prev + 1) {
        this.report(
          'Y704',
          'warning',
          `Heading level skips from H${prev} to H${b.level}. Use H${prev + 1} instead.`,
          range,
        );
      }
      if (b.level === 1 && ++h1Count > 1) {
        this.report('Y705', 'warning', 'Only one H1 is allowed per document. Use H2 for this heading.', range);
      }
      prev = b.level;
    });
  }

  private tableRules() {
    for (const b of this.allBlocks) {
      if (b.type === 'paragraph' && b.rawLines.length > 0 && b.rawLines.every((l) => /^\|.*\|$/.test(l))) {
        this.report(
          'Y703',
          'error',
          'This looks like a table without a header row. Add a separator row such as "| --- | --- |" after the first row.',
          this.lineRange(b.line),
        );
      }
      if (b.type === 'container' && b.name === 'table' && b.attrs?.values['header'] === undefined) {
        this.report('Y703', 'error', 'List tables need a header row. Add {header=1} to the :::table line.', this.lineRange(b.line));
      }
    }
  }

  /** Y210: paragraphs that look hard-wrapped, which render one line per source line. */
  private paragraphRules() {
    for (const b of this.allBlocks) {
      if (b.type !== 'paragraph' || b.rawLines.length < 3) continue;
      const wrapped = b.rawLines
        .slice(0, -1)
        .every((l) => l.trim().length >= 60 && !LINE_END_PUNCTUATION.test(l) && !/\\$|  $/.test(l));
      if (!wrapped) continue;
      this.report(
        'Y210',
        'info',
        'This paragraph looks hard-wrapped. In YAMD each line renders on its own line; join the lines to make one paragraph.',
        { start: this.lineRange(b.line).start, end: this.lineRange(b.endLine).end },
      );
    }
  }

  private kanbanRules() {
    for (const b of this.allBlocks) {
      if (b.type !== 'container' || b.name !== 'kanban') continue;
      const board = buildBoard(b);
      for (const p of board.preamble) {
        this.report(
          'Y603',
          'warning',
          'Content before the first column heading is not shown on the board. Move it under a column or out of the board.',
          { start: this.lineRange(p.line).start, end: this.lineRange(p.endLine).end },
        );
      }
      for (const c of board.columns) {
        if (c.limit !== undefined && c.cards.length > c.limit) {
          this.report(
            'Y604',
            'info',
            `This column has ${c.cards.length} cards, over its limit of ${c.limit}.`,
            this.lineRange(c.line),
          );
        }
      }
    }
  }

  private frontMatterRules() {
    const fm = this.doc.frontMatter;
    if (fm?.error) {
      this.report('Y102', 'error', `The front matter is not valid YAML: ${fm.error}`, this.lineRange(fm.line));
    }
    if (!fm || typeof fm.data['lang'] !== 'string') {
      this.report(
        'Y707',
        'info',
        'Set "lang" in the front matter (for example "lang: en-US") so screen readers use the right language.',
        this.lineRange(0),
      );
    }
  }
}
