/**
 * Cross-note logic with no VS Code dependency: wikilink resolution, embed selection, note
 * summaries, and an in-memory note store that the workspace index wraps.
 * Paths are POSIX strings (absolute in the extension, relative in tests).
 */
import { posix } from 'node:path';
import { plainText } from './inline';
import { parse, walkBlocks } from './parser';
import { slugify } from './slug';
import type { Block, InlineNode, ListBlock, Range, YamdDocument } from './types';

export const NOTE_EXT = '.yamd';

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
}

export interface Resolved {
  path: string;
  /** Every note the name matched, when it matched more than one (Y709). */
  candidates: string[];
}

const hasExtension = (p: string) => /\.[A-Za-z0-9]+$/.test(posix.basename(p));
const byLength = (a: string, b: string) => a.length - b.length || a.localeCompare(b);

/**
 * Resolves a wikilink or embed target: relative to the note, from the workspace root, by file
 * name anywhere (case-insensitive, shortest path wins), then by alias. An empty target is the note
 * itself.
 */
export function resolveNote(lookup: NoteLookup, target: string, fromPath: string): Resolved | null {
  const t = target.trim();
  if (t === '') return { path: fromPath, candidates: [] };
  const file = hasExtension(t) ? t : t + NOTE_EXT;
  const relative = posix.normalize(posix.join(posix.dirname(fromPath), file));
  if (lookup.has(relative)) return { path: relative, candidates: [] };
  const fromRoot = posix.normalize(posix.join(lookup.root(fromPath), file.replace(/^\/+/, '')));
  if (lookup.has(fromRoot)) return { path: fromRoot, candidates: [] };

  const lower = file.toLowerCase();
  const suffix = `/${lower.replace(/^\/+/, '')}`;
  const named = lookup
    .byName(posix.basename(lower))
    .filter((p) => !lower.includes('/') || `/${p.toLowerCase()}`.endsWith(suffix))
    .sort(byLength);
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

// ---- Summaries ----

export interface NoteLink {
  kind: 'wiki' | 'embed' | 'markdown';
  /** The target as written, without `|label`. */
  target: string;
  file: string;
  heading?: string;
  blockId?: string;
  /** The whole link in the source. */
  range: Range;
  /** The file part of the target in the source, for rename edits. */
  fileRange: Range;
  line: number;
}

export interface NoteHeading {
  text: string;
  id: string;
  level: number;
  line: number;
}

export interface NoteSummary {
  path: string;
  title: string;
  aliases: string[];
  tags: string[];
  headings: NoteHeading[];
  blocks: { id: string; line: number }[];
  links: NoteLink[];
  tasks: { line: number; done: boolean; text: string }[];
  properties: Record<string, unknown>;
}

const SCHEME = /^[a-z][a-z0-9+.-]*:/i;

function lineOf(doc: YamdDocument, offset: number): number {
  let lo = 0;
  let hi = doc.lineStarts.length - 1;
  while (lo < hi) {
    const mid = (lo + hi + 1) >> 1;
    if ((doc.lineStarts[mid] ?? 0) <= offset) lo = mid;
    else hi = mid - 1;
  }
  return lo;
}

function stringList(value: unknown): string[] {
  if (typeof value === 'string') return value.split(',').map((s) => s.trim()).filter(Boolean);
  if (Array.isArray(value)) return value.filter((v) => typeof v === 'string' || typeof v === 'number').map(String);
  return [];
}

/** Inline content owned directly by a block. */
function blockInlines(b: Block): InlineNode[][] {
  switch (b.type) {
    case 'paragraph':
    case 'heading':
      return [b.children];
    case 'table':
      return [...b.header, ...b.rows.flat()].map((c) => c.children);
    case 'leaf':
      return [b.label];
    default:
      return [];
  }
}

function walkInline(nodes: InlineNode[], visit: (n: InlineNode) => void) {
  for (const n of nodes) {
    visit(n);
    if ('children' in n && Array.isArray(n.children)) walkInline(n.children, visit);
    if (n.type === 'reviewSubstitute') {
      walkInline(n.from, visit);
      walkInline(n.to, visit);
    }
  }
}

/** Every inline node in a document, including footnotes. */
export function eachInline(doc: YamdDocument, visit: (n: InlineNode) => void): void {
  const roots = [...doc.blocks, ...[...doc.footnotes.values()].flatMap((f) => f.children)];
  walkBlocks(roots, (b) => blockInlines(b).forEach((nodes) => walkInline(nodes, visit)));
}

/** Links and embeds in a document, with the source range of each target's file part. */
export function noteLinks(doc: YamdDocument): NoteLink[] {
  const links: NoteLink[] = [];
  const src = doc.source;
  eachInline(doc, (n) => {
    if (n.type === 'link' && n.kind === 'wiki') {
      const inner = src.slice(n.range.start + 2, n.range.end - 2);
      const target = (inner.split('|')[0] ?? '').trim();
      const lead = inner.length - inner.trimStart().length;
      const parts = splitTarget(target);
      const start = n.range.start + 2 + lead;
      links.push({ kind: 'wiki', target, ...parts, range: n.range, fileRange: { start, end: start + parts.file.length }, line: lineOf(doc, n.range.start) });
    } else if (n.type === 'embed') {
      const inner = src.slice(n.range.start + 3, n.range.end - 2);
      const lead = inner.length - inner.trimStart().length;
      const start = n.range.start + 3 + lead;
      links.push({
        kind: 'embed',
        target: n.target,
        file: n.file,
        heading: n.heading,
        blockId: n.blockId,
        range: n.range,
        fileRange: { start, end: start + n.file.length },
        line: lineOf(doc, n.range.start),
      });
    } else if ((n.type === 'link' && n.kind === 'inline') || (n.type === 'image' && n.label === undefined)) {
      const href = n.type === 'link' ? n.href : n.src;
      if (!href || SCHEME.test(href) || href.startsWith('#') || href.startsWith('//')) return;
      const raw = src.slice(n.range.start, n.range.end);
      const open = raw.lastIndexOf('](');
      if (open === -1) return;
      const destStart = n.range.start + open + 2 + (/^\s*<?/.exec(raw.slice(open + 2))?.[0].length ?? 0);
      const written = /^[^\s#)>]*/.exec(src.slice(destStart))?.[0] ?? '';
      let file = written;
      try {
        file = decodeURIComponent(written);
      } catch {
        // Keep it as written.
      }
      const anchor = href.includes('#') ? href.slice(href.indexOf('#') + 1) : undefined;
      links.push({
        kind: 'markdown',
        target: href,
        file,
        heading: anchor && !anchor.startsWith('^') ? anchor : undefined,
        blockId: anchor?.startsWith('^') ? anchor.slice(1) : undefined,
        range: n.range,
        fileRange: { start: destStart, end: destStart + written.length },
        line: lineOf(doc, n.range.start),
      });
    }
  });
  return links;
}

/** Builds the index summary of one note. */
export function summarize(path: string, text: string, parsed?: YamdDocument): NoteSummary {
  const doc = parsed ?? parse(text);
  const fm = doc.frontMatter?.data ?? {};
  const headings: NoteHeading[] = [];
  const blocks: { id: string; line: number }[] = [];
  const tasks: NoteSummary['tasks'] = [];
  walkBlocks(doc.blocks, (b) => {
    if (b.type === 'heading' && !b.inBoard) headings.push({ text: plainText(b.children).trim(), id: b.id, level: b.level, line: b.line });
    if (b.type === 'paragraph' && b.blockId) blocks.push({ id: b.blockId, line: b.line });
    if (b.type === 'list') {
      for (const item of b.items) {
        const first = item.children[0];
        if (item.task) tasks.push({ line: item.line, done: item.task === 'done', text: first?.type === 'paragraph' ? plainText(first.children).trim() : '' });
      }
    }
  });
  const tags = new Set(stringList(fm['tags']).map((t) => t.replace(/^#/, '')));
  eachInline(doc, (n) => {
    if (n.type === 'tag') tags.add(n.name);
  });
  const fmTitle = typeof fm['title'] === 'string' ? fm['title'] : undefined;
  const firstHeading = headings[0]?.text;
  const title = fmTitle ?? (firstHeading && !firstHeading.includes('{{') ? firstHeading : undefined) ?? posix.basename(path).replace(/\.yamd$/i, '');
  return {
    path,
    title,
    aliases: stringList(fm['aliases'] ?? fm['alias']),
    tags: [...tags],
    headings,
    blocks,
    links: noteLinks(doc),
    tasks,
    properties: fm,
  };
}

// ---- Store ----

export interface Backlink {
  from: string;
  link: NoteLink;
  /** The source line containing the link. */
  text: string;
}

export interface GraphNode {
  id: string;
  label: string;
  missing: boolean;
  tags: string[];
}

export interface GraphEdge {
  source: string;
  target: string;
}

export interface Mention {
  from: string;
  line: number;
  /** Character offsets in the note's text. */
  start: number;
  end: number;
  text: string;
}

interface Entry {
  text: string;
  summary: NoteSummary;
}

/** Notes in memory, with the lookups resolution needs and cross-note queries. */
export class NoteStore implements NoteLookup {
  private readonly notes = new Map<string, Entry>();
  private readonly names = new Map<string, Set<string>>();
  private readonly aliasMap = new Map<string, Set<string>>();
  private version = 0;
  private resolvedCache: { version: number; links: Map<string, (Resolved | null)[]> } | undefined;

  /**
   * @param roots workspace folders, longest match wins in `root()`
   * @param fileExists checks files that aren't notes, such as images
   */
  constructor(
    private readonly roots: string[] = [''],
    private readonly fileExists: (path: string) => boolean = () => false,
  ) {}

  get size(): number {
    return this.notes.size;
  }

  paths(): string[] {
    return [...this.notes.keys()];
  }

  summary(path: string): NoteSummary | undefined {
    return this.notes.get(path)?.summary;
  }

  summaries(): NoteSummary[] {
    return [...this.notes.values()].map((e) => e.summary);
  }

  set(path: string, text: string): NoteSummary {
    const existing = this.notes.get(path);
    if (existing?.text === text) return existing.summary;
    this.unlink(path);
    const summary = summarize(path, text);
    this.notes.set(path, { text, summary });
    this.addTo(this.names, posix.basename(path).toLowerCase(), path);
    for (const a of summary.aliases) this.addTo(this.aliasMap, a.toLowerCase(), path);
    this.version++;
    return summary;
  }

  delete(path: string): void {
    if (!this.notes.has(path)) return;
    this.unlink(path);
    this.notes.delete(path);
    this.version++;
  }

  private unlink(path: string) {
    const old = this.notes.get(path);
    if (!old) return;
    this.names.get(posix.basename(path).toLowerCase())?.delete(path);
    for (const a of old.summary.aliases) this.aliasMap.get(a.toLowerCase())?.delete(path);
  }

  private addTo(map: Map<string, Set<string>>, key: string, path: string) {
    let set = map.get(key);
    if (!set) map.set(key, (set = new Set()));
    set.add(path);
  }

  has(path: string): boolean {
    return this.notes.has(path) || this.fileExists(path);
  }

  read(path: string): string | undefined {
    return this.notes.get(path)?.text;
  }

  root(path: string): string {
    let best = '';
    for (const r of this.roots) if ((r === '' || path === r || path.startsWith(`${r}/`)) && r.length >= best.length) best = r;
    return best;
  }

  byName(name: string): string[] {
    return [...(this.names.get(name) ?? [])];
  }

  byAlias(alias: string): string[] {
    return [...(this.aliasMap.get(alias) ?? [])];
  }

  resolve(target: string, from: string): Resolved | null {
    return resolveNote(this, target, from);
  }

  /** Resolution of every link of every note, cached until the store changes. */
  private resolvedLinks(): Map<string, (Resolved | null)[]> {
    if (this.resolvedCache?.version === this.version) return this.resolvedCache.links;
    const links = new Map<string, (Resolved | null)[]>();
    for (const [path, { summary }] of this.notes) links.set(path, summary.links.map((l) => this.resolveLink(l, path)));
    this.resolvedCache = { version: this.version, links };
    return links;
  }

  /** Resolves a link: wikilinks and embeds by name, Markdown links by relative path. */
  resolveLink(link: NoteLink, from: string): Resolved | null {
    if (link.kind !== 'markdown') return resolveNote(this, link.file, from);
    if (link.file === '') return { path: from, candidates: [] };
    const path = link.file.startsWith('/')
      ? posix.normalize(posix.join(this.root(from), link.file))
      : posix.normalize(posix.join(posix.dirname(from), link.file));
    return this.has(path) ? { path, candidates: [] } : null;
  }

  backlinks(path: string): Backlink[] {
    const out: Backlink[] = [];
    for (const [from, resolved] of this.resolvedLinks()) {
      if (from === path) continue;
      const entry = this.notes.get(from);
      if (!entry) continue;
      resolved.forEach((r, i) => {
        const link = entry.summary.links[i];
        if (r?.path === path && link) out.push({ from, link, text: lineText(entry.text, link.line) });
      });
    }
    return out.sort((a, b) => a.from.localeCompare(b.from) || a.link.line - b.link.line);
  }

  /** Each tag with the notes that use it. */
  tags(): Map<string, Set<string>> {
    const out = new Map<string, Set<string>>();
    for (const [path, { summary }] of this.notes) for (const t of summary.tags) this.addTo(out, t, path);
    return out;
  }

  /** Notes that have `tag` or a tag nested under it. */
  notesWithTag(tag: string): string[] {
    const out = new Set<string>();
    for (const [t, paths] of this.tags()) if (t === tag || t.startsWith(`${tag}/`)) paths.forEach((p) => out.add(p));
    return [...out].sort();
  }

  /** The link graph. Unresolved wikilinks and embeds become missing nodes named by their target. */
  graph(): { nodes: GraphNode[]; edges: GraphEdge[] } {
    const nodes = new Map<string, GraphNode>();
    const edges: GraphEdge[] = [];
    const seen = new Set<string>();
    for (const [path, { summary }] of this.notes) {
      nodes.set(path, { id: path, label: summary.title, missing: false, tags: summary.tags });
    }
    for (const [from, resolved] of this.resolvedLinks()) {
      const summary = this.notes.get(from)?.summary;
      resolved.forEach((r, i) => {
        const link = summary?.links[i];
        if (!link) return;
        let target: string;
        if (r) {
          if (!this.notes.has(r.path) || r.path === from) return;
          target = r.path;
        } else {
          if (link.kind === 'markdown' || hasExtension(link.file) || link.file === '') return;
          target = `missing:${link.file.toLowerCase()}`;
          if (!nodes.has(target)) nodes.set(target, { id: target, label: link.file, missing: true, tags: [] });
        }
        const key = `${from}\n${target}`;
        if (seen.has(key)) return;
        seen.add(key);
        edges.push({ source: from, target });
      });
    }
    return { nodes: [...nodes.values()], edges };
  }

  /** The notes within `depth` link steps of `path`, in either direction. */
  localGraph(path: string, depth: number): { nodes: GraphNode[]; edges: GraphEdge[] } {
    const { nodes, edges } = this.graph();
    const neighbors = new Map<string, Set<string>>();
    for (const e of edges) {
      this.addTo(neighbors, e.source, e.target);
      this.addTo(neighbors, e.target, e.source);
    }
    const keep = new Set([path]);
    let frontier = [path];
    for (let d = 0; d < depth; d++) {
      const next: string[] = [];
      for (const p of frontier) {
        for (const n of neighbors.get(p) ?? []) {
          if (!keep.has(n)) {
            keep.add(n);
            next.push(n);
          }
        }
      }
      frontier = next;
    }
    return { nodes: nodes.filter((n) => keep.has(n.id)), edges: edges.filter((e) => keep.has(e.source) && keep.has(e.target)) };
  }

  /** Plain-text mentions of a note's title or aliases in other notes, outside code, links and front matter. */
  unlinkedMentions(path: string, limit = 200): Mention[] {
    const summary = this.summary(path);
    if (!summary) return [];
    const names = [summary.title, ...summary.aliases].filter((n) => n.trim().length > 1);
    if (!names.length) return [];
    const pattern = new RegExp(
      `(?<![\\p{L}\\p{N}_])(?:${names.map((n) => n.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')).join('|')})(?![\\p{L}\\p{N}_])`,
      'giu',
    );
    const out: Mention[] = [];
    for (const [from, { text }] of this.notes) {
      if (from === path) continue;
      const lines = text.split('\n');
      let offset = 0;
      let fence: string | null = null;
      let inFrontMatter = lines[0]?.trim() === '---';
      lines.forEach((line, no) => {
        const start = offset;
        offset += line.length + 1;
        if (out.length >= limit) return;
        if (inFrontMatter) {
          if (no > 0 && line.trim() === '---') inFrontMatter = false;
          return;
        }
        const f = /^\s*(`{3,}|~{3,})/.exec(line);
        if (f) {
          fence = fence === null ? (f[1] ?? null) : line.trim().startsWith(fence) ? null : fence;
          return;
        }
        if (fence !== null) return;
        // Blank out code spans and links so mentions inside them don't count.
        const masked = line.replace(/`[^`]*`|!?\[\[[^\]]*\]\]|\[[^\]]*\]\([^)]*\)|https?:\/\/\S+/g, (m) => ' '.repeat(m.length));
        for (const m of masked.matchAll(pattern)) {
          if (out.length >= limit) break;
          out.push({ from, line: no, start: start + m.index, end: start + m.index + m[0].length, text: line.trim() });
        }
      });
    }
    return out;
  }
}

function lineText(text: string, line: number): string {
  return (text.split('\n')[line] ?? '').trim();
}

// ---- Rename ----

export interface TextEdit {
  range: Range;
  text: string;
}

/**
 * Link edits needed when the note or file at `oldPath` moves to `newPath`. Path-based links are
 * rewritten; links by name or alias are left alone unless they would stop resolving to the file.
 */
export function renameEdits(store: NoteStore, oldPath: string, newPath: string): Map<string, TextEdit[]> {
  const edits = new Map<string, TextEdit[]>();
  const add = (path: string, edit: TextEdit) => {
    const list = edits.get(path) ?? [];
    list.push(edit);
    edits.set(path, list);
  };
  const isNote = /\.yamd$/i.test(oldPath);
  // Resolution after the move, used to check name-based links.
  const after = new NoteStore([store.root(newPath)], (p) => p === newPath || (p !== oldPath && store.has(p)));
  if (isNote) {
    for (const p of store.paths()) {
      const text = store.read(p);
      if (text !== undefined) after.set(p === oldPath ? newPath : p, text);
    }
  }
  for (const from of store.paths()) {
    const summary = store.summary(from);
    if (!summary) continue;
    const fromAfter = from === oldPath ? newPath : from;
    for (const link of summary.links) {
      if (store.resolveLink(link, from)?.path !== oldPath) continue;
      if (link.kind === 'markdown') {
        const href = relativeHref(fromAfter, newPath);
        add(from, { range: link.fileRange, text: href });
        continue;
      }
      if (link.file === '') continue;
      const pathBased = link.file.includes('/');
      const stillResolves = after.resolveLink(link, fromAfter)?.path === newPath;
      if (!pathBased && stillResolves) continue;
      if (pathBased && stillResolves && !link.file.startsWith('.')) {
        // A root-relative path that still matches by suffix keeps working only if it names the new path.
        const written = link.file.toLowerCase().replace(/^\/+/, '');
        const withExt = hasExtension(written) ? written : written + NOTE_EXT;
        if (`/${newPath.toLowerCase()}`.endsWith(`/${withExt}`)) continue;
      }
      add(from, { range: link.fileRange, text: shortestName(after, newPath, fromAfter) });
    }
  }
  return edits;
}

/** The shortest wikilink target that resolves to `path` from `from`. */
function shortestName(store: NoteStore, path: string, from: string): string {
  const bare = path.replace(/\.yamd$/i, '');
  const segments = bare.split('/');
  for (let i = segments.length - 1; i >= 0; i--) {
    const candidate = segments.slice(i).join('/');
    const r = store.resolve(candidate, from);
    if (r?.path === path && r.candidates.length === 0) return candidate;
  }
  return posix.relative(store.root(path), bare);
}
