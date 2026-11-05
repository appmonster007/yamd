/**
 * YAMD parser: GFM (via micromark and mdast) plus YAMD's own syntax, converted into YAMD's block
 * and inline types with source positions.
 */
import { MIN_CHUNK_CHARS, planChunks } from './chunking';
import type { Definition } from './chunking';
import { extractFrontMatter, lookupVariable } from './frontmatter';
import { plainText } from './inline';
import { SlugRegistry, slugify } from './slug';
import type { Attrs, Block, Diagnostic, FootnoteDef, Range, RefDef, YamdDocument } from './types';
import { Adapter, prepareLines, toMdast } from './adapter';
import { KNOWN_CONTAINERS, KNOWN_LEAVES } from './known';

export { KNOWN_CONTAINERS, KNOWN_LEAVES };
export { yamdSyntaxOffsets } from './adapter';


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

/**
 * Recently parsed documents, newest last. One edit makes the index, diagnostics, preview, link
 * provider and outline all parse the same text, so they share one parse. Documents are never
 * modified after parsing, which is what makes sharing safe.
 */
const CACHE_ENTRIES = 64;
/** Total source characters kept, so a few huge documents can't hold all the memory. */
const CACHE_CHARS = 8_000_000;
const cache = new Map<string, YamdDocument>();
let cachedChars = 0;

/** Parses `source`, reusing the result of an earlier parse of the same text. Don't modify the result. */
export function parse(source: string): YamdDocument {
  const hit = cache.get(source);
  if (hit) {
    // Move to the newest position.
    cache.delete(source);
    cache.set(source, hit);
    return hit;
  }
  const doc = parseUncached(source);
  if (source.length <= CACHE_CHARS / 2) {
    cache.set(source, doc);
    cachedChars += source.length;
    for (const [key] of cache) {
      if (cache.size <= CACHE_ENTRIES && cachedChars <= CACHE_CHARS) break;
      cache.delete(key);
      cachedChars -= key.length;
    }
  }
  return doc;
}

/** Documents at least this long are parsed in cached chunks (see chunking.ts). */
const CHUNKED_MIN_CHARS = 30_000;

type ParseMode = 'auto' | 'full' | 'chunked';

/** Smallest chunk worth parsing separately. Tests lower it to exercise every possible split. */
let chunkMinChars = MIN_CHUNK_CHARS;
export function setChunkMinChars(n: number): void {
  chunkMinChars = n;
  chunkCache.clear();
  chunkCacheChars = 0;
}

/** The lines of a source text and the form micromark will read. */
interface Prelude {
  lines: string[];
  lineStarts: number[];
  prepared: ReturnType<typeof prepareLines>;
}

function prelude(source: string): Prelude {
  const rawLines = source.split('\n');
  const lineStarts: number[] = [];
  const lines: string[] = [];
  let offset = 0;
  for (const raw of rawLines) {
    lineStarts.push(offset);
    lines.push(raw.endsWith('\r') ? raw.slice(0, -1) : raw);
    offset += raw.length + 1;
  }
  return { lines, lineStarts, prepared: prepareLines(rawLines) };
}

export function parseUncached(source: string, mode: ParseMode = 'auto'): YamdDocument {
  const pre = prelude(source);
  const { lines, lineStarts, prepared } = pre;

  let doc: YamdDocument | null = null;
  if (mode === 'chunked' || (mode === 'auto' && source.length >= CHUNKED_MIN_CHARS)) {
    doc = parseChunked(source, pre);
  }
  if (!doc) {
    const tree = toMdast(prepared.text.join('\n'));
    const adapter = new Adapter(source, lines, prepared.attrs);
    for (const n of prepared.comments) adapter.verbatim.add(n);
    const blocks = adapter.blocks(tree.children ?? []);
    doc = {
      source,
      lines,
      lineStarts,
      frontMatter: null,
      blocks,
      footnotes: adapter.footnotes,
      refs: adapter.refs,
      verbatimLines: adapter.verbatim,
      diagnostics: adapter.diagnostics,
    };
  }
  doc.frontMatter = extractFrontMatter(lines);
  markBoardHeadings(doc.blocks);
  assignHeadingIds(doc);
  return doc;
}

// ---- Chunked parsing ----

/** Whether a line, parsed alone, is a reference or footnote definition. Answers are remembered. */
const definitionAnswers = new Map<string, boolean>();
export function isDefinitionLine(line: string): boolean {
  let answer = definitionAnswers.get(line);
  if (answer === undefined) {
    const type = (toMdast(line).children?.[0] as { type?: string } | undefined)?.type;
    answer = type === 'definition' || type === 'footnoteDefinition';
    if (definitionAnswers.size > 5000) definitionAnswers.clear();
    definitionAnswers.set(line, answer);
  }
  return answer;
}

/** One chunk's parse, in coordinates local to the chunk (after its header). */
interface LocalChunk {
  blocks: Block[];
  diagnostics: Diagnostic[];
  footnotes: [string, FootnoteDef][];
  refs: [string, RefDef][];
  verbatim: number[];
  /** Lines and characters of the header placed before the chunk's own text. */
  headerLines: number;
  headerChars: number;
}

/** Parsed chunks by their text. The budget is in characters of source, which bounds memory. */
const CHUNK_CACHE_CHARS = 6_000_000;
const chunkCache = new Map<string, LocalChunk>();
let chunkCacheChars = 0;

function chunkCached(key: string): LocalChunk | undefined {
  const hit = chunkCache.get(key);
  if (hit) {
    chunkCache.delete(key);
    chunkCache.set(key, hit);
  }
  return hit;
}

function chunkStore(key: string, value: LocalChunk) {
  chunkCache.set(key, value);
  chunkCacheChars += key.length;
  for (const [k] of chunkCache) {
    if (chunkCacheChars <= CHUNK_CACHE_CHARS) break;
    chunkCache.delete(k);
    chunkCacheChars -= k.length;
  }
}

/** A copy of `value` with every position moved by the given line and character offsets. */
function shifted<T>(value: T, dLine: number, dChar: number): T {
  if (Array.isArray(value)) return value.map((v) => shifted(v, dLine, dChar)) as T;
  if (value === null || typeof value !== 'object') return value;
  const out: Record<string, unknown> = {};
  for (const key in value as Record<string, unknown>) {
    const v = (value as Record<string, unknown>)[key];
    if (key === 'range' && v && typeof v === 'object') {
      const r = v as Range;
      out[key] = { start: r.start + dChar, end: r.end + dChar };
    } else if ((key === 'line' || key === 'endLine') && typeof v === 'number') out[key] = v + dLine;
    else out[key] = shifted(v, dLine, dChar);
  }
  return out as T;
}

/** What a chunk needs defined to resolve its references: the definitions it mentions by label. */
function headerFor(definitions: Definition[], chunkText: string, from: number, to: number): string[] {
  if (!definitions.length) return [];
  const text = chunkText.toLowerCase().replace(/\s+/g, ' ');
  // Labels match without regard to case and Unicode folding (`ẞ` is `SS`), and escapes and entities
  // can hide a label's spelling. Adding definitions is always safe, so unusual text gets them all.
  const everything = /[\\&\u0080-\uffff]/.test(chunkText);
  const out: string[] = [];
  for (const d of definitions) {
    // A definition inside this chunk is parsed there; repeating it in the header would make the real one a duplicate.
    if (d.at >= from && d.at < to) continue;
    const label = d.label.toLowerCase().replace(/\s+/g, ' ');
    if (everything || text.includes(`[${label}]`)) out.push(d.line);
  }
  return out;
}

/** One chunk to parse: where it goes, what identifies its parse, and how to make it. */
interface ChunkJob {
  /** First line of the chunk in the document. */
  a: number;
  key: string;
  build(): LocalChunk;
}

/** Splits a document into chunk jobs, or returns null when it can't be split safely. */
function chunkJobs(source: string, pre: Prelude): ChunkJob[] | null {
  const { lines, lineStarts, prepared } = pre;
  const plan = planChunks(prepared.text, chunkMinChars, isDefinitionLine);
  if (!plan || plan.starts.length < 2) return null;

  return plan.starts.map((a, i): ChunkJob => {
    const b = plan.starts[i + 1] ?? lines.length;
    const text = prepared.text.slice(a, b).join('\n');
    const original = source.slice(lineStarts[a] as number, b < lines.length ? (lineStarts[b] as number) - 1 : source.length);

    // A header of the definitions this chunk uses, then a blank line. The blank line keeps a chunk
    // that starts with `---` from being read as front matter and a title from attaching to a definition.
    // Front matter has no references and must start its text, so it takes no header at all.
    const bare = i === 0 && plan.frontMatter;
    const header = bare ? [] : headerFor(plan.definitions, text, a, b);
    // Each definition gets its own blank line: a footnote's text would otherwise take the next line.
    // A final paragraph ends the last footnote, whose body would otherwise continue into an indented first line.
    const prefix = bare ? '' : header.length ? `${header.map((h) => `${h}\n\n`).join('')}.\n\n` : '\n';
    const headerLines = bare ? 0 : header.length ? header.length * 2 + 2 : 1;
    const key = original === text ? `${prefix}\u0000${text}` : `${prefix}\u0000${text}\u0000${original}`;

    return {
      a,
      key,
      build() {
        const chunkLines = [...(bare ? [] : header.length ? [...header.flatMap((h) => [h, '']), '.', ''] : ['']), ...lines.slice(a, b)];
        const attrs = new Map<number, Attrs | undefined>();
        for (const [line, value] of prepared.attrs) if (line >= a && line < b) attrs.set(line - a + headerLines, value);
        const adapter = new Adapter(prefix + original, chunkLines, attrs);
        const tree = toMdast(prefix + text);
        // The separator paragraph in the header isn't part of the document.
        const parsed = adapter.blocks(tree.children ?? []).filter((block) => block.line >= headerLines);
        return {
          blocks: parsed,
          diagnostics: adapter.diagnostics.filter((d) => d.range.start >= prefix.length),
          footnotes: [...adapter.footnotes].filter(([, def]) => def.line >= headerLines),
          refs: [...adapter.refs],
          verbatim: [...adapter.verbatim].filter((l) => l >= headerLines),
          headerLines,
          headerChars: prefix.length,
        };
      },
    };
  });
}

/**
 * Parses a large document chunk by chunk, reusing the cached parse of every chunk whose text is
 * unchanged. Returns null when the document can't be split safely, and the caller parses it whole.
 */
function parseChunked(source: string, pre: Prelude): YamdDocument | null {
  const jobs = chunkJobs(source, pre);
  if (!jobs) return null;
  const { lines, lineStarts, prepared } = pre;

  const blocks: Block[] = [];
  const diagnostics: Diagnostic[] = [];
  const footnotes = new Map<string, FootnoteDef>();
  const refs = new Map<string, RefDef>();
  const verbatim = new Set<number>(prepared.comments);

  for (const job of jobs) {
    let local = chunkCached(job.key);
    if (!local) {
      local = job.build();
      chunkStore(job.key, local);
    }
    // Local line L of the chunk is line a + (L - headerLines) of the document, and likewise for characters.
    const dLine = job.a - local.headerLines;
    const dChar = (lineStarts[job.a] as number) - local.headerChars;
    for (const block of shifted(local.blocks, dLine, dChar)) blocks.push(block);
    for (const d of shifted(local.diagnostics, dLine, dChar)) diagnostics.push(d);
    for (const [id, def] of shifted(local.footnotes, dLine, dChar)) if (!footnotes.has(id)) footnotes.set(id, def);
    for (const [id, ref] of local.refs) if (!refs.has(id)) refs.set(id, ref);
    for (const l of local.verbatim) verbatim.add(l + dLine);
  }

  return { source, lines, lineStarts, frontMatter: null, blocks, footnotes, refs, verbatimLines: verbatim, diagnostics };
}
