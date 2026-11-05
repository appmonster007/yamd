import { attrNumber, attrString } from './attrs';
import { renderBoard, renderCalendar, renderGallery, renderTimeline } from './renderBoards';
import type { BoardContext } from './renderBoards';
import { escapeHtml, sanitizeUrl, today } from './renderUtil';

export { escapeHtml, isoWeek, sanitizeUrl } from './renderUtil';
import { plainText } from './inline';
import { buildBoard, buildCalendarCards, buildGallery, buildTimeline, hashText } from '../widgets/kanban';
import { walkBlocks } from './parser';
import { normalizeUri } from 'micromark-util-sanitize-uri';
import { sanitizeHtml } from './sanitize';
import { STUDY_BY_NAME } from '../study/blocks';
import type { Attrs, Block, ContainerBlock, InlineNode, ListBlock, TableCell, YamdDocument } from './types';

export interface RenderOptions {
  /** Maps a safe image URL to the URL the output should use (e.g. a webview URI). */
  resolveImage?: (src: string) => string;
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
}

const CALLOUT_TITLES: Record<string, string> = {
  note: 'Note',
  tip: 'Tip',
  warning: 'Warning',
  danger: 'Danger',
};

const IMAGE_FILE = /\.(png|jpe?g|gif|webp|svg|avif|bmp)$/i;

class Renderer {
  private readonly footnoteOrder: string[] = [];
  private readonly footnoteRefCount = new Map<string, number>();
  private readonly studyNumbers = new WeakMap<ContainerBlock, number>();

  constructor(
    private readonly doc: YamdDocument,
    private readonly options: RenderOptions,
  ) {
    this.number();
  }

  /** Numbers study blocks (definitions, theorems, …) per kind, in document order. */
  private number(): void {
    const studyCounts = new Map<string, number>();
    walkBlocks(this.doc.blocks, (b) => {
      const study = b.type === 'container' ? STUDY_BY_NAME.get(b.name) : undefined;
      if (b.type === 'container' && study?.numbered) {
        const n = (studyCounts.get(study.name) ?? 0) + 1;
        studyCounts.set(study.name, n);
        this.studyNumbers.set(b, n);
      }
    });
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
        return `<p${this.attrs(b.attrs, b.line)}>${this.inline(b.children)}</p>`;
      }
      case 'heading':
        return `<h${b.level}${this.attrs(b.attrs, b.line, [], b.id)}>${this.inline(b.children)}</h${b.level}>`;
      case 'thematicBreak':
        return `<hr${this.attrs(b.attrs, b.line)}>`;
      case 'blockquote':
        return `<blockquote${this.attrs(b.attrs, b.line)}>\n${this.blocks(b.children)}\n</blockquote>`;
      case 'list':
        return this.list(b);
      case 'code':
        return this.code(b);
      case 'math': {
        const math = this.options.renderMath?.(b.value, true);
        const body = math !== undefined ? `<div class="math-display">${math}</div>` : `<code class="math">${escapeHtml(b.value)}</code>`;
        return `<div${this.attrs(b.attrs, b.line, ['math-block'])}>${body}</div>`;
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
        const parts = it.children.map((c) => (!b.spread && c.type === 'paragraph' ? this.inline(c.children) : this.block(c)));
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
    return `<div${this.attrs(b.attrs, b.line, ['code-block'])}>${this.codeHeader(title, b.lang)}<pre><code${lang}>${this.codeBody(b.value, b.lang)}</code></pre></div>`;
  }

  private table(header: TableCell[], rowsIn: TableCell[][], align: (string | null)[], attrs: Attrs | undefined, line: number): string {
    const cap = '';
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
      case 'kanban':
        return renderBoard(this.boardContext(), buildBoard(b));
      case 'calendar':
        return renderCalendar(this.boardContext(), buildCalendarCards(b));
      case 'timeline':
        return renderTimeline(this.boardContext(), buildTimeline(b));
      case 'gallery':
        return renderGallery(this.boardContext(), buildGallery(b));
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

  private boardContext(): BoardContext {
    return {
      doc: this.doc,
      options: this.options,
      blocks: (b) => this.blocks(b),
      checkbox: (line, done) => this.checkbox(line, done),
      image: (n, inFigure) => this.image(n, inFigure),
      inline: (n) => this.inline(n),
    };
  }


  private leaf(b: Extract<Block, { type: 'leaf' }>): string {
    switch (b.name) {
      case 'pagebreak':
        return `<div class="pagebreak" data-line="${b.line}" aria-hidden="true"></div>`;
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
        const text = plainText(b.children);
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
      case 'span':
        return `<span${this.attrs(n.attrs, undefined)}>${this.inline(n.children)}</span>`;
      case 'tag':
        return `<span class="tag" data-tag="${escapeHtml(n.name)}">#${escapeHtml(n.name)}</span>`;
      case 'attrs':
        return escapeHtml(n.raw);
      case 'footnoteRef': {
        if (!this.doc.footnotes.has(n.id)) return `[^${escapeHtml(n.id)}]`;
        const { n: num, refId } = this.footnoteNumber(n.id);
        return `<sup class="footnote-ref"><a href="#fn-${num}" id="${refId}">${num}</a></sup>`;
      }
    }
  }

  private footnoteSection(): string {
    if (this.footnoteOrder.length === 0) return '';
    // Footnote bodies can reference more footnotes, so the order list may grow while rendering.
    const rendered: string[] = [];
    for (let i = 0; i < this.footnoteOrder.length; i++) {
      const key = this.footnoteOrder[i] as string;
      let body: string;
      body = this.blocks(this.doc.footnotes.get(key)?.children ?? []);
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
  return new Renderer(doc, options).render();
}
