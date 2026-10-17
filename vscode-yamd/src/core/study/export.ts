/**
 * Standalone HTML output (§6.6): a printable document with a title page and contents, a read-only
 * copy for sharing, and a slide deck. All of them are single files with no external resources.
 */
import { lookupVariable } from '../frontmatter';
import { plainText } from '../inline';
import { walkBlocks } from '../parser';
import { escapeHtml, render } from '../render';
import type { RenderOptions } from '../render';
import type { Block, YamdDocument } from '../types';

export interface ExportOptions {
  /** Stylesheet text (the preview's styles, KaTeX's when the page has math). */
  css: string;
  render: RenderOptions;
  titlePage?: boolean;
  toc?: boolean;
  /** Adds a banner saying the copy is read-only. */
  readOnly?: boolean;
  /** Words for the footer, e.g. the course. */
  footer?: string;
}

function meta(doc: YamdDocument) {
  const fm = doc.frontMatter?.data ?? {};
  const text = (k: string) => {
    const v = fm[k];
    if (v instanceof Date) return v.toISOString().slice(0, 10);
    return typeof v === 'string' || typeof v === 'number' ? String(v) : undefined;
  };
  const firstH1 = (() => {
    let t: string | undefined;
    walkBlocks(doc.blocks, (b) => {
      if (t === undefined && b.type === 'heading' && b.level === 1) t = plainText(b.children, (p) => lookupVariable(doc.frontMatter, p));
    });
    return t;
  })();
  return { title: text('title') ?? firstH1 ?? 'Untitled', author: text('author'), date: text('date'), course: text('course'), lang: text('lang') ?? 'en' };
}

const PRINT_CSS = `
body.export { max-width: 46rem; margin: 0 auto; padding: 2rem 1.5rem; }
.export-title { min-height: 80vh; display: flex; flex-direction: column; justify-content: center; align-items: center; text-align: center; page-break-after: always; }
.export-title h1 { font-size: 2.4rem; margin-bottom: 0.5rem; border: 0; }
.export-title p { margin: 0.2rem 0; color: var(--yamd-muted, #666); }
.export-toc { page-break-after: always; }
.export-toc ol { list-style: none; padding-left: 0; }
.export-toc li.l2 { padding-left: 1.2rem; } .export-toc li.l3 { padding-left: 2.4rem; }
.export-toc a { text-decoration: none; color: inherit; }
.export-banner { border: 1px solid #aaa; padding: 0.4rem 0.8rem; margin-bottom: 1.5rem; font-size: 0.85rem; color: #555; }
@page { margin: 2cm; @bottom-center { content: counter(page); font-size: 9pt; color: #666; } }
@media print { .export-banner { display: none; } body.export { padding: 0; max-width: none; } a { color: inherit; } pre, blockquote, table, .study, .callout { break-inside: avoid; } h1, h2, h3 { break-after: avoid; } }
`;

const BASE_CSS = `
:root { --yamd-fg: #1f2328; --yamd-bg: #fff; --yamd-muted: #656d76; --yamd-border: #d0d7de; --yamd-code-bg: #f6f8fa; --yamd-link: #0969da; --yamd-note: #0969da; --yamd-tip: #1a7f37; --yamd-warning: #9a6700; --yamd-danger: #cf222e; }
body { background: var(--yamd-bg); color: var(--yamd-fg); font: 16px/1.6 system-ui, -apple-system, 'Segoe UI', sans-serif; }
`;

function shell(title: string, lang: string, css: string, body: string, bodyClass = 'export', script = ''): string {
  return `<!DOCTYPE html>\n<html lang="${escapeHtml(lang)}"><head><meta charset="UTF-8"><meta name="viewport" content="width=device-width, initial-scale=1">\n<title>${escapeHtml(title)}</title>\n<style>${BASE_CSS}${css}${PRINT_CSS}</style></head>\n<body class="${bodyClass}">${body}${script ? `<script>${script}</script>` : ''}</body></html>\n`;
}

/** A printable page: title page, contents, the note, and the page number in the footer when printed. */
export function documentHtml(doc: YamdDocument, options: ExportOptions): string {
  const m = meta(doc);
  const body = render(doc, { ...options.render, interactive: false });
  const parts: string[] = [];
  if (options.readOnly) parts.push('<div class="export-banner">Read-only copy. Edit the original note, not this file.</div>');
  if (options.titlePage) {
    parts.push(`<section class="export-title"><h1>${escapeHtml(m.title)}</h1>${[m.author, m.course, m.date].filter(Boolean).map((t) => `<p>${escapeHtml(t as string)}</p>`).join('')}</section>`);
  }
  if (options.toc) {
    const items: string[] = [];
    walkBlocks(doc.blocks, (b: Block) => {
      if (b.type === 'heading' && !b.inBoard && b.level <= 3) items.push(`<li class="l${b.level}"><a href="#${escapeHtml(b.id)}">${escapeHtml(plainText(b.children))}</a></li>`);
    });
    if (items.length) parts.push(`<nav class="export-toc"><h2>Contents</h2><ol>${items.join('')}</ol></nav>`);
  }
  parts.push(`<main>${body}</main>`);
  if (options.footer) parts.push(`<footer class="export-footer">${escapeHtml(options.footer)}</footer>`);
  return shell(m.title, m.lang, options.css, parts.join('\n'));
}

/** Splits the top-level blocks into slides at H1/H2 headings and `---` rules. */
export function splitSlides(blocks: Block[]): Block[][] {
  const slides: Block[][] = [];
  let current: Block[] = [];
  const flush = () => {
    if (current.length) slides.push(current);
    current = [];
  };
  for (const b of blocks) {
    if (b.type === 'thematicBreak') flush();
    else {
      if (b.type === 'heading' && b.level <= 2) flush();
      current.push(b);
    }
  }
  flush();
  return slides;
}

const SLIDE_CSS = `
body.slides { margin: 0; overflow: hidden; }
.slide { display: none; box-sizing: border-box; height: 100vh; padding: 5vh 8vw; overflow: auto; font-size: clamp(16px, 2.2vw, 30px); }
.slide.active { display: block; }
.slide.cover { display: none; flex-direction: column; justify-content: center; align-items: center; text-align: center; }
.slide.cover.active { display: flex; }
.slide h1, .slide h2 { margin-top: 0; }
.slide-count { position: fixed; right: 1rem; bottom: 0.6rem; color: var(--yamd-muted); font-size: 0.8rem; }
@media print { body.slides { overflow: visible; } .slide { display: block !important; height: auto; min-height: 100vh; page-break-after: always; } .slide-count { display: none; } }
`;

const SLIDE_JS = `
const slides = [...document.querySelectorAll('.slide')];
let at = Math.max(0, Math.min(slides.length - 1, (parseInt(location.hash.slice(1), 10) || 1) - 1));
const count = document.querySelector('.slide-count');
function show(i) {
  at = Math.max(0, Math.min(slides.length - 1, i));
  slides.forEach((s, n) => s.classList.toggle('active', n === at));
  count.textContent = (at + 1) + ' / ' + slides.length;
  history.replaceState(null, '', '#' + (at + 1));
}
document.addEventListener('keydown', (e) => {
  if (['ArrowRight', 'PageDown', ' ', 'Enter'].includes(e.key)) { e.preventDefault(); show(at + 1); }
  else if (['ArrowLeft', 'PageUp', 'Backspace'].includes(e.key)) { e.preventDefault(); show(at - 1); }
  else if (e.key === 'Home') show(0);
  else if (e.key === 'End') show(slides.length - 1);
});
document.addEventListener('click', (e) => { if (!e.target.closest('a, summary, .cloze, button')) show(e.clientX < innerWidth / 3 ? at - 1 : at + 1); });
show(at);
`;

/** A slide deck: a cover from the front matter, then one slide per section. */
export function slidesHtml(doc: YamdDocument, options: ExportOptions): string {
  const m = meta(doc);
  const ropts = { ...options.render, interactive: false };
  const slides = splitSlides(doc.blocks);
  const html: string[] = [];
  html.push(`<section class="slide cover"><h1>${escapeHtml(m.title)}</h1>${[m.author, m.course, m.date].filter(Boolean).map((t) => `<p>${escapeHtml(t as string)}</p>`).join('')}</section>`);
  // A first slide that is only the document's H1 repeats the cover.
  const rest = slides[0]?.length === 1 && slides[0][0]?.type === 'heading' && (slides[0][0] as Extract<Block, { type: 'heading' }>).level === 1 ? slides.slice(1) : slides;
  for (const blocks of rest) html.push(`<section class="slide">${render({ ...doc, blocks }, ropts)}</section>`);
  html.push('<div class="slide-count" aria-live="polite"></div>');
  return shell(m.title, m.lang, options.css + SLIDE_CSS, html.join('\n'), 'slides', SLIDE_JS);
}
