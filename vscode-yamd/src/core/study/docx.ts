/**
 * Word export (§6.6): builds a .docx from the parsed document. Review markup is accepted, images
 * become their alt text, and math is kept as TeX in italics.
 */
import { attrString } from '../attrs';
import { lookupVariable } from '../frontmatter';
import { plainText } from '../inline';
import { buildBoard } from '../kanban';
import { Bibliography, parseCitation } from './bibtex';
import { STUDY_BY_NAME } from './blocks';
import type { Block, InlineNode, ListBlock, TableCell, YamdDocument } from '../types';
import { zip } from './zip';

export interface DocxOptions {
  title?: string;
  author?: string;
  date?: string;
  bibliography?: Bibliography;
  /** Adds a title page and a contents list. */
  titlePage?: boolean;
}

const esc = (s: string) => s.replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c] as string);

interface RunStyle {
  b?: boolean;
  i?: boolean;
  u?: boolean;
  strike?: boolean;
  mark?: boolean;
  sub?: boolean;
  sup?: boolean;
  code?: boolean;
}

class DocxBuilder {
  readonly links: string[] = [];
  private quoted = 0;
  readonly headings: { level: number; text: string }[] = [];

  constructor(
    private readonly doc: YamdDocument,
    private readonly options: DocxOptions,
  ) {}

  private run(text: string, st: RunStyle = {}): string {
    if (!text) return '';
    const props = [
      st.code ? '<w:rFonts w:ascii="Consolas" w:hAnsi="Consolas" w:cs="Consolas"/>' : '',
      st.b ? '<w:b/>' : '',
      st.i ? '<w:i/>' : '',
      st.strike ? '<w:strike/>' : '',
      st.mark ? '<w:highlight w:val="yellow"/>' : '',
      st.u ? '<w:u w:val="single"/>' : '',
      st.sub ? '<w:vertAlign w:val="subscript"/>' : '',
      st.sup ? '<w:vertAlign w:val="superscript"/>' : '',
    ].join('');
    return `<w:r>${props ? `<w:rPr>${props}</w:rPr>` : ''}<w:t xml:space="preserve">${esc(text)}</w:t></w:r>`;
  }

  inline(nodes: InlineNode[], st: RunStyle = {}): string {
    return nodes.map((n) => this.inlineNode(n, st)).join('');
  }

  private inlineNode(n: InlineNode, st: RunStyle): string {
    switch (n.type) {
      case 'text':
        return this.run(n.value, st);
      case 'break':
        return n.soft ? this.run(' ', st) : '<w:r><w:br/></w:r>';
      case 'code':
        return this.run(n.value, { ...st, code: true });
      case 'math':
        return this.run(n.value, { ...st, i: true });
      case 'emphasis': {
        const next: RunStyle = { ...st };
        if (n.kind === 'italic') next.i = true;
        else if (n.kind === 'bold') next.b = true;
        else if (n.kind === 'boldItalic') next.b = next.i = true;
        else if (n.kind === 'underline') next.u = true;
        else if (n.kind === 'strike') next.strike = true;
        else if (n.kind === 'highlight') next.mark = true;
        else if (n.kind === 'sub') next.sub = true;
        else next.sup = true;
        return this.inline(n.children, next);
      }
      case 'link': {
        const body = this.inline(n.children, { ...st, u: true });
        if (!/^https?:/i.test(n.href)) return body;
        this.links.push(n.href);
        return `<w:hyperlink r:id="rIdLink${this.links.length}">${body}</w:hyperlink>`;
      }
      case 'image':
        return this.run(`[${n.alt || 'image'}]`, { ...st, i: true });
      case 'span':
      case 'inlineFootnote':
        return this.inline(n.children, st);
      case 'footnoteRef':
        return this.run(`[${n.id}]`, { ...st, sup: true });
      case 'crossRef':
        return this.run(n.id, st);
      case 'citation': {
        const bib = this.options.bibliography;
        return this.run(bib ? bib.cite(parseCitation(n.raw)) : `[${n.raw.replace(/@/g, '')}]`, st);
      }
      case 'variable':
        return this.run(lookupVariable(this.doc.frontMatter, n.path) ?? n.raw, st);
      case 'review':
        return n.kind === 'insert' ? this.inline(n.children, st) : '';
      case 'reviewSubstitute':
        return this.inline(n.to, st);
      case 'reviewHighlight':
        return this.inline(n.children, st);
      case 'reviewComment':
      case 'html':
      case 'attrs':
        return '';
      case 'directive':
        return n.name === 'kbd' ? this.run(plainText(n.children), { ...st, code: true }) : this.inline(n.children, st);
      case 'tag':
        return this.run(`#${n.name}`, st);
      case 'embed':
        return this.run(n.target, st);
    }
  }

  private para(inner: string, opts: { style?: string; indent?: number; align?: string; keepNext?: boolean; border?: 'left' | 'bottom'; shade?: boolean } = {}): string {
    const p = [
      opts.style ? `<w:pStyle w:val="${opts.style}"/>` : '',
      opts.keepNext ? '<w:keepNext/>' : '',
      opts.border || this.quoted ? `<w:pBdr><w:${opts.border ?? 'left'} w:val="single" w:sz="8" w:space="4" w:color="888888"/></w:pBdr>` : '',
      opts.shade ? '<w:shd w:val="clear" w:color="auto" w:fill="F2F2F2"/>' : '',
      opts.indent ? `<w:ind w:left="${opts.indent * 360}"/>` : '',
      opts.align ? `<w:jc w:val="${opts.align}"/>` : '',
    ].join('');
    return `<w:p>${p ? `<w:pPr>${p}</w:pPr>` : ''}${inner}</w:p>`;
  }

  blocks(blocks: Block[], indent = 0): string {
    return blocks.map((b) => this.block(b, indent)).join('');
  }

  private block(b: Block, indent: number): string {
    switch (b.type) {
      case 'paragraph':
        return this.para(this.inline(b.children), { indent });
      case 'heading': {
        const level = Math.min(6, b.level);
        if (!b.inBoard) this.headings.push({ level, text: plainText(b.children) });
        return this.para(this.inline(b.children), { style: `Heading${level}`, keepNext: true });
      }
      case 'list':
        return this.list(b, indent);
      case 'blockquote': {
        this.quoted++;
        const out = this.blocks(b.children, indent + 1);
        this.quoted--;
        return out;
      }
      case 'code':
        return (b.value.replace(/\n$/, '') || ' ').split('\n').map((line) => this.para(this.run(line || ' ', { code: true }), { style: 'Code', indent })).join('');
      case 'math':
        return this.para(this.run(b.value.trim(), { i: true }), { align: 'center' });
      case 'thematicBreak':
        return this.para('', { border: 'bottom' });
      case 'html':
        return '';
      case 'table':
        return this.table(b.header, b.rows);
      case 'container':
        return this.container(b, indent);
      case 'leaf':
        if (b.name === 'pagebreak') return '<w:p><w:r><w:br w:type="page"/></w:r></w:p>';
        if (b.name === 'toc' || b.name === 'bibliography') return '';
        if (b.name === 'card') return this.para(this.inline(b.label, { b: true })) + this.para(this.run(attrString(b.attrs, 'a') ?? '', { i: true }), { indent: 1 });
        return this.para(this.inline(b.label), { indent });
    }
  }

  private container(b: Extract<Block, { type: 'container' }>, indent: number): string {
    const title = attrString(b.attrs, 'title');
    if (b.name === 'html') return '';
    if (b.name === 'table' || b.name === 'figure' || b.name === 'columns' || b.name === 'column') return this.blocks(b.children, indent);
    if (b.name === 'kanban') {
      const board = buildBoard(b);
      return board.columns
        .map((c) => this.para(this.inline(c.title), { style: 'Heading3' }) + c.cards.map((card) => this.para(this.run('• ') + this.inline(card.title), { indent: 1 })).join(''))
        .join('');
    }
    if (b.name === 'details') return this.para(this.run(attrString(b.attrs, 'summary') ?? 'Details', { b: true })) + this.blocks(b.children, indent + 1);
    const study = STUDY_BY_NAME.get(b.name);
    const label = study?.label ?? (b.name === 'card' ? 'Flashcard' : b.name[0]?.toUpperCase() + b.name.slice(1));
    const head = this.para(this.run(`${label}${title ? ` (${title})` : ''}`, { b: true, i: b.name === 'proof' }), { keepNext: true, shade: true });
    return head + this.blocks(b.children, indent + 1);
  }

  private list(b: ListBlock, indent: number): string {
    let n = b.start;
    return b.items
      .map((item) => {
        const marker = item.task ? (item.task === 'done' ? '☑ ' : '☐ ') : b.ordered ? `${n++}. ` : '• ';
        const [first, ...rest] = item.children;
        const head = first?.type === 'paragraph' ? this.para(this.run(marker) + this.inline(first.children), { indent: indent + 1 }) : this.para(this.run(marker), { indent: indent + 1 }) + (first ? this.block(first, indent + 1) : '');
        return head + this.blocks(rest, indent + 2);
      })
      .join('');
  }

  private table(header: TableCell[], rows: TableCell[][]): string {
    const cell = (c: TableCell, head: boolean) =>
      `<w:tc><w:tcPr><w:tcW w:w="0" w:type="auto"/>${head ? '<w:shd w:val="clear" w:color="auto" w:fill="EEEEEE"/>' : ''}</w:tcPr>${this.para(this.inline(c.children, head ? { b: true } : {}))}</w:tc>`;
    const row = (cells: TableCell[], head: boolean) => `<w:tr>${cells.map((c) => cell(c, head)).join('')}</w:tr>`;
    const border = ['top', 'left', 'bottom', 'right', 'insideH', 'insideV'].map((s) => `<w:${s} w:val="single" w:sz="4" w:space="0" w:color="999999"/>`).join('');
    return `<w:tbl><w:tblPr><w:tblW w:w="5000" w:type="pct"/><w:tblBorders>${border}</w:tblBorders></w:tblPr>${row(header, true)}${rows.map((r) => row(r, false)).join('')}</w:tbl>${this.para('')}`;
  }
}

const STYLES = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<w:styles xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main">
<w:docDefaults><w:rPrDefault><w:rPr><w:rFonts w:ascii="Calibri" w:hAnsi="Calibri" w:cs="Calibri"/><w:sz w:val="22"/><w:lang w:val="en-US"/></w:rPr></w:rPrDefault><w:pPrDefault><w:pPr><w:spacing w:after="120" w:line="276" w:lineRule="auto"/></w:pPr></w:pPrDefault></w:docDefaults>
<w:style w:type="paragraph" w:default="1" w:styleId="Normal"><w:name w:val="Normal"/></w:style>
${[32, 28, 26, 24, 22, 22].map((sz, i) => `<w:style w:type="paragraph" w:styleId="Heading${i + 1}"><w:name w:val="heading ${i + 1}"/><w:basedOn w:val="Normal"/><w:next w:val="Normal"/><w:qFormat/><w:pPr><w:keepNext/><w:spacing w:before="${i === 0 ? 360 : 240}" w:after="120"/><w:outlineLvl w:val="${i}"/></w:pPr><w:rPr><w:b/><w:sz w:val="${sz}"/></w:rPr></w:style>`).join('\n')}
<w:style w:type="paragraph" w:styleId="Title"><w:name w:val="Title"/><w:basedOn w:val="Normal"/><w:qFormat/><w:pPr><w:spacing w:before="2400" w:after="240"/><w:jc w:val="center"/></w:pPr><w:rPr><w:b/><w:sz w:val="56"/></w:rPr></w:style>
<w:style w:type="paragraph" w:styleId="Code"><w:name w:val="Code"/><w:basedOn w:val="Normal"/><w:pPr><w:shd w:val="clear" w:color="auto" w:fill="F4F4F4"/><w:spacing w:after="0" w:line="240" w:lineRule="auto"/></w:pPr><w:rPr><w:rFonts w:ascii="Consolas" w:hAnsi="Consolas" w:cs="Consolas"/><w:sz w:val="19"/></w:rPr></w:style>
</w:styles>`;

export function buildDocx(doc: YamdDocument, options: DocxOptions = {}): Uint8Array {
  const b = new DocxBuilder(doc, options);
  const body = b.blocks(doc.blocks);
  const page = '<w:p><w:r><w:br w:type="page"/></w:r></w:p>';
  const cover: string[] = [];
  if (options.titlePage && options.title) {
    const line = (t: string | undefined, style?: string) => (t ? `<w:p>${style ? `<w:pPr><w:pStyle w:val="${style}"/></w:pPr>` : '<w:pPr><w:jc w:val="center"/></w:pPr>'}<w:r><w:t xml:space="preserve">${esc(t)}</w:t></w:r></w:p>` : '');
    cover.push(line(options.title, 'Title'), line(options.author), line(options.date));
    if (b.headings.length) {
      cover.push(page, '<w:p><w:pPr><w:pStyle w:val="Heading1"/></w:pPr><w:r><w:t>Contents</w:t></w:r></w:p>');
      for (const h of b.headings.filter((h) => h.level <= 3)) cover.push(`<w:p><w:pPr><w:ind w:left="${(h.level - 1) * 360}"/></w:pPr><w:r><w:t xml:space="preserve">${esc(h.text)}</w:t></w:r></w:p>`);
    }
    cover.push(page);
  }
  let refs = '';
  if (options.bibliography?.order.length) {
    const entries = options.bibliography.references().match(/<li[^>]*>[\s\S]*?<\/li>/g) ?? [];
    refs = `<w:p><w:pPr><w:pStyle w:val="Heading1"/></w:pPr><w:r><w:t>References</w:t></w:r></w:p>${entries
      .map((li, i) => `<w:p><w:pPr><w:ind w:left="480" w:hanging="480"/></w:pPr><w:r><w:t xml:space="preserve">${esc((options.bibliography?.style === 'ieee' ? `[${i + 1}] ` : '') + li.replace(/<[^>]+>/g, '').replace(/&amp;/g, '&').replace(/&quot;/g, '"'))}</w:t></w:r></w:p>`)
      .join('')}`;
  }
  const ns = 'xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships"';
  const document = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\n<w:document ${ns}><w:body>${cover.join('')}${body}${refs}<w:sectPr><w:pgSz w:w="11906" w:h="16838"/><w:pgMar w:top="1440" w:right="1440" w:bottom="1440" w:left="1440" w:header="708" w:footer="708" w:gutter="0"/></w:sectPr></w:body></w:document>`;
  const rels = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\n<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rIdStyles" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/styles" Target="styles.xml"/>${b.links
    .map((href, i) => `<Relationship Id="rIdLink${i + 1}" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/hyperlink" Target="${esc(href)}" TargetMode="External"/>`)
    .join('')}</Relationships>`;
  return zip([
    { name: '[Content_Types].xml', data: `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\n<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/><Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/><Override PartName="/word/styles.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.styles+xml"/></Types>` },
    { name: '_rels/.rels', data: `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\n<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="word/document.xml"/></Relationships>` },
    { name: 'word/document.xml', data: document },
    { name: 'word/styles.xml', data: STYLES },
    { name: 'word/_rels/document.xml.rels', data: rels },
  ]);
}
