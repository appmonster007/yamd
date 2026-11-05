/** Absolute character offsets into the source document. */
export interface Range {
  start: number;
  end: number;
}

export interface Attrs {
  id?: string;
  classes: string[];
  /** Key/value pairs. Bare flags such as `decorative` map to `true`. */
  values: Record<string, string | true>;
}

export type InlineNode =
  | { type: 'text'; value: string; range: Range }
  /** A line break. `soft` marks a plain newline (Markdown's soft wrap) rather than `\` or two spaces. */
  | { type: 'break'; soft?: boolean; range: Range }
  | { type: 'emphasis'; kind: EmphasisKind; children: InlineNode[]; range: Range }
  | { type: 'code'; value: string; range: Range }
  | { type: 'math'; value: string; range: Range }
  | {
      type: 'link';
      kind: 'inline' | 'reference' | 'auto' | 'wiki';
      /** Destination as written (for wikilinks, the resolved file path and anchor). */
      href: string;
      /** For reference links, the label to look up. */
      label?: string;
      title?: string;
      children: InlineNode[];
      attrs?: Attrs;
      range: Range;
    }
  | {
      type: 'image';
      src: string;
      label?: string;
      alt: string;
      title?: string;
      attrs?: Attrs;
      range: Range;
    }
  | { type: 'span'; children: InlineNode[]; attrs: Attrs; range: Range }
  | { type: 'footnoteRef'; id: string; range: Range }
  /** Raw HTML (an inline tag or comment), sanitized when rendered. */
  | { type: 'html'; value: string; range: Range }
  | { type: 'tag'; name: string; range: Range }
  /** Attributes that couldn't be attached to anything; rendered as their source text. */
  | { type: 'attrs'; attrs: Attrs; raw: string; range: Range };

export type EmphasisKind =
  | 'italic'
  | 'bold'
  | 'boldItalic'
  | 'underline'
  | 'strike'
  | 'highlight'
  | 'sub'
  | 'sup';

interface BlockBase {
  /** First and last source line (0-based, inclusive). */
  line: number;
  endLine: number;
  attrs?: Attrs;
  /** Block ID from a trailing ` ^id`. */
  blockId?: string;
}

export interface ParagraphBlock extends BlockBase {
  type: 'paragraph';
  children: InlineNode[];
  /** Raw paragraph lines, used by the linter. */
  rawLines: string[];
}

export interface HeadingBlock extends BlockBase {
  type: 'heading';
  level: number;
  children: InlineNode[];
  id: string;
  /** True for column headings inside a `:::kanban` board, which aren't part of the document outline. */
  inBoard?: boolean;
}

export interface ListItem {
  line: number;
  endLine: number;
  task?: 'open' | 'done';
  attrs?: Attrs;
  /** True when the item's blocks are separated by blank lines (renders paragraphs with `<p>`). */
  spread: boolean;
  children: Block[];
}

export interface ListBlock extends BlockBase {
  type: 'list';
  ordered: boolean;
  start: number;
  /** True for a loose list: items separated by blank lines. */
  spread: boolean;
  /** The bullet character or ordered delimiter, e.g. `-` or `.`. */
  marker: string;
  items: ListItem[];
}

export interface QuoteBlock extends BlockBase {
  type: 'blockquote';
  children: Block[];
}

export interface CodeBlock extends BlockBase {
  type: 'code';
  lang: string;
  value: string;
  closed: boolean;
}

export interface MathBlock extends BlockBase {
  type: 'math';
  value: string;
}

/** A raw HTML block, sanitized when rendered. */
export interface HtmlBlock extends BlockBase {
  type: 'html';
  value: string;
}

export interface ThematicBreakBlock extends BlockBase {
  type: 'thematicBreak';
}

export type Align = 'left' | 'center' | 'right' | null;

export interface TableCell {
  children: InlineNode[];
  attrs?: Attrs;
}

export interface TableBlock extends BlockBase {
  type: 'table';
  align: Align[];
  header: TableCell[];
  rows: TableCell[][];
}

export interface ContainerBlock extends BlockBase {
  type: 'container';
  name: string;
  children: Block[];
  /** Unparsed body, kept for `:::html`. */
  raw: string;
}

export interface LeafBlock extends BlockBase {
  type: 'leaf';
  name: string;
  label: InlineNode[];
  /** Label text as written, e.g. the depth in `::toc{depth=2}` or the URL in `::embed[url]`. */
  rawLabel: string;
}

export type Block =
  | ParagraphBlock
  | HeadingBlock
  | ListBlock
  | QuoteBlock
  | CodeBlock
  | MathBlock
  | ThematicBreakBlock
  | HtmlBlock
  | TableBlock
  | ContainerBlock
  | LeafBlock;

export type Severity = 'error' | 'warning' | 'info';

export interface Diagnostic {
  code: string;
  severity: Severity;
  message: string;
  range: Range;
}

export interface FrontMatter {
  data: Record<string, unknown>;
  line: number;
  endLine: number;
  error?: string;
}

export interface FootnoteDef {
  id: string;
  children: Block[];
  line: number;
}

export interface RefDef {
  url: string;
  title?: string;
}

export interface YamdDocument {
  source: string;
  lines: string[];
  /** Absolute offset of the start of each line. */
  lineStarts: number[];
  frontMatter: FrontMatter | null;
  blocks: Block[];
  footnotes: Map<string, FootnoteDef>;
  refs: Map<string, RefDef>;
  /** Lines whose content is verbatim (code, math, front matter, raw HTML). */
  verbatimLines: Set<number>;
  diagnostics: Diagnostic[];
}
