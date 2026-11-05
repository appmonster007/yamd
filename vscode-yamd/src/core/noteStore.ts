/** The in-memory note store (links, backlinks, graph, mentions) and rename edits. */
import { posix } from 'node:path';
import type { Range } from './types';
import { NOTE_EXTS, isNotePath, stripNoteExt, NoteLookup, Resolved, resolveNote, relativeHref, hasExtension } from './noteResolve';
import { NoteLink, NoteSummary, summarize } from './noteSummary';

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
  /** The note's text, kept only for small notes; larger ones are read when needed (see `reader`). */
  text?: string;
  size: number;
  hash: string;
  summary: NoteSummary;
}

/** Characters of unkept notes read from disk in one search for unlinked mentions. */
const MENTION_READ_BUDGET = 20_000_000;

/** Notes up to this many characters keep their text in the store; larger ones don't, to bound memory. */
export const KEEP_TEXT_BELOW = 64 * 1024;

export interface StoreOptions {
  /** Reads a note's current text (an open editor's, or the file's). Used for notes whose text isn't kept. */
  reader?: (path: string) => string | undefined;
  keepTextBelow?: number;
}

/** A cheap fingerprint of a text, to notice an unchanged note whose text isn't kept. */
export function fingerprint(text: string): string {
  let h = 0x811c9dc5;
  for (let i = 0; i < text.length; i++) {
    h ^= text.charCodeAt(i);
    h = Math.imul(h, 0x01000193);
  }
  return (h >>> 0).toString(36);
}

/** Notes in memory, with the lookups resolution needs and cross-note queries. */
export class NoteStore implements NoteLookup {
  private readonly notes = new Map<string, Entry>();
  private readonly names = new Map<string, Set<string>>();
  private readonly aliasMap = new Map<string, Set<string>>();
  private version = 0;
  /** Changes when a note or alias is added or removed, which is what link resolution depends on. */
  private nameVersion = 0;
  private graphVersion = 0;
  private graphCache: { key: string; graph: { nodes: GraphNode[]; edges: GraphEdge[] } } | undefined;
  private resolvedCache:
    | {
        version: number;
        links: Map<string, (Resolved | null)[]>;
        entries: Map<string, { summary: NoteSummary; names: number; resolved: (Resolved | null)[] }>;
      }
    | undefined;
  private tagCache: Map<string, Set<string>> | undefined;

  /**
   * @param roots workspace folders, longest match wins in `root()`
   * @param fileExists checks files that aren't notes, such as images
   */
  constructor(
    private readonly roots: string[] = [''],
    private readonly fileExists: (path: string) => boolean = () => false,
    private readonly options: StoreOptions = {},
  ) {}

  get size(): number {
    return this.notes.size;
  }

  /** Changes whenever any note is added, changed or removed. */
  get revision(): number {
    return this.version;
  }

  /** Changes only when something the graph shows does: notes, titles, tags or links. */
  get graphRevision(): number {
    return this.graphVersion;
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
    if (existing && this.sameText(existing, text)) return existing.summary;
    return this.put(path, text, summarize(path, text));
  }

  private sameText(entry: Entry, text: string): boolean {
    if (entry.size !== text.length) return false;
    return entry.text !== undefined ? entry.text === text : entry.hash === fingerprint(text);
  }

  /**
   * Adds a note whose summary was already built, for example by a worker thread. The text may be
   * given only as its size and fingerprint (a large note's text isn't sent between threads).
   */
  setSummarized(path: string, text: string | { size: number; hash: string }, summary: NoteSummary): void {
    const existing = this.notes.get(path);
    const size = typeof text === 'string' ? text.length : text.size;
    const keep = typeof text === 'string' && size <= (this.options.keepTextBelow ?? KEEP_TEXT_BELOW);
    const hash = typeof text === 'string' ? (keep ? '' : fingerprint(text)) : text.hash;
    if (existing && existing.size === size && (existing.text !== undefined ? existing.text === text : existing.hash === hash)) return;
    this.store(path, keep ? (text as string) : undefined, size, hash, summary);
  }

  private put(path: string, text: string, summary: NoteSummary): NoteSummary {
    const keep = text.length <= (this.options.keepTextBelow ?? KEEP_TEXT_BELOW);
    return this.store(path, keep ? text : undefined, text.length, keep ? '' : fingerprint(text), summary);
  }

  private store(path: string, text: string | undefined, size: number, hash: string, summary: NoteSummary): NoteSummary {
    const existing = this.notes.get(path);
    this.unlink(path);
    this.notes.set(path, { text, size, hash, summary });
    this.addTo(this.names, posix.basename(path).toLowerCase(), path);
    for (const a of summary.aliases) this.addTo(this.aliasMap, a.toLowerCase(), path);
    this.version++;
    // Links resolve by name and alias, so they only need redoing when those change.
    if (!existing || !sameList(existing.summary.aliases, summary.aliases)) this.nameVersion++;
    if (!existing || !sameList(existing.summary.tags, summary.tags)) this.tagCache = undefined;
    if (!existing || graphKey(existing.summary) !== graphKey(summary)) this.graphVersion++;
    return summary;
  }

  delete(path: string): void {
    if (!this.notes.has(path)) return;
    this.unlink(path);
    this.notes.delete(path);
    this.version++;
    this.nameVersion++;
    this.tagCache = undefined;
    this.graphVersion++;
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
    const entry = this.notes.get(path);
    if (!entry) return undefined;
    return entry.text ?? this.options.reader?.(path);
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

  /**
   * Resolution of every link of every note. Each note's result is kept until that note's summary
   * changes or the set of names and aliases does, so typing in one note re-resolves only its links.
   */
  private resolvedLinks(): Map<string, (Resolved | null)[]> {
    if (this.resolvedCache?.version === this.version) return this.resolvedCache.links;
    const old = this.resolvedCache?.entries ?? new Map();
    const entries = new Map<string, { summary: NoteSummary; names: number; resolved: (Resolved | null)[] }>();
    const links = new Map<string, (Resolved | null)[]>();
    for (const [path, { summary }] of this.notes) {
      const kept = old.get(path);
      const entry =
        kept && kept.summary === summary && kept.names === this.nameVersion
          ? kept
          : { summary, names: this.nameVersion, resolved: summary.links.map((l) => this.resolveLink(l, path)) };
      entries.set(path, entry);
      links.set(path, entry.resolved);
    }
    this.resolvedCache = { version: this.version, links, entries };
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
        if (r?.path === path && link) out.push({ from, link, text: link.snippet });
      });
    }
    return out.sort((a, b) => a.from.localeCompare(b.from) || a.link.line - b.link.line);
  }

  /** Each tag with the notes that use it. */
  tags(): Map<string, Set<string>> {
    if (this.tagCache) return this.tagCache;
    const out = new Map<string, Set<string>>();
    for (const [path, { summary }] of this.notes) for (const t of summary.tags) this.addTo(out, t, path);
    this.tagCache = out;
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
    // The graph only changes with titles, tags, link targets and the set of names, not with every edit.
    const key = `${this.graphVersion}:${this.nameVersion}`;
    if (this.graphCache?.key === key) return this.graphCache.graph;
    const graph = this.buildGraph();
    this.graphCache = { key, graph };
    return graph;
  }

  private buildGraph(): { nodes: GraphNode[]; edges: GraphEdge[] } {
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
    const lowered = names.map((n) => n.toLowerCase());
    // Notes whose text isn't kept are read from disk, so only so much of that is done per search.
    let readBudget = MENTION_READ_BUDGET;
    for (const [from, entry] of this.notes) {
      if (from === path) continue;
      if (out.length >= limit) break;
      let text = entry.text;
      if (text === undefined) {
        if (readBudget < entry.size) continue;
        readBudget -= entry.size;
        text = this.options.reader?.(from);
        if (text === undefined) continue;
      }
      // Most notes don't contain the name at all, which a substring search rules out cheaply.
      const lower = text.toLowerCase();
      if (!lowered.some((n) => lower.includes(n))) continue;
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

/** What a note contributes to the graph: its title, tags and the targets of its links. */
function graphKey(s: NoteSummary): string {
  return `${s.title}\u0000${s.tags.join(',')}\u0000${s.links.map((l) => `${l.kind}:${l.file}`).join(',')}`;
}

function sameList(a: string[], b: string[]): boolean {
  return a.length === b.length && a.every((x, i) => x === b[i]);
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
  const isNote = isNotePath(oldPath);
  // Resolution after the move, used to check name-based links.
  const after = new NoteStore([store.root(newPath)], (p) => p === newPath || (p !== oldPath && store.has(p)));
  if (isNote) {
    // Resolution only needs each note's name, aliases and links, so the summaries are reused as they are.
    for (const p of store.paths()) {
      const summary = store.summary(p);
      if (summary) after.setSummarized(p === oldPath ? newPath : p, '', { ...summary, path: p === oldPath ? newPath : p });
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
        const withExts = hasExtension(written) ? [written] : NOTE_EXTS.map((ext) => written + ext);
        if (withExts.some((w) => `/${newPath.toLowerCase()}`.endsWith(`/${w}`))) continue;
      }
      add(from, { range: link.fileRange, text: shortestName(after, newPath, fromAfter) });
    }
  }
  return edits;
}

/** The shortest wikilink target that resolves to `path` from `from`. */
function shortestName(store: NoteStore, path: string, from: string): string {
  const bare = stripNoteExt(path);
  const segments = bare.split('/');
  for (let i = segments.length - 1; i >= 0; i--) {
    const candidate = segments.slice(i).join('/');
    const r = store.resolve(candidate, from);
    if (r?.path === path && r.candidates.length === 0) return candidate;
  }
  return posix.relative(store.root(path), bare);
}
