import { attrNumber, attrString } from './attrs';
import { lookupVariable } from './frontmatter';
import { plainText } from './inline';
import { buildBoard, buildCalendarCards, buildGallery, buildTimeline, cardSource, hashText } from './kanban';
import type { CalendarBoard, GalleryBoard, TimelineBoard } from './kanban';
import type { KanbanBoard, KanbanCard } from './kanban';
import { cardTitleSource } from './kanbanEdit';
import { blockInlines, walkInline } from './notes';
import { walkBlocks } from './parser';
import { normalizeUri } from 'micromark-util-sanitize-uri';
import { sanitizeHtml } from './sanitize';
import { Bibliography, parseCitation } from './study/bibtex';
import { STUDY_BY_NAME } from './study/blocks';
import type { Attrs, Block, ContainerBlock, InlineNode, ListBlock, TableCell, YamdDocument } from './types';

/** Content resolved for an embed. */
export interface ResolvedEmbed {
  /** Path of the embedded note, used for `data-source` and the link back. */
  path: string;
  /** Link back to the source, e.g. `guide.yamd#install`. */
  href: string;
  title: string;
  /** Rendered HTML of the embedded content. */
  html: string;
}

export interface RenderOptions {
  /** Maps a safe image URL to the URL the output should use (e.g. a webview URI). */
  resolveImage?: (src: string) => string;
  /** Resolves `![[note]]`. Without it, embeds render as links. */
  resolveEmbed?: (target: { file: string; heading?: string; blockId?: string }) => ResolvedEmbed | 'missing' | 'cycle' | null;
  /** `trust` renders raw HTML unchanged (only for tests and trusted mode). Default: sanitize. */
  rawHtml?: 'sanitize' | 'trust';
  /** `newline` renders soft breaks as Markdown does (only for conformance tests). Default: `break`. */
  softBreaks?: 'break' | 'newline';
  /** Enables preview controls (task checkboxes, kanban editing). */
  interactive?: boolean;
  /** Today's date as `YYYY-MM-DD`, for overdue badges. Defaults to the current date. */
  today?: string;
  /** Path of the document being rendered, added as `data-source` on interactive elements. */
  sourcePath?: string;
  /** Highlights code: returns HTML for its contents, or undefined to show it plain. Output must be safe. */
  highlight?: (code: string, lang: string) => string | undefined;
  /** Renders TeX: returns HTML, or undefined to show the source. Output must be safe. */
  renderMath?: (tex: string, display: boolean) => string | undefined;
  /** Resolves `[@key]` citations and fills `::bibliography`. Without it, the cited keys are listed. */
  bibliography?: Bibliography;
  /** Hides `:cloze[…]` answers until clicked. */
  quiz?: boolean;
}

const CALLOUT_TITLES: Record<string, string> = {
  note: 'Note',
  tip: 'Tip',
  warning: 'Warning',
  danger: 'Danger',
};

const IMAGE_FILE = /\.(png|jpe?g|gif|webp|svg|avif|bmp)$/i;

const NEEDS_ESCAPE = /[&<>"']/;
const ESCAPES: Record<string, string> = { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' };

/** Most strings have nothing to escape, so they are returned as they are; the rest take one pass. */
export function escapeHtml(s: string): string {
  return NEEDS_ESCAPE.test(s) ? s.replace(/[&<>"']/g, (c) => ESCAPES[c] as string) : s;
}

/** Applies the URL scheme allow-list from yamd-spec.md section 9. Returns null if the URL is unsafe. */
export function sanitizeUrl(url: string, forImage = false): string | null {
  const u = url.trim();
  const scheme = /^([a-z][a-z0-9+.-]*):/i.exec(u.replace(/[\u0000- ]/g, ''))?.[1]?.toLowerCase();
  if (scheme === undefined) return u;
  if (['http', 'https', 'mailto', 'tel'].includes(scheme)) return u;
  if (forImage && /^data:image\/(png|gif|jpe?g|webp|svg\+xml);/i.test(u)) return u;
  return null;
}

/** True if a figure is an image alone in its paragraph with a caption. */
function figureImage(b: Block): Extract<InlineNode, { type: 'image' }> | null {
  if (b.type !== 'paragraph') return null;
  const nodes = b.children.filter((n) => !(n.type === 'text' && n.value.trim() === ''));
  const only = nodes[0];
  if (nodes.length !== 1 || only?.type !== 'image' || attrString(only.attrs, 'caption') === undefined) return null;
  return only;
}

/** An embed alone in its paragraph renders as a block. */
function blockEmbed(b: Block): Extract<InlineNode, { type: 'embed' }> | null {
  if (b.type !== 'paragraph') return null;
  const nodes = b.children.filter((n) => !(n.type === 'text' && n.value.trim() === ''));
  const only = nodes[0];
  return nodes.length === 1 && only?.type === 'embed' ? only : null;
}

function today(): string {
  const d = new Date();
  const p = (n: number) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`;
}

/** ISO 8601 week number (weeks start Monday; week 1 is the one containing the year's first Thursday). */
function isoWeek(iso: string): number {
  const d = new Date(`${iso}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() - ((d.getUTCDay() + 6) % 7) + 3);
  const firstThursday = new Date(Date.UTC(d.getUTCFullYear(), 0, 4));
  firstThursday.setUTCDate(firstThursday.getUTCDate() - ((firstThursday.getUTCDay() + 6) % 7) + 3);
  return 1 + Math.round((d.getTime() - firstThursday.getTime()) / (7 * 86400000));
}

class Renderer {
  private readonly numbers = new Map<string, { kind: string; n: number }>();
  private readonly footnoteOrder: string[] = [];
  private readonly footnoteRefCount = new Map<string, number>();
  private readonly inlineFootnotes: InlineNode[][] = [];
  private readonly citations: string[] = [];
  private readonly studyNumbers = new WeakMap<ContainerBlock, number>();
  private figureCount = 0;
  private tableCount = 0;
  private equationCount = 0;
  private refTargets: Map<string, { hue: number; line: number; column: number }> | undefined;

  constructor(
    private readonly doc: YamdDocument,
    private readonly options: RenderOptions,
  ) {
    this.number();
  }

  /** Numbers figures, tables, equations and sections in document order. */
  private number(): void {
    let sections = 0;
    const studyCounts = new Map<string, number>();
    walkBlocks(this.doc.blocks, (b) => {
      const study = b.type === 'container' ? STUDY_BY_NAME.get(b.name) : undefined;
      if (b.type === 'container' && study?.numbered) {
        const n = (studyCounts.get(study.name) ?? 0) + 1;
        studyCounts.set(study.name, n);
        this.studyNumbers.set(b, n);
        if (b.attrs?.id) this.numbers.set(b.attrs.id, { kind: study.label, n });
      }
      const img = figureImage(b);
      if (img) {
        const n = ++this.figureCount;
        if (img.attrs?.id) this.numbers.set(img.attrs.id, { kind: 'Figure', n });
      } else if (b.type === 'container' && b.name === 'figure' && attrString(b.attrs, 'caption') !== undefined) {
        const n = ++this.figureCount;
        if (b.attrs?.id) this.numbers.set(b.attrs.id, { kind: 'Figure', n });
      } else if (
        (b.type === 'table' || (b.type === 'container' && b.name === 'table')) &&
        attrString(b.attrs, 'caption') !== undefined
      ) {
        const n = ++this.tableCount;
        if (b.attrs?.id) this.numbers.set(b.attrs.id, { kind: 'Table', n });
      } else if (b.type === 'math' && b.attrs?.id) {
        this.numbers.set(b.attrs.id, { kind: 'Equation', n: ++this.equationCount });
      } else if (b.type === 'heading' && !b.inBoard) {
        sections++;
        if (b.id.startsWith('sec:')) this.numbers.set(b.id, { kind: 'Section', n: sections });
      }
    });
    this.figureCount = 0;
    this.tableCount = 0;
    this.equationCount = 0;
  }

  /** The 1-based line and column of a character offset into the source. */
  private offsetToLineCol(offset: number): { line: number; column: number } {
    const starts = this.doc.lineStarts;
    let lo = 0;
    let hi = starts.length - 1;
    let line = 0;
    while (lo <= hi) {
      const mid = (lo + hi) >> 1;
      if ((starts[mid] ?? 0) <= offset) {
        line = mid;
        lo = mid + 1;
      } else {
        hi = mid - 1;
      }
    }
    return { line: line + 1, column: offset - (starts[line] ?? 0) + 1 };
  }

  /** Where an `{#id}`/`^id` target actually is in the source, for a `ref=` locator (§4.5). */
  private locate(id: string): { line: number; column: number } | undefined {
    const blockId = id.startsWith('^') ? id.slice(1) : undefined;
    let found: { line: number; column: number } | undefined;
    walkBlocks(this.doc.blocks, (b) => {
      if (found) return;
      if (blockId === undefined && b.type === 'heading' && b.id === id) found = { line: b.line + 1, column: 1 };
      else if (blockId === undefined && b.attrs?.id === id) found = { line: b.line + 1, column: 1 };
      else if (blockId !== undefined && b.type === 'paragraph' && b.blockId === blockId) {
        const col = (this.doc.lines[b.endLine] ?? '').indexOf(`^${blockId}`);
        found = { line: b.endLine + 1, column: (col === -1 ? 0 : col) + 1 };
      }
      if (found) return;
      for (const nodes of blockInlines(b)) {
        walkInline(nodes, (n) => {
          if (found || blockId !== undefined) return;
          if ((n.type === 'span' || n.type === 'image' || n.type === 'link') && n.attrs?.id === id) found = this.offsetToLineCol(n.range.start);
        });
      }
    });
    return found;
  }

  /**
   * Every distinct `ref=` target in the document, in order of first use, each assigned its own hue
   * (a golden-angle step, so no two repeat) and the line/column its target actually sits at — the
   * same information shown at both ends of the reference, source and target (§4.5).
   */
  private computeRefTargets(): Map<string, { hue: number; line: number; column: number }> {
    if (this.refTargets) return this.refTargets;
    const map = new Map<string, { hue: number; line: number; column: number }>();
    walkBlocks(this.doc.blocks, (b) => {
      for (const nodes of blockInlines(b)) {
        walkInline(nodes, (n) => {
          if (n.type !== 'span') return;
          const ref = attrString(n.attrs, 'ref');
          if (!ref || map.has(ref)) return;
          const pos = this.locate(ref);
          if (pos) map.set(ref, { hue: (map.size * 137.508) % 360, ...pos });
        });
      }
    });
    this.refTargets = map;
    return map;
  }

  /** The `file:line:col` badge shown next to both a `ref=` source and its target. */
  private locatorBadge(id: string): string {
    const info = this.computeRefTargets().get(id);
    if (!info) return '';
    const file = this.options.sourcePath?.split('/').pop();
    const text = `${file ? `${file}:` : ''}${info.line}:${info.column}`;
    return ` <sup class="ref-locator" style="color:hsl(${info.hue} 70% 42%)">${escapeHtml(text)}</sup>`;
  }

  render(): string {
    return this.blocks(this.doc.blocks) + this.footnoteSection();
  }

  private blocks(blocks: Block[]): string {
    return blocks.map((b) => this.block(b)).join('\n');
  }

  /** Common HTML attributes: id, classes, the source line and alignment. */
  private attrs(attrs: Attrs | undefined, line: number | undefined, extraClass: string[] = [], id?: string): string {
    let out = '';
    const theId = id ?? attrs?.id;
    if (theId) out += ` id="${escapeHtml(theId)}"`;
    const classes = [...extraClass, ...(attrs?.classes ?? [])];
    const align = attrString(attrs, 'align');
    if (align && ['left', 'center', 'right'].includes(align)) classes.push(`align-${align}`);
    if (classes.length) out += ` class="${escapeHtml(classes.join(' '))}"`;
    const color = attrString(attrs, 'color');
    if (color && /^[#\w(),.\s%-]+$/.test(color)) out += ` style="color: ${escapeHtml(color)}"`;
    if (line !== undefined) out += ` data-line="${line}"`;
    return out;
  }

  private html(value: string): string {
    return sanitizeHtml(value, this.options.rawHtml === 'trust');
  }

  private block(b: Block): string {
    switch (b.type) {
      case 'paragraph': {
        const img = figureImage(b);
        if (img) return this.figure(img, b.line);
        const embed = blockEmbed(b);
        if (embed) return this.embedBlock(embed, b.line);
        const id = b.attrs?.id ?? (b.blockId ? `^${b.blockId}` : undefined);
        return `<p${this.attrs(b.attrs, b.line, [], id)}>${this.inline(b.children)}${id ? this.locatorBadge(id) : ''}</p>`;
      }
      case 'heading':
        return `<h${b.level}${this.attrs(b.attrs, b.line, [], b.id)}>${this.inline(b.children)}${this.locatorBadge(b.id)}</h${b.level}>`;
      case 'thematicBreak':
        return `<hr${this.attrs(b.attrs, b.line)}>`;
      case 'blockquote':
        return `<blockquote${this.attrs(b.attrs, b.line)}>\n${this.blocks(b.children)}\n</blockquote>`;
      case 'list':
        return this.list(b);
      case 'code':
        return this.code(b);
      case 'math': {
        const id = b.attrs?.id;
        const num = id ? `<span class="eq-number">(${++this.equationCount})</span>` : '';
        const math = this.options.renderMath?.(b.value, true);
        const body = math !== undefined ? `<div class="math-display">${math}</div>` : `<code class="math">${escapeHtml(b.value)}</code>`;
        return `<div${this.attrs(b.attrs, b.line, ['math-block'])}>${body}${num}</div>`;
      }
      case 'html':
        return this.html(b.value);
      case 'table':
        return this.table(b.header, b.rows, b.align, b.attrs, b.line);
      case 'container':
        return this.container(b);
      case 'leaf':
        return this.leaf(b);
    }
  }

  private checkbox(line: number, done: boolean): string {
    const checked = done ? ' checked' : '';
    if (!this.options.interactive) return `<input type="checkbox" disabled${checked}>`;
    const hash = hashText(this.doc.lines[line] ?? '');
    const source = this.options.sourcePath ? ` data-source="${escapeHtml(this.options.sourcePath)}"` : '';
    return `<input type="checkbox" class="task-toggle" data-line="${line}" data-hash="${hash}"${source}${checked} aria-label="Toggle task">`;
  }

  private list(b: ListBlock): string {
    const tag = b.ordered ? 'ol' : 'ul';
    const start = b.ordered && b.start !== 1 ? ` start="${b.start}"` : '';
    const hasTasks = b.items.some((it) => it.task);
    const items = b.items
      .map((it) => {
        // Tight lists render paragraphs without <p>, as in CommonMark.
        const parts = it.children.map((c) => (!b.spread && c.type === 'paragraph' && !figureImage(c) && !blockEmbed(c) ? this.inline(c.children) : this.block(c)));
        let body = parts.join('\n');
        const first = it.children[0];
        const id = !b.spread && first?.type === 'paragraph' && first.blockId ? `^${first.blockId}` : undefined;
        if (it.task) {
          const box = this.checkbox(it.line, it.task === 'done');
          body = b.spread ? body.replace(/^<p([^>]*)>/, `<p$1>${box} `) : `${box} ${body}`;
          if (b.spread && !body.startsWith('<p')) body = `${box} ${body}`;
        }
        if (it.children.length > 1 || (b.spread && body)) body = b.spread ? `\n${body}\n` : body;
        return `<li${this.attrs(it.attrs, it.line, it.task ? ['task-item'] : [], id)}>${body}</li>`;
      })
      .join('\n');
    return `<${tag}${start}${this.attrs(b.attrs, b.line, hasTasks ? ['task-list'] : [])}>\n${items}\n</${tag}>`;
  }

  /** Code contents: highlighted when a highlighter knows the language, otherwise escaped. */
  private codeBody(value: string, lang: string | undefined): string {
    if (!value) return '';
    const highlighted = lang ? this.options.highlight?.(value, lang) : undefined;
    return `${highlighted ?? escapeHtml(value)}\n`;
  }

  /** The bar above a code block: its title and language. */
  private codeHeader(title: string | undefined, lang: string | undefined): string {
    if (!title && !lang) return '';
    const t = title ? `<span class="code-title">${escapeHtml(title)}</span>` : '';
    const l = lang ? `<span class="code-lang">${escapeHtml(lang)}</span>` : '';
    return `<div class="code-header">${t}${l}</div>`;
  }

  private code(b: Extract<Block, { type: 'code' }>): string {
    const title = attrString(b.attrs, 'title');
    const lang = b.lang ? ` class="language-${escapeHtml(b.lang)}"` : '';
    if (b.lang === 'mermaid') {
      return `<div${this.attrs(b.attrs, b.line, ['code-block', 'diagram-fallback'])}>${this.codeHeader(title ?? 'Diagram (shown as source)', 'mermaid')}<pre><code${lang}>${this.codeBody(b.value, undefined)}</code></pre></div>`;
    }
    if (b.lang === 'query') {
      // A placeholder the preview fills with the result; without a preview it shows the SQL.
      return `<div class="db-slot db-query" data-db-key="q${b.line}" data-line="${b.line}"><pre><code class="language-sql">${this.codeBody(b.value, 'sql')}</code></pre></div>`;
    }
    return `<div${this.attrs(b.attrs, b.line, ['code-block'])}>${this.codeHeader(title, b.lang)}<pre><code${lang}>${this.codeBody(b.value, b.lang)}</code></pre></div>`;
  }

  private figure(img: Extract<InlineNode, { type: 'image' }>, line: number): string {
    const n = ++this.figureCount;
    const caption = attrString(img.attrs, 'caption') ?? '';
    return `<figure${this.attrs(img.attrs, line, ['figure'])}>${this.image(img, true)}<figcaption>Figure ${n}: ${escapeHtml(caption)}</figcaption></figure>`;
  }

  private table(header: TableCell[], rowsIn: TableCell[][], align: (string | null)[], attrs: Attrs | undefined, line: number): string {
    const caption = attrString(attrs, 'caption');
    const cap = caption !== undefined ? `<caption>Table ${++this.tableCount}: ${escapeHtml(caption)}</caption>` : '';
    const cell = (c: TableCell, tag: 'th' | 'td', col: number) => {
      const a = align[col];
      const al = a ? ` align="${a}"` : '';
      const span = attrNumber(c.attrs, 'colspan');
      const rowspan = attrNumber(c.attrs, 'rowspan');
      const spans = (span ? ` colspan="${span}"` : '') + (rowspan ? ` rowspan="${rowspan}"` : '');
      return `<${tag}${al}${spans}>${this.inline(c.children)}</${tag}>`;
    };
    const rowHtml = (r: TableCell[], tag: 'th' | 'td') => {
      let col = 0;
      return `<tr>\n${r
        .map((c) => {
          const html = cell(c, tag, col);
          col += attrNumber(c.attrs, 'colspan') ?? 1;
          return html;
        })
        .join('\n')}\n</tr>`;
    };
    // As in GFM, body rows are padded or cut to the header's width.
    const width = header.reduce((sum, c) => sum + (attrNumber(c.attrs, 'colspan') ?? 1), 0);
    const fit = (r: TableCell[]) => {
      const out: TableCell[] = [];
      let used = 0;
      for (const c of r) {
        if (used >= width) break;
        out.push(c);
        used += attrNumber(c.attrs, 'colspan') ?? 1;
      }
      while (used < width) {
        out.push({ children: [] });
        used++;
      }
      return out;
    };
    const rows = rowsIn.map(fit);
    const head = `<thead>\n${rowHtml(header, 'th')}\n</thead>`;
    const body = rows.length ? `\n<tbody>\n${rows.map((r) => rowHtml(r, 'td')).join('\n')}\n</tbody>` : '';
    return `<table${this.attrs(attrs, line)}>${cap}\n${head}${body}\n</table>`;
  }

  private listTable(b: ContainerBlock): string {
    const list = b.children.find((c): c is ListBlock => c.type === 'list');
    const headerRows = attrNumber(b.attrs, 'header') ?? 0;
    const caption = attrString(b.attrs, 'caption');
    const cap = caption !== undefined ? `<caption>Table ${++this.tableCount}: ${escapeHtml(caption)}</caption>` : '';
    const rows = (list?.items ?? []).map((row, r) => {
      const cellsList = row.children.find((c): c is ListBlock => c.type === 'list');
      const tag = r < headerRows ? 'th' : 'td';
      const cells = (cellsList?.items ?? []).map((cell) => {
        const span = attrNumber(cell.attrs, 'colspan');
        const rowspan = attrNumber(cell.attrs, 'rowspan');
        const spans = (span ? ` colspan="${span}"` : '') + (rowspan ? ` rowspan="${rowspan}"` : '');
        const only = cell.children[0];
        const tight = cell.children.length === 1 && only?.type === 'paragraph';
        const body = tight && only?.type === 'paragraph' ? this.inline(only.children) : this.blocks(cell.children);
        return `<${tag}${spans}>${body}</${tag}>`;
      });
      return { header: r < headerRows, html: `<tr data-line="${row.line}">${cells.join('')}</tr>` };
    });
    const head = rows.filter((r) => r.header).map((r) => r.html).join('');
    const body = rows.filter((r) => !r.header).map((r) => r.html).join('');
    return `<table${this.attrs(b.attrs, b.line, ['list-table'])}>${cap}${head ? `<thead>${head}</thead>` : ''}<tbody>${body}</tbody></table>`;
  }

  private container(b: ContainerBlock): string {
    const title = attrString(b.attrs, 'title');
    switch (b.name) {
      case 'note':
      case 'tip':
      case 'warning':
      case 'danger': {
        const heading = escapeHtml(title ?? CALLOUT_TITLES[b.name] ?? b.name);
        return `<div${this.attrs(b.attrs, b.line, ['callout', `callout-${b.name}`])} role="note"><p class="callout-title">${heading}</p>\n${this.blocks(b.children)}\n</div>`;
      }
      case 'definition':
      case 'theorem':
      case 'lemma':
      case 'proof':
      case 'example':
      case 'question':
      case 'remark':
      case 'summary':
        return this.studyBlock(b);
      case 'derivation':
        return this.derivation(b);
      case 'card':
        return this.cardBlock(b);
      case 'details': {
        const summary = escapeHtml(attrString(b.attrs, 'summary') ?? 'Details');
        return `<details${this.attrs(b.attrs, b.line)}><summary>${summary}</summary>\n${this.blocks(b.children)}\n</details>`;
      }
      case 'columns':
        return `<div${this.attrs(b.attrs, b.line, ['columns'])}>\n${this.blocks(b.children)}\n</div>`;
      case 'column':
        return `<div${this.attrs(b.attrs, b.line, ['column'])}>\n${this.blocks(b.children)}\n</div>`;
      case 'figure': {
        const caption = attrString(b.attrs, 'caption');
        const cap = caption !== undefined ? `<figcaption>Figure ${++this.figureCount}: ${escapeHtml(caption)}</figcaption>` : '';
        return `<figure${this.attrs(b.attrs, b.line, ['figure'])}>\n${this.blocks(b.children)}\n${cap}</figure>`;
      }
      case 'table':
        return this.listTable(b);
      case 'kanban':
        return this.board(buildBoard(b));
      case 'calendar':
        return this.calendarSugar(buildCalendarCards(b));
      case 'timeline':
        return this.timelineSugar(buildTimeline(b));
      case 'gallery':
        return this.gallerySugar(buildGallery(b));
      case 'html':
        return `<div${this.attrs(b.attrs, b.line, ['raw-html'])}><div class="code-title">Raw HTML (not rendered: trusted mode is off)</div><pre><code>${escapeHtml(b.raw)}</code></pre></div>`;
      default:
        return `<div${this.attrs(b.attrs, b.line, ['directive', `directive-${b.name}`])}>\n${this.blocks(b.children)}\n</div>`;
    }
  }

  private studyBlock(b: ContainerBlock): string {
    const kind = STUDY_BY_NAME.get(b.name);
    const label = kind?.label ?? b.name;
    const n = this.studyNumbers.get(b);
    const title = attrString(b.attrs, 'title');
    const heading = `<span class="study-label">${escapeHtml(label)}${n !== undefined ? ` ${n}` : ''}</span>${title ? ` <span class="study-name">(${escapeHtml(title)})</span>` : ''}`;
    const end = b.name === 'proof' ? '<span class="proof-end" aria-hidden="true">∎</span>' : '';
    return `<div${this.attrs(b.attrs, b.line, ['study', `study-${b.name}`])} role="group" aria-label="${escapeHtml(label)}"><p class="study-title">${heading}</p>\n${this.blocks(b.children)}\n${end}</div>`;
  }

  /** Lines of `lhs = rhs // reason`, aligned on the relation sign. */
  private derivation(b: ContainerBlock): string {
    const tex = derivationTex(b.raw);
    const math = this.options.renderMath?.(tex, true);
    const body = math !== undefined ? `<div class="math-display">${math}</div>` : `<code class="math">${escapeHtml(b.raw)}</code>`;
    return `<div${this.attrs(b.attrs, b.line, ['math-block', 'derivation'])}>${body}</div>`;
  }

  /** A flashcard in a note: the question, with the answer behind a button. */
  private cardBlock(b: ContainerBlock): string {
    const at = b.children.findIndex((c) => c.type === 'thematicBreak');
    const front = at === -1 ? b.children : b.children.slice(0, at);
    const back = at === -1 ? [] : b.children.slice(at + 1);
    const answer = back.length ? `<details class="card-answer"><summary>Show answer</summary>\n${this.blocks(back)}\n</details>` : '';
    return `<div${this.attrs(b.attrs, b.line, ['card'])} role="group" aria-label="Flashcard"><div class="card-front">\n${this.blocks(front)}\n</div>${answer}</div>`;
  }

  private board(board: KanbanBoard): string {
    const interactive = Boolean(this.options.interactive);
    const now = this.options.today ?? today();
    const source = this.options.sourcePath ? ` data-source="${escapeHtml(this.options.sourcePath)}"` : '';
    const columns = board.columns.map((col, ci) => {
      const count = col.cards.length;
      const over = col.limit !== undefined && count > col.limit;
      const classes = ['kanban-column', over ? 'over-limit' : '', col.complete ? 'complete' : ''].filter(Boolean).join(' ');
      const titleText = escapeHtml(plainText(col.title));
      const countText = col.limit !== undefined ? `${count}/${col.limit}` : `${count}`;
      const cards = col.cards.map((card, i) => this.card(card, i, now, interactive)).join('\n');
      const description = col.description.length ? `<div class="kanban-column-description">${this.blocks(col.description)}</div>` : '';
      const add = interactive
        ? `<form class="kanban-add" data-column="${ci}"><input type="text" class="kanban-add-input" placeholder="Add card" aria-label="Add a card to ${titleText}"></form>`
        : '';
      return `<section class="${classes}" data-column="${ci}" data-line="${col.line}" aria-label="${titleText}">
<header class="kanban-column-header"><button type="button" class="kanban-collapse" aria-expanded="true" aria-label="Collapse ${titleText}">▾</button><span class="kanban-column-title">${this.inline(col.title)}</span><span class="kanban-count${over ? ' over' : ''}" title="${over ? 'Over the work-in-progress limit' : 'Cards'}">${countText}</span></header>
${description}<div class="kanban-cards" data-column="${ci}">${cards}</div>${add}
</section>`;
    });
    const title = board.title ? `<div class="kanban-title">${escapeHtml(board.title)}</div>` : '';
    const mode = interactive ? ' data-interactive' : '';
    return `<div class="kanban" data-line="${board.line}" data-board="${board.line}"${source}${mode}>${title}<div class="kanban-columns">\n${columns.join('\n')}\n</div></div>`;
  }

  private card(card: KanbanCard, index: number, now: string, interactive: boolean): string {
    const overdue = card.due !== undefined && !card.done && card.due < now;
    const chips = card.tags.map((t) => `<span class="tag">#${escapeHtml(t)}</span>`).join('');
    const due = card.due ? `<span class="kanban-due${overdue ? ' overdue' : ''}" title="${overdue ? 'Overdue' : 'Due'}">${escapeHtml(card.due)}</span>` : '';
    const owner = card.owner ? `<span class="kanban-owner">@${escapeHtml(card.owner)}</span>` : '';
    const meta = chips || due || owner ? `<div class="kanban-card-meta">${chips}${due}${owner}</div>` : '';
    const bodyInline = card.bodyInline.length ? `<p>${this.inline(card.bodyInline)}</p>` : '';
    const bodyBlocks = card.body.length ? this.blocks(card.body) : '';
    const body = bodyInline || bodyBlocks ? `<div class="kanban-card-body">${bodyInline}${bodyBlocks}</div>` : '';
    const box = card.hasCheckbox ? `${this.checkbox(card.line, card.done)} ` : '';
    const hash = hashText(cardSource(this.doc.lines, card));
    const titleSource = escapeHtml(cardTitleSource(this.doc.lines[card.line] ?? ''));
    const drag = interactive ? ' draggable="true"' : '';
    const label = escapeHtml(plainText(card.title));
    return `<article class="kanban-card${card.done ? ' done' : ''}${overdue ? ' overdue' : ''}" tabindex="0"${drag} data-line="${card.line}" data-index="${index}" data-hash="${hash}" aria-label="${label}"><div class="kanban-card-title">${box}<span class="kanban-card-text" data-title="${titleSource}">${this.inline(card.title)}</span></div>${meta}${body}</article>`;
  }

  /** `:::calendar` is sugar for an implicit database rendered as a calendar (§6.2.1); a card with
   * no `{due=...}` isn't shown (Y606, reported by the linter, not here). */
  private calendarSugar(board: CalendarBoard): string {
    const interactive = Boolean(this.options.interactive);
    const source = this.options.sourcePath ? ` data-source="${escapeHtml(this.options.sourcePath)}"` : '';
    const now = this.options.today ?? today();
    const month = now.slice(0, 7);
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
    const eventHtml = (c: KanbanCard): string => {
      const hash = hashText(cardSource(this.doc.lines, c));
      const drag = interactive ? ' draggable="true"' : '';
      const box = c.hasCheckbox ? `${this.checkbox(c.line, c.done)} ` : '';
      const titleSource = escapeHtml(cardTitleSource(this.doc.lines[c.line] ?? ''));
      const chips = c.tags.map((t) => `<span class="tag">#${escapeHtml(t)}</span>`).join('');
      const owner = c.owner ? `<span class="kanban-owner">@${escapeHtml(c.owner)}</span>` : '';
      const meta = chips || owner ? `<div class="kanban-card-meta">${chips}${owner}</div>` : '';
      const bodyInline = c.bodyInline.length ? `<p>${this.inline(c.bodyInline)}</p>` : '';
      const bodyBlocks = c.body.length ? this.blocks(c.body) : '';
      const detail = meta || bodyInline || bodyBlocks ? `<div class="db-event-detail">${bodyInline}${bodyBlocks}${meta}</div>` : '';
      return `<div class="db-event" tabindex="0" data-line="${c.line}" data-hash="${hash}" data-title="${titleSource}"${drag}><div class="db-event-summary">${box}${this.inline(c.title)}</div>${detail}</div>`;
    };
    interface Cell {
      html: string;
      iso?: string;
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
    const titleText = `${['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'][m - 1]} ${y}`;
    const title = board.title ? `<div class="kanban-title">${escapeHtml(board.title)}</div>` : '';
    const mode = interactive ? ' data-interactive' : '';
    const agenda = `<div class="db-agenda" hidden><div class="db-agenda-header"><span class="db-agenda-title"></span><button type="button" class="db-agenda-close" aria-label="Close list">Close</button></div><div class="db-agenda-list"></div></div>`;
    return `<div class="kanban-calendar" data-line="${board.line}" data-board="${board.line}"${mode}${source}>${title}<div class="db-calendar" data-month="${month}"><div class="db-calendar-header"><span class="db-month-title">${titleText}</span></div><div class="db-calendar-weekdays"><span class="db-week-number"></span>${weekdays}</div>${weeks.join('')}</div>${agenda}</div>`;
  }

  /** `:::timeline` is a calendar stretched into bars via `{start=...}`/`{due=...}`; headings are
   * optional groups. A card with no `{start=...}` isn't shown (Y606, reported by the linter). */
  private timelineSugar(board: TimelineBoard): string {
    const interactive = Boolean(this.options.interactive);
    const source = this.options.sourcePath ? ` data-source="${escapeHtml(this.options.sourcePath)}"` : '';
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
    const min = items.length ? Math.min(...items.map((i) => time(i.start))) : time(this.options.today ?? today());
    const max = items.length ? Math.max(...items.map((i) => time(i.end))) : min + 86400000 * 30;
    const span = Math.max(max - min, 86400000);
    const toDate = (t: number) => new Date(t).toISOString().slice(0, 10);
    const pct = (t: number) => ((t - min) / span) * 100;
    const bar = (i: Item) => {
      const left = pct(time(i.start));
      const width = Math.max(pct(time(i.end)) - left, 1.5);
      const label = escapeHtml(plainText(i.card.title));
      const box = i.card.hasCheckbox ? `${this.checkbox(i.card.line, i.card.done)} ` : '';
      const hash = hashText(cardSource(this.doc.lines, i.card));
      const drag = interactive ? ' draggable="true"' : '';
      const titleSource = escapeHtml(cardTitleSource(this.doc.lines[i.card.line] ?? ''));
      return `<div class="db-timeline-bar" tabindex="0" data-line="${i.card.line}" data-hash="${hash}" data-start="${i.start}" data-title="${titleSource}"${drag} style="left:${left}%;width:${width}%" title="${label}">${box}${this.inline(i.card.title)}</div>`;
    };
    const rows = board.groups
      .map((g, gi) => {
        const bars = g.cards.map((c) => byLine.get(c.line)).filter((i): i is Item => i !== undefined).map(bar).join('');
        if (!bars && !interactive) return '';
        const label = g.title ? this.inline(g.title) : '';
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
    return `<div class="kanban-timeline" data-line="${board.line}" data-board="${board.line}"${mode}${source}>${title}<div class="db-timeline" data-start="${toDate(min)}" data-end="${toDate(max)}">${rows}</div>${globalAdd}</div>`;
  }

  /** `:::gallery` is sugar for an implicit database rendered as a gallery (§6.2.1): each image
   * starts a card, and the paragraph(s) following it are its caption. */
  private gallerySugar(board: GalleryBoard): string {
    const interactive = Boolean(this.options.interactive);
    const source = this.options.sourcePath ? ` data-source="${escapeHtml(this.options.sourcePath)}"` : '';
    const title = board.title ? `<div class="kanban-title">${escapeHtml(board.title)}</div>` : '';
    const mode = interactive ? ' data-interactive' : '';
    const cards = board.cards
      .map((c) => {
        const chips = c.tags.map((t) => `<span class="tag">#${escapeHtml(t)}</span>`).join('');
        const meta = chips ? `<div class="kanban-card-meta">${chips}</div>` : '';
        const bodyInline = c.bodyInline.length ? `<p>${this.inline(c.bodyInline)}</p>` : '';
        const bodyBlocks = c.body.length ? this.blocks(c.body) : '';
        const hash = hashText(cardSource(this.doc.lines, c));
        const drag = interactive ? ' draggable="true"' : '';
        return `<article class="db-card" tabindex="0" data-line="${c.line}" data-hash="${hash}"${drag}>${this.image(c.image)}<div class="db-card-body">${bodyInline}${bodyBlocks}${meta}</div></article>`;
      })
      .join('\n');
    const add = interactive
      ? `<form class="gallery-add"><input type="text" class="gallery-add-image" placeholder="Image path" aria-label="New image path"><input type="text" class="gallery-add-caption" placeholder="Caption" aria-label="New image caption"><button type="submit">Add</button></form>`
      : '';
    return `<div class="kanban-gallery" data-line="${board.line}" data-board="${board.line}"${mode}${source}>${title}<div class="db-gallery">${cards}</div>${add}</div>`;
  }

  private embedBlock(embed: Extract<InlineNode, { type: 'embed' }>, line: number): string {
    if (IMAGE_FILE.test(embed.file)) return `<p data-line="${line}">${this.embedInline(embed)}</p>`;
    const resolved = this.options.resolveEmbed?.({ file: embed.file, heading: embed.heading, blockId: embed.blockId });
    if (resolved === 'missing') return `<div class="embed-missing" data-line="${line}">Note not found: <code>${escapeHtml(embed.target)}</code></div>`;
    if (resolved === 'cycle') return `<div class="embed-missing" data-line="${line}">Circular embed: <code>${escapeHtml(embed.target)}</code></div>`;
    if (resolved) {
      return `<div class="embed" data-line="${line}" data-source="${escapeHtml(resolved.path)}"><a class="embed-title" href="${escapeHtml(resolved.href)}">${escapeHtml(resolved.title)}</a><div class="embed-content">${resolved.html}</div></div>`;
    }
    return `<p data-line="${line}">${this.embedInline(embed)}</p>`;
  }

  private embedInline(embed: Extract<InlineNode, { type: 'embed' }>): string {
    if (IMAGE_FILE.test(embed.file)) {
      return this.image({ type: 'image', src: embed.file, alt: embed.file.replace(/^.*\//, ''), attrs: embed.attrs, range: embed.range });
    }
    const anchor = embed.blockId ? `#^${embed.blockId}` : embed.heading ? `#${escapeHtml(embed.heading)}` : '';
    const file = /\.[A-Za-z0-9]+$/.test(embed.file) || embed.file === '' ? embed.file : `${embed.file}.yamd`;
    return `<a class="embed-link wikilink" href="${escapeHtml(file)}${anchor}">${escapeHtml(embed.target)}</a>`;
  }

  private leaf(b: Extract<Block, { type: 'leaf' }>): string {
    switch (b.name) {
      case 'toc':
        return this.toc(attrNumber(b.attrs, 'depth') ?? 3, b.line);
      case 'pagebreak':
        return `<div class="pagebreak" data-line="${b.line}" aria-hidden="true"></div>`;
      case 'embed': {
        const url = sanitizeUrl(b.rawLabel);
        const link = url ? `<a href="${escapeHtml(url)}">${escapeHtml(url)}</a>` : escapeHtml(b.rawLabel);
        return `<div class="embed-fallback" data-line="${b.line}">Embedded content: ${link}</div>`;
      }
      case 'db':
        return `<div class="db-slot db-view" data-db-key="v${b.line}" data-line="${b.line}"><div class="db-loading">Database view: <code>${escapeHtml(b.rawLabel)}</code></div></div>`;
      case 'bibliography':
        return `<section class="bibliography" data-line="${b.line}" data-bibliography></section>`;
      default:
        return `<p data-line="${b.line}">${this.inline(b.label)}</p>`;
    }
  }

  /** The document's headings (not board columns), found once however many contents boxes use them. */
  private outline: Extract<Block, { type: 'heading' }>[] | undefined;

  private toc(depth: number, line: number): string {
    if (!this.outline) {
      const found: Extract<Block, { type: 'heading' }>[] = [];
      walkBlocks(this.doc.blocks, (b) => {
        if (b.type === 'heading' && !b.inBoard) found.push(b);
      });
      this.outline = found;
    }
    const headings: { level: number; id: string; html: string }[] = [];
    // A single H1 is the document's title, which the contents don't need to repeat.
    const h1s = this.outline.filter((b) => b.level === 1).length;
    for (const b of this.outline) {
      if (b.level <= depth && !(b.level === 1 && h1s === 1)) {
        const text = plainText(b.children, (path) => lookupVariable(this.doc.frontMatter, path));
        headings.push({ level: b.level, id: b.id, html: escapeHtml(text) });
      }
    }
    if (headings.length === 0) return '';
    const min = Math.min(...headings.map((h) => h.level));
    let html = '';
    let level = min - 1;
    for (const h of headings) {
      if (h.level > level) {
        while (level < h.level) {
          html += '<ul>';
          level++;
          if (level < h.level) html += '<li>';
        }
      } else {
        html += '</li>';
        while (level > h.level) {
          html += '</ul></li>';
          level--;
        }
      }
      html += `<li><a href="#${escapeHtml(h.id)}">${h.html}</a>`;
    }
    html += '</li>';
    while (level >= min) {
      html += '</ul>';
      level--;
      if (level >= min) html += '</li>';
    }
    return `<nav class="toc" data-line="${line}" aria-label="Contents"><div class="toc-title">Contents</div>${html}</nav>`;
  }

  private image(n: Extract<InlineNode, { type: 'image' }>, inFigure = false): string {
    const ref = n.label !== undefined ? this.doc.refs.get(n.label) : undefined;
    const raw = ref?.url ?? n.src;
    const safe = sanitizeUrl(raw, true);
    const decorative = n.attrs?.values['decorative'] === true;
    const alt = decorative ? '' : n.alt;
    if (safe === null) return `<span class="image-missing">${escapeHtml(alt)}</span>`;
    const src = this.options.resolveImage ? this.options.resolveImage(safe) : normalizeUri(safe);
    let extra = '';
    const width = attrString(n.attrs, 'width');
    const height = attrString(n.attrs, 'height');
    if (width && /^\d+(%|px)?$/.test(width)) extra += ` width="${escapeHtml(width.replace(/px$/, ''))}"`;
    if (height && /^\d+(%|px)?$/.test(height)) extra += ` height="${escapeHtml(height.replace(/px$/, ''))}"`;
    const title = n.title ?? ref?.title;
    if (title) extra += ` title="${escapeHtml(title)}"`;
    if (decorative) extra += ' role="presentation"';
    const attrs = inFigure ? '' : this.attrs(n.attrs, undefined);
    return `<img src="${escapeHtml(src)}" alt="${escapeHtml(alt)}"${extra}${attrs}>`;
  }

  private footnoteNumber(key: string): { n: number; refId: string } {
    let idx = this.footnoteOrder.indexOf(key);
    if (idx === -1) {
      this.footnoteOrder.push(key);
      idx = this.footnoteOrder.length - 1;
    }
    const count = (this.footnoteRefCount.get(key) ?? 0) + 1;
    this.footnoteRefCount.set(key, count);
    const n = idx + 1;
    return { n, refId: count === 1 ? `fnref-${n}` : `fnref-${n}-${count}` };
  }

  inline(nodes: InlineNode[]): string {
    return nodes.map((n) => this.inlineNode(n)).join('');
  }

  private inlineNode(n: InlineNode): string {
    switch (n.type) {
      case 'text':
        return escapeHtml(n.value);
      case 'break':
        return n.soft && this.options.softBreaks === 'newline' ? '\n' : '<br>\n';
      case 'emphasis': {
        const inner = this.inline(n.children);
        switch (n.kind) {
          case 'italic':
            return `<em>${inner}</em>`;
          case 'bold':
            return `<strong>${inner}</strong>`;
          case 'boldItalic':
            return `<strong><em>${inner}</em></strong>`;
          case 'underline':
            return `<u>${inner}</u>`;
          case 'strike':
            return `<del>${inner}</del>`;
          case 'highlight':
            return `<mark>${inner}</mark>`;
          case 'sub':
            return `<sub>${inner}</sub>`;
          case 'sup':
            return `<sup>${inner}</sup>`;
        }
        return inner;
      }
      case 'code':
        return `<code>${escapeHtml(n.value)}</code>`;
      case 'math': {
        const math = this.options.renderMath?.(n.value, false);
        return math !== undefined ? `<span class="math-inline">${math}</span>` : `<code class="math">${escapeHtml(n.value)}</code>`;
      }
      case 'html':
        return this.html(n.value);
      case 'link': {
        let href = n.href;
        let title = n.title;
        if (n.kind === 'reference') {
          const ref = this.doc.refs.get(n.label ?? '');
          if (!ref) return this.inline(n.children);
          href = ref.url;
          title = ref.title;
        }
        const safe = sanitizeUrl(href);
        if (safe === null) return `<span class="unsafe-link">${this.inline(n.children)}</span>`;
        const t = title ? ` title="${escapeHtml(title)}"` : '';
        const cls = n.kind === 'wiki' ? ['wikilink'] : [];
        return `<a href="${escapeHtml(normalizeUri(safe))}"${t}${this.attrs(n.attrs, undefined, cls)}>${this.inline(n.children)}</a>`;
      }
      case 'image':
        return this.image(n);
      case 'span': {
        const ref = attrString(n.attrs, 'ref');
        if (ref) {
          // A real link to #target-id, the same as a cross-reference — no connector drawing, just
          // a colored anchor link plus a file:line:col locator, matching the one shown at the target.
          const info = this.computeRefTargets().get(ref);
          const style = info ? ` style="color:hsl(${info.hue} 70% 42%)"` : '';
          return `<a href="#${escapeHtml(ref)}"${this.attrs(n.attrs, undefined)}${style}>${this.inline(n.children)}</a>${this.locatorBadge(ref)}`;
        }
        const id = n.attrs?.id;
        return `<span${this.attrs(n.attrs, undefined)}>${this.inline(n.children)}</span>${id ? this.locatorBadge(id) : ''}`;
      }
      case 'tag':
        return `<span class="tag" data-tag="${escapeHtml(n.name)}">#${escapeHtml(n.name)}</span>`;
      case 'embed':
        return this.embedInline(n);
      case 'attrs':
        return escapeHtml(n.raw);
      case 'footnoteRef': {
        if (!this.doc.footnotes.has(n.id)) return `[^${escapeHtml(n.id)}]`;
        const { n: num, refId } = this.footnoteNumber(n.id);
        return `<sup class="footnote-ref"><a href="#fn-${num}" id="${refId}">${num}</a></sup>`;
      }
      case 'inlineFootnote': {
        this.inlineFootnotes.push(n.children);
        const { n: num, refId } = this.footnoteNumber(`\u0000inline-${this.inlineFootnotes.length - 1}`);
        return `<sup class="footnote-ref"><a href="#fn-${num}" id="${refId}">${num}</a></sup>`;
      }
      case 'crossRef': {
        const target = this.numbers.get(n.id);
        if (!target) return `<span class="xref-missing">[@${escapeHtml(n.id)}]</span>`;
        return `<a class="xref" href="#${escapeHtml(n.id)}">${target.kind} ${target.n}</a>`;
      }
      case 'citation': {
        for (const m of n.raw.matchAll(/@([^\s;,\]]+)/g)) {
          const key = m[1] ?? '';
          if (!this.citations.includes(key)) this.citations.push(key);
        }
        const bib = this.options.bibliography;
        if (bib) {
          const cited = parseCitation(n.raw);
          const text = bib.cite(cited);
          const missing = cited.some((c) => !bib.has(c.key));
          const target = cited.length === 1 && bib.has(cited[0]?.key ?? '') ? ` href="#ref-${escapeHtml(cited[0]?.key ?? '')}"` : '';
          return `<a class="citation${missing ? ' citation-missing' : ''}"${target}>${escapeHtml(text)}</a>`;
        }
        return `<span class="citation">[${escapeHtml(n.raw.replace(/@/g, ''))}]</span>`;
      }
      case 'variable': {
        if (n.path.startsWith('@')) return `<span class="placeholder">${escapeHtml(n.raw)}</span>`;
        const value = lookupVariable(this.doc.frontMatter, n.path);
        return value === undefined ? `<span class="var-missing">${escapeHtml(n.raw)}</span>` : escapeHtml(value);
      }
      case 'review':
        return n.kind === 'insert'
          ? `<ins class="review-ins">${this.inline(n.children)}</ins>`
          : `<del class="review-del">${this.inline(n.children)}</del>`;
      case 'reviewSubstitute':
        return `<del class="review-del">${this.inline(n.from)}</del><ins class="review-ins">${this.inline(n.to)}</ins>`;
      case 'reviewHighlight': {
        const comment = n.comment ? `<span class="review-comment">${escapeHtml(n.comment)}</span>` : '';
        return `<mark class="review-mark">${this.inline(n.children)}</mark>${comment}`;
      }
      case 'reviewComment':
        return `<span class="review-comment">${escapeHtml(n.value)}</span>`;
      case 'directive': {
        const inner = this.inline(n.children);
        if (n.name === 'kbd') return `<kbd>${inner}</kbd>`;
        if (n.name === 'abbr') {
          const title = attrString(n.attrs, 'title');
          return `<abbr${title ? ` title="${escapeHtml(title)}"` : ''}>${inner}</abbr>`;
        }
        if (n.name === 'cloze') {
          return this.options.quiz
            ? `<span class="cloze cloze-hidden" tabindex="0" role="button" aria-label="Hidden answer. Press to reveal."><span class="cloze-answer">${inner}</span></span>`
            : `<span class="cloze">${inner}</span>`;
        }
        if (n.name === 'query') return `<span class="db-slot db-inline" data-db-key="i${n.range.start}" title="${escapeHtml(this.doc.source.slice(n.range.start, n.range.end))}">…</span>`;
        return inner;
      }
    }
  }

  /** The cited keys, since citations aren't resolved against a bibliography file. */
  bibliography(): string {
    if (this.citations.length === 0) return '';
    if (this.options.bibliography) return this.options.bibliography.references();
    const items = this.citations.map((c) => `<li>${escapeHtml(c)}</li>`).join('');
    return `<p class="bibliography-note">Citations aren't resolved in the preview. Cited keys:</p><ul>${items}</ul>`;
  }

  private footnoteSection(): string {
    if (this.footnoteOrder.length === 0) return '';
    // Footnote bodies can reference more footnotes, so the order list may grow while rendering.
    const rendered: string[] = [];
    for (let i = 0; i < this.footnoteOrder.length; i++) {
      const key = this.footnoteOrder[i] as string;
      let body: string;
      if (key.startsWith('\u0000inline-')) {
        body = `<p>${this.inline(this.inlineFootnotes[Number(key.slice(8))] ?? [])}</p>`;
      } else {
        body = this.blocks(this.doc.footnotes.get(key)?.children ?? []);
      }
      const back = ` <a href="#fnref-${i + 1}" class="footnote-back" aria-label="Back to reference">↩</a>`;
      body = body.replace(/<\/p>(?![\s\S]*<\/p>)/, `${back}</p>`);
      rendered.push(`<li id="fn-${i + 1}">${body}</li>`);
    }
    return `\n<section class="footnotes" role="doc-endnotes"><hr><ol>${rendered.join('\n')}</ol></section>`;
  }
}

/** TeX for a `:::derivation`: one aligned row per line, with `// reason` in a right-hand column. */
export function derivationTex(raw: string): string {
  const relation = /(\\(?:leq?|geq?|neq?|approx|equiv|sim|subseteq?|supseteq?|in|implies|iff|Rightarrow|to)(?![A-Za-z])|<=|>=|=|<|>)/;
  const rows = raw
    .split('\n')
    .map((l) => l.trim())
    .filter(Boolean)
    .map((line) => {
      const [expr = '', ...why] = line.split(/\s\/\/\s/);
      const reason = why.join(' // ').trim();
      const m = relation.exec(expr);
      const aligned = m ? (m.index === 0 ? `{}&${expr}` : `${expr.slice(0, m.index)}&${expr.slice(m.index)}`) : `&${expr}`;
      const text = reason ? ` && \\text{${reason.replace(/[\\{}$&#_%^~]/g, (c) => (c === '\\' ? '\\textbackslash{}' : c === '~' ? '\\textasciitilde{}' : c === '^' ? '\\textasciicircum{}' : `\\${c}`))}}` : '';
      return aligned + text;
    });
  return `\\begin{aligned}\n${rows.join(' \\\\\n')}\n\\end{aligned}`;
}

export function render(doc: YamdDocument, options: RenderOptions = {}): string {
  const r = new Renderer(doc, options);
  let html = r.render();
  const bib = r.bibliography();
  if (bib) {
    if (html.includes('data-bibliography></section>')) {
      html = html.replace('data-bibliography></section>', `data-bibliography>${bib}</section>`);
    } else {
      html += `\n<section class="bibliography">${bib}</section>`;
    }
  }
  return html;
}
