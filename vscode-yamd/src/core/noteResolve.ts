/** Wikilink resolution and embed selection. Paths are POSIX strings. */
import { posix } from 'node:path';
import { plainText } from './inline';
import { walkBlocks } from './parser';
import { slugify } from './slug';
import type { Block, ListBlock, YamdDocument } from './types';
import type { NoteSummary } from './noteSummary';

export const NOTE_EXT = '.yamd';
/** Every extension a YAMD note may use, in the order tried when a link doesn't name one. */
export const NOTE_EXTS = ['.yamd', '.ymd'];
const NOTE_EXT_RE = /\.(?:yamd|ymd)$/i;
/** Whether `path` ends in a recognized note extension (`.yamd` or `.ymd`). */
export const isNotePath = (path: string) => NOTE_EXT_RE.test(path);
/** Strips a trailing `.yamd`/`.ymd` extension, if present. */
export const stripNoteExt = (path: string) => path.replace(NOTE_EXT_RE, '');

/** File access that resolution needs. The workspace index and test fixtures implement it. */
export interface NoteLookup {
  /** Whether a note or any other file exists at `path`. */
  has(path: string): boolean;
  /** Current text of a note, including unsaved edits. */
  read(path: string): string | undefined;
  /** The workspace folder containing `path` (`''` when paths are relative). */
  root(path: string): string;
  /** Notes whose file name (lower-cased, with extension) is `name`. */
  byName(name: string): string[];
  /** Notes with the alias `alias` (lower-cased). */
  byAlias(alias: string): string[];
  /** The already-built summary of a note, if the lookup keeps them (saves parsing it again). */
  summary?(path: string): NoteSummary | undefined;
}

export interface Resolved {
  path: string;
  /** Every note the name matched, when it matched more than one (Y709). */
  candidates: string[];
}

export const hasExtension = (p: string) => /\.[A-Za-z0-9]+$/.test(posix.basename(p));
const byLength = (a: string, b: string) => a.length - b.length || a.localeCompare(b);

/**
 * Resolves a wikilink or embed target: relative to the note, from the workspace root, by file
 * name anywhere (case-insensitive, shortest path wins), then by alias. An empty target is the note
 * itself.
 */
export function resolveNote(lookup: NoteLookup, target: string, fromPath: string): Resolved | null {
  const t = target.trim();
  if (t === '') return { path: fromPath, candidates: [] };
  const files = hasExtension(t) ? [t] : NOTE_EXTS.map((ext) => t + ext);

  for (const file of files) {
    const relative = posix.normalize(posix.join(posix.dirname(fromPath), file));
    if (lookup.has(relative)) return { path: relative, candidates: [] };
  }
  for (const file of files) {
    const fromRoot = posix.normalize(posix.join(lookup.root(fromPath), file.replace(/^\/+/, '')));
    if (lookup.has(fromRoot)) return { path: fromRoot, candidates: [] };
  }

  const namedAll: string[] = [];
  for (const file of files) {
    const lower = file.toLowerCase();
    const suffix = `/${lower.replace(/^\/+/, '')}`;
    namedAll.push(...lookup.byName(posix.basename(lower)).filter((p) => !lower.includes('/') || `/${p.toLowerCase()}`.endsWith(suffix)));
  }
  const named = [...new Set(namedAll)].sort(byLength);
  if (named.length) return { path: named[0] as string, candidates: named.length > 1 ? named : [] };

  const aliased = lookup.byAlias(t.toLowerCase()).sort(byLength);
  if (aliased.length) return { path: aliased[0] as string, candidates: aliased.length > 1 ? aliased : [] };
  return null;
}

/** Splits `note#Heading`, `note#^block` and `note|label` into parts. */
export function splitTarget(raw: string): { file: string; heading?: string; blockId?: string } {
  const target = (raw.split('|')[0] ?? '').trim();
  const hash = target.indexOf('#');
  const file = hash === -1 ? target : target.slice(0, hash);
  const anchor = hash === -1 ? '' : target.slice(hash + 1).trim();
  if (anchor.startsWith('^')) return { file, blockId: anchor.slice(1) };
  return anchor ? { file, heading: anchor } : { file };
}

const headingMatches = (b: Extract<Block, { type: 'heading' }>, heading: string) =>
  b.id === heading || b.id === slugify(heading) || plainText(b.children).trim().toLowerCase() === heading.trim().toLowerCase();

/** Finds a heading by ID, slug or text. */
export function findHeading(doc: YamdDocument, heading: string): Extract<Block, { type: 'heading' }> | undefined {
  let found: Extract<Block, { type: 'heading' }> | undefined;
  walkBlocks(doc.blocks, (b) => {
    if (!found && b.type === 'heading' && headingMatches(b, heading)) found = b;
  });
  return found;
}

/** Finds the paragraph or list item with a block ID, returning the block to show for it. */
export function findBlock(doc: YamdDocument, id: string): { block: Block; line: number } | undefined {
  let found: { block: Block; line: number } | undefined;
  const visit = (blocks: Block[]) => {
    for (const b of blocks) {
      if (found) return;
      if (b.type === 'paragraph' && b.blockId === id) found = { block: b, line: b.line };
      else if (b.type === 'list') {
        for (const item of b.items) {
          const first = item.children[0];
          if (first?.type === 'paragraph' && first.blockId === id) {
            const single: ListBlock = { ...b, items: [item], line: item.line, endLine: item.endLine };
            found = { block: single, line: item.line };
            return;
          }
          visit(item.children);
        }
      } else if (b.type === 'blockquote' || b.type === 'container') visit(b.children);
    }
  };
  visit(doc.blocks);
  return found;
}

/**
 * The blocks an embed shows: the whole note, the section under a heading (up to the next heading
 * of the same or higher level), or one block. Returns null if the heading or block is missing.
 */
export function selectEmbed(doc: YamdDocument, heading?: string, blockId?: string): Block[] | null {
  if (blockId !== undefined) {
    const found = findBlock(doc, blockId);
    return found ? [found.block] : null;
  }
  if (heading === undefined) return doc.blocks;
  const start = doc.blocks.findIndex((b) => b.type === 'heading' && headingMatches(b, heading));
  const h = doc.blocks[start];
  if (!h || h.type !== 'heading') return null;
  const end = doc.blocks.findIndex((b, i) => i > start && b.type === 'heading' && b.level <= h.level);
  return doc.blocks.slice(start, end === -1 ? undefined : end);
}

/** A relative link from one note to another, as a URL path. */
export function relativeHref(fromPath: string, toPath: string): string {
  const rel = posix.relative(posix.dirname(fromPath), toPath) || posix.basename(toPath);
  return rel.split('/').map(encodeURIComponent).join('/');
}
