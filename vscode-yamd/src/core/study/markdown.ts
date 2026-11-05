/**
 * Plain Markdown export: a simplified, portable rendering of a YAMD document for tools that only
 * understand GFM. Inline formatting is flattened to plain text (see `plainText`); this trades
 * fidelity for guaranteed-valid output, matching the "doesn't need to round-trip" use case of
 * sharing a note outside YAMD-aware tooling.
 */
import { lookupVariable } from '../frontmatter';
import { plainText } from '../inline';
import type { Block, YamdDocument } from '../types';

export interface MarkdownExportOptions {
  /** Prepended before the body, e.g. a footer note about the export. */
  footer?: string;
}

function text(doc: YamdDocument, nodes: Parameters<typeof plainText>[0]): string {
  return plainText(nodes, (p) => lookupVariable(doc.frontMatter, p));
}

function renderBlocks(doc: YamdDocument, blocks: Block[], out: string[]): void {
  for (const b of blocks) renderBlock(doc, b, out);
}

function renderBlock(doc: YamdDocument, b: Block, out: string[]): void {
  switch (b.type) {
    case 'heading':
      out.push(`${'#'.repeat(b.level)} ${text(doc, b.children)}`, '');
      break;
    case 'paragraph':
      out.push(text(doc, b.children), '');
      break;
    case 'list':
      b.items.forEach((item, i) => {
        const marker = b.ordered ? `${b.start + i}.` : b.marker;
        const task = item.task ? `[${item.task === 'done' ? 'x' : ' '}] ` : '';
        const first = item.children[0];
        const firstText = first?.type === 'paragraph' ? text(doc, first.children) : '';
        out.push(`${marker} ${task}${firstText}`);
        for (const child of item.children.slice(first?.type === 'paragraph' ? 1 : 0)) {
          const nested: string[] = [];
          renderBlock(doc, child, nested);
          for (const line of nested) out.push(line ? `  ${line}` : line);
        }
      });
      out.push('');
      break;
    case 'blockquote': {
      const inner: string[] = [];
      renderBlocks(doc, b.children, inner);
      for (const line of inner) out.push(line ? `> ${line}` : '>');
      out.push('');
      break;
    }
    case 'code':
      out.push(`\`\`\`${b.lang}`, b.value.replace(/\n$/, ''), '```', '');
      break;
    case 'math':
      out.push('$$', b.value.replace(/\n$/, ''), '$$', '');
      break;
    case 'thematicBreak':
      out.push('---', '');
      break;
    case 'table': {
      const row = (cells: { children: Parameters<typeof plainText>[0] }[]) => `| ${cells.map((c) => text(doc, c.children)).join(' | ')} |`;
      out.push(row(b.header), `| ${b.align.map(() => '---').join(' | ')} |`, ...b.rows.map(row), '');
      break;
    }
    case 'container':
      out.push(`:::${b.name}`);
      renderBlocks(doc, b.children, out);
      out.push(':::', '');
      break;
    case 'leaf':
      out.push(`::${b.name}${b.rawLabel ? `[${b.rawLabel}]` : ''}`, '');
      break;
    case 'html':
      out.push(b.value, '');
      break;
  }
}

/** Renders a YAMD document as plain Markdown text. */
export function documentMarkdown(doc: YamdDocument, opts: MarkdownExportOptions = {}): string {
  const out: string[] = [];
  const fm = doc.frontMatter;
  if (fm && Object.keys(fm.data).length) {
    out.push('---');
    for (const [k, v] of Object.entries(fm.data)) out.push(`${k}: ${typeof v === 'string' ? v : JSON.stringify(v)}`);
    out.push('---', '');
  }
  renderBlocks(doc, doc.blocks, out);
  if (opts.footer) out.push('', `<!-- ${opts.footer} -->`);
  return out.join('\n').replace(/\n{3,}/g, '\n\n').trimEnd() + '\n';
}
