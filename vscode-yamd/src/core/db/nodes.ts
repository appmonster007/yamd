/** Database views and queries in a document, with the keys their preview placeholders use. */
import { attrString } from '../attrs';
import { eachInline } from '../notes';
import { walkBlocks } from '../parser';
import type { Attrs, Range, YamdDocument } from '../types';

export interface DbNode {
  /** Placeholder key: `v<line>` for views, `q<line>` for query blocks, `i<offset>` for inline queries. */
  key: string;
  kind: 'view' | 'block' | 'inline';
  line: number;
  range: Range;
  /** Database alias or path (`::db[ref]` or `db=`); undefined means the notes tables. */
  ref?: string;
  sql?: string;
  /** `table`, `list` or `value` for query blocks. */
  resultView?: string;
  attrs?: Attrs;
}

export function dbNodes(doc: YamdDocument): DbNode[] {
  const out: DbNode[] = [];
  walkBlocks(doc.blocks, (b) => {
    const range = { start: doc.lineStarts[b.line] ?? 0, end: (doc.lineStarts[b.endLine] ?? 0) + (doc.lines[b.endLine]?.length ?? 0) };
    if (b.type === 'leaf' && b.name === 'db') {
      out.push({ key: `v${b.line}`, kind: 'view', line: b.line, range, ref: b.rawLabel.trim(), attrs: b.attrs });
    } else if (b.type === 'code' && b.lang === 'query') {
      out.push({
        key: `q${b.line}`,
        kind: 'block',
        line: b.line,
        range,
        ref: attrString(b.attrs, 'db'),
        sql: b.value,
        resultView: attrString(b.attrs, 'view') ?? 'table',
        attrs: b.attrs,
      });
    }
  });
  eachInline(doc, (n) => {
    if (n.type !== 'directive' || n.name !== 'query') return;
    const raw = doc.source.slice(n.range.start, n.range.end);
    const open = raw.indexOf('[');
    const close = raw.lastIndexOf(']');
    const line = doc.lineStarts.findIndex((s, i) => s <= n.range.start && (doc.lineStarts[i + 1] ?? Infinity) > n.range.start);
    out.push({
      key: `i${n.range.start}`,
      kind: 'inline',
      line,
      range: n.range,
      ref: attrString(n.attrs, 'db'),
      sql: open !== -1 && close > open ? raw.slice(open + 1, close) : '',
      resultView: 'value',
      attrs: n.attrs,
    });
  });
  return out;
}

