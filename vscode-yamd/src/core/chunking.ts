/**
 * Splits a document into chunks that can be parsed on their own and cached, so an edit in a large
 * note re-parses a few kilobytes instead of the whole file.
 *
 * A chunk starts after a blank line, at a line that can't continue anything above it. Everything
 * here is conservative: when a line might belong to a block that spans blank lines (a fenced code
 * block, an HTML comment, a directive container, a list, a footnote with indented paragraphs), the
 * split is skipped, and anything the scan can't be sure about returns `null`, which makes the caller
 * parse the whole document. The result must match a full parse exactly; `test/chunking.test.ts`
 * checks that against the examples, the CommonMark suite and generated documents.
 */

export interface ChunkPlan {
  /** First line of each chunk, in order. The first is always 0. */
  starts: number[];
  /** Reference and footnote definitions found at the top level, first occurrence of each label. */
  definitions: Definition[];
  /** The first chunk is the front matter alone, which must be parsed at the very start of its text. */
  frontMatter: boolean;
}

export interface Definition {
  /** The label as written, used to decide which chunks reference it. */
  label: string;
  /** A one-line definition to prepend to chunks that use it, so their references resolve. */
  line: string;
  /** The line it is on. A chunk holding it must not also get it in a header, or the real one is a duplicate. */
  at: number;
}

/** Why the last call gave up (for tests and diagnostics). */
export let lastBailReason = '';
function bail(reason: string, line: number): null {
  lastBailReason = `${reason} at line ${line + 1}`;
  return null;
}

/** Chunks are grown to at least this many characters before a split is taken. */
export const MIN_CHUNK_CHARS = 3000;

const BLANK = /^[ \t\r]*$/;
const FENCE_OPEN = /^ {0,3}(`{3,}|~{3,})(.*)$/;
/** A fence after one or more list markers: `- ```js`, `1. - ~~~`. */
const NESTED_FENCE = /^(?:(?:[-*+]|\d{1,9}[.)])[ \t]+)+(?:`{3,}|~{3,})/;
const FENCE_CLOSE = /^ {0,3}(`{3,}|~{3,})[ \t\r]*$/;
const MATH_OPEN = /^ {0,3}(\${2,})([^$]*)$/;
const MATH_CLOSE = /^ {0,3}(\${2,})[ \t\r]*$/;
const DIRECTIVE_OPEN = /^ {0,3}(:{3,})[ \t]*[A-Za-z]/;
const DIRECTIVE_CLOSE = /^ {0,3}(:{3,})[ \t\r]*$/;
const LIST_MARKER = /^ {0,3}(?:[-*+]|\d{1,9}[.)])(?:[ \t]|$)/;
/** A definition behind a quote or list prefix, which can't be shared with other chunks. */
const NESTED_DEFINITION = /^(?:[ \t]*(?:>|[-*+]|\d{1,9}[.)])[ \t]*)+\[[^\]\n[]+\]:/;
/** A definition indented like code, or by a tab. */
const INDENTED_DEFINITION = /^(?: {4,}|[ ]*\t)[ \t]*\[[^\]\n[]+\]:/;
/** A one-line definition at the top level: `[label]: destination ...`. */
const DEFINITION = /^ {0,3}\[([^\]\n]+)\]:[ \t]*(\S.*)$/;

/**
 * An HTML block that can contain blank lines: what ends it, and the part of the opening line after
 * the opener (which may already contain the end). Other HTML blocks end at the next blank line.
 */
function htmlBlock(line: string): { end: RegExp; rest: string } | null {
  let m = /^ {0,3}<(pre|script|style|textarea)(?=[ \t>]|$)/i.exec(line);
  if (m) return { end: new RegExp(`</${m[1]}>`, 'i'), rest: line.slice(m[0].length) };
  m = /^ {0,3}<!--/.exec(line);
  if (m) return { end: /-->/, rest: line.slice(m[0].length) };
  m = /^ {0,3}<\?/.exec(line);
  if (m) return { end: /\?>/, rest: line.slice(m[0].length) };
  m = /^ {0,3}<!\[CDATA\[/.exec(line);
  if (m) return { end: /\]\]>/, rest: line.slice(m[0].length) };
  m = /^ {0,3}<![A-Za-z]/.exec(line);
  if (m) return { end: />/, rest: line.slice(m[0].length) };
  return null;
}

/**
 * Finds where chunks start. `lines` are the lines micromark will see (after comments and directive
 * attributes are blanked). Returns null when the document isn't safe to split.
 */
export function planChunks(
  lines: string[],
  minChars = MIN_CHUNK_CHARS,
  /** Whether the parser reads this line, alone, as a reference or footnote definition. */
  isDefinition: (line: string) => boolean = () => false,
): ChunkPlan | null {
  const starts = [0];
  const definitions: Definition[] = [];
  const seen = new Set<string>();

  let n = 0;
  let frontMatter = false;
  // Front matter is one block, and only the first line of the whole document can open it.
  let size = 0;
  if (lines[0]?.trim() === '---') {
    const end = lines.findIndex((l, k) => k > 0 && l.trim() === '---');
    if (end !== -1) {
      n = end + 1;
      frontMatter = true;
      if (n < lines.length) starts.push(n);
    }
  }

  let fence: { char: string; len: number } | null = null;
  /**
   * A fence inside a list item (or otherwise indented). It lasts only while every line stays at or
   * past its column, so the item can't end inside it. A line that dips below, or an unclosed one
   * when the next block starts, makes this scan unreliable, and the document is parsed whole.
   */
  let nested: { char: string; len: number; col: number } | null = null;
  let html: RegExp | null = null;
  let math: number | null = null;
  const containers: number[] = [];
  let inList = false;
  let pendingBlank = false;
  /** The previous non-blank line was a definition, so another one right after it is one too. */
  let afterDefinition = false;
  let previousBlank = true;
  /** The previous line was indented like code (4 spaces or a tab). The parser reads what follows such a block differently. */
  let afterIndented = false;

  for (; n < lines.length; n++) {
    const line = lines[n] as string;

    if (nested) {
      size += line.length + 1;
      if (!BLANK.test(line)) {
        const col = /^ */.exec(line)?.[0].length ?? 0;
        if (col < nested.col || line.startsWith('\t')) return bail('a line inside a list item\'s code block drops below its indentation', n);
        const close = FENCE_CLOSE.exec(line);
        if (close && (close[1] as string)[0] === nested.char && (close[1] as string).length >= nested.len) nested = null;
      }
      previousBlank = false;
      continue;
    }
    if (fence) {
      size += line.length + 1;
      const close = FENCE_CLOSE.exec(line);
      if (close && (close[1] as string)[0] === fence.char && (close[1] as string).length >= fence.len) fence = null;
      previousBlank = false;
      continue;
    }
    if (html) {
      size += line.length + 1;
      if (html.test(line)) html = null;
      previousBlank = false;
      continue;
    }
    if (math !== null) {
      size += line.length + 1;
      const close = MATH_CLOSE.exec(line);
      if (close && (close[1] as string).length >= math) math = null;
      previousBlank = false;
      continue;
    }

    if (BLANK.test(line)) {
      pendingBlank = true;
      previousBlank = true;
      size += line.length + 1;
      continue;
    }

    const indent = /^ */.exec(line)?.[0].length ?? 0;
    // A tab anywhere in the indentation reaches column 4 or more once spaces before it are counted.
    const tabbed = /^ *\t/.test(line);
    const isMarker = LIST_MARKER.test(line);

    // Could this line continue a block above it? After a blank line, only an indented line, or a
    // list item continuing a list, can.
    const free = pendingBlank && containers.length === 0 && indent === 0 && !tabbed && !(inList && isMarker) && !afterIndented;
    if (free) {
      inList = false;
      if (size >= minChars) {
        starts.push(n);
        size = 0;
      }
    }
    pendingBlank = false;

    // Definitions decide how `[text][label]` reads in every chunk, so the top-level ones are
    // handed to the chunks that use them. They must be exactly what the parser says they are. A
    // line that starts like one but isn't a plain one-line definition (a label across lines, one
    // inside a quote, list or indented block) can't be shared, and the document is parsed whole.
    // Wikilinks (`[[a]]: text`) can't be definitions, since a label can't contain `[`.
    const opening = line.trimStart();
    if (indent <= 3 && !tabbed && opening.startsWith('[') && !opening.startsWith('[[')) {
      if (opening.includes(']:')) {
        const def = DEFINITION.exec(line);
        const placed = def && (previousBlank || afterDefinition) && isDefinition(line.trim());
        if (!def || !placed) return bail('a line that looks like a definition but is not a plain one', n);
        const label = def[1] as string;
        const key = label.toLowerCase().replace(/\s+/g, ' ');
        if (!seen.has(key)) {
          seen.add(key);
          definitions.push({ label, line: line.trim(), at: n });
        }
        afterDefinition = true;
      } else {
        if (!opening.includes(']')) return bail('a label that may continue on the next line', n);
        afterDefinition = false;
      }
    } else {
      if (NESTED_DEFINITION.test(line) || INDENTED_DEFINITION.test(line)) return bail('a definition inside a quote, list or indented block', n);
      afterDefinition = false;
    }
    previousBlank = false;
    size += line.length + 1;

    afterIndented = indent >= 4 || tabbed;
    // Set before any `continue` below: a list item that opens with a code block is still a list.
    if (isMarker) inList = true;

    // State for the lines that follow. Code, HTML, math and containers are only followed at the
    // left margin: indented ones are usually inside a list item, which ends (taking the block with
    // it) at a line this scan would read as a new block, so such a document is parsed whole.
    const f = indent <= 3 ? FENCE_OPEN.exec(line) : null;
    const opensFence = f && ((f[1] as string)[0] === '~' || !(f[2] as string).includes('`'));
    // A fence after list markers (`- ```js`) or indented under an item: tracked as a nested fence.
    const inItem = indent === 0 ? NESTED_FENCE.exec(line) : indent <= 3 ? FENCE_OPEN.exec(line) : null;
    if (inItem && (indent > 0 || isMarker)) {
      const marks = (inItem[0].match(/(`{3,}|~{3,})/) as RegExpMatchArray)[1] as string;
      const info = line.slice(line.indexOf(marks) + marks.length);
      if (marks[0] === '~' || !info.includes('`')) {
        nested = { char: marks[0] as string, len: marks.length, col: line.indexOf(marks) };
        afterIndented = false;
        continue;
      }
    }
    const opensHtml = indent <= 3 ? htmlBlock(line) : null;
    const opensMath = indent <= 3 ? MATH_OPEN.exec(line) : null;
    if (indent > 0 && indent <= 3 && (opensFence || opensHtml || opensMath || DIRECTIVE_OPEN.test(line))) return bail('an indented fence, HTML, math or directive opener', n);
    if (opensFence && f) {
      fence = { char: (f[1] as string)[0] as string, len: (f[1] as string).length };
      afterIndented = false;
      continue;
    }
    if (opensHtml) {
      // It may close on its own line.
      if (!opensHtml.end.test(opensHtml.rest)) html = opensHtml.end;
      continue;
    }
    if (opensMath) {
      math = (opensMath[1] as string).length;
      continue;
    }
    const open = DIRECTIVE_OPEN.exec(line);
    if (open) containers.push((open[1] as string).length);
    else if (containers.length) {
      const close = DIRECTIVE_CLOSE.exec(line);
      if (close && (close[1] as string).length >= (containers[containers.length - 1] as number)) containers.pop();
    }
    if (isMarker) inList = true;
  }

  return { starts, definitions, frontMatter };
}
