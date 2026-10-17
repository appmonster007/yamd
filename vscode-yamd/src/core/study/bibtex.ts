/**
 * Citations (§4.7): a small BibTeX reader, APA / MLA / IEEE formatting, and conversion of lookup
 * results (Crossref, Open Library, web pages) into BibTeX entries.
 */
import { escapeHtml } from '../render';

export interface BibEntry {
  key: string;
  type: string;
  fields: Record<string, string>;
}

export type CitationStyle = 'apa' | 'mla' | 'ieee';
export const CITATION_STYLES: CitationStyle[] = ['apa', 'mla', 'ieee'];

export function citationStyle(value: unknown): CitationStyle {
  return typeof value === 'string' && (CITATION_STYLES as string[]).includes(value.toLowerCase()) ? (value.toLowerCase() as CitationStyle) : 'apa';
}

// ---- Reading ----

/** Reads a brace- or quote-delimited value starting at `i`; returns the value and the index after it. */
function readValue(src: string, i: number): [string, number] {
  const c = src[i];
  if (c === '{') {
    let depth = 0;
    let j = i;
    for (; j < src.length; j++) {
      if (src[j] === '\\') j++;
      else if (src[j] === '{') depth++;
      else if (src[j] === '}' && --depth === 0) break;
    }
    return [src.slice(i + 1, j), j + 1];
  }
  if (c === '"') {
    let j = i + 1;
    for (; j < src.length && src[j] !== '"'; j++) if (src[j] === '\\') j++;
    return [src.slice(i + 1, j), j + 1];
  }
  const m = /^[^,}\s]+/.exec(src.slice(i));
  return [m?.[0] ?? '', i + (m?.[0].length ?? 0)];
}

const ACCENTS: Record<string, string> = { '"a': 'ä', '"o': 'ö', '"u': 'ü', "'e": 'é', "'a": 'á', '`e': 'è', '^o': 'ô', "'o": 'ó', "'i": 'í', '~n': 'ñ' };

/** Removes TeX braces and decodes a few common escapes. */
export function cleanTex(s: string): string {
  return s
    .replace(/\\(["'`^~])\{?([a-zA-Z])\}?/g, (m, a: string, b: string) => ACCENTS[a + b] ?? b)
    .replace(/\\&/g, '&')
    .replace(/\\%/g, '%')
    .replace(/--+/g, (d) => (d.length === 2 ? '–' : '—'))
    .replace(/[{}]/g, '')
    .replace(/\s+/g, ' ')
    .trim();
}

export function parseBibtex(src: string): BibEntry[] {
  const entries: BibEntry[] = [];
  const re = /@([A-Za-z]+)\s*[{(]/g;
  for (let m = re.exec(src); m; m = re.exec(src)) {
    const type = (m[1] ?? '').toLowerCase();
    if (type === 'comment' || type === 'preamble' || type === 'string') continue;
    let i = re.lastIndex;
    const comma = src.indexOf(',', i);
    if (comma === -1) break;
    const key = src.slice(i, comma).trim();
    i = comma + 1;
    const fields: Record<string, string> = {};
    for (;;) {
      const f = /^\s*([A-Za-z][\w-]*)\s*=\s*/.exec(src.slice(i));
      if (!f) break;
      i += f[0].length;
      let [value, next] = readValue(src, i);
      i = next;
      // `"a" # "b"` concatenation is rare in course bibliographies; the first part is kept.
      fields[(f[1] ?? '').toLowerCase()] = cleanTex(value);
      const sep = /^\s*,?/.exec(src.slice(i));
      i += sep?.[0].length ?? 0;
    }
    if (key) entries.push({ key, type, fields });
    re.lastIndex = Math.max(re.lastIndex, i);
  }
  return entries;
}

export function toBibtex(e: BibEntry): string {
  const lines = Object.entries(e.fields).map(([k, v]) => `  ${k.padEnd(9)} = {${v.replace(/([&%#_])/g, '\\$1')}}`);
  return `@${e.type}{${e.key},\n${lines.join(',\n')}\n}\n`;
}

// ---- Names ----

interface Person {
  family: string;
  given: string;
}

function people(field: string | undefined): Person[] {
  if (!field) return [];
  return field.split(/\s+and\s+/).map((p) => {
    const t = p.trim();
    const comma = t.indexOf(',');
    if (comma !== -1) return { family: t.slice(0, comma).trim(), given: t.slice(comma + 1).trim() };
    const parts = t.split(/\s+/);
    return { family: parts.pop() ?? '', given: parts.join(' ') };
  });
}

const initials = (given: string, dots = true) =>
  given
    .split(/[\s-]+/)
    .filter(Boolean)
    .map((g) => `${g[0]?.toUpperCase()}${dots ? '.' : ''}`)
    .join(' ');

function year(e: BibEntry): string {
  return /\d{4}/.exec(e.fields['year'] ?? e.fields['date'] ?? '')?.[0] ?? 'n.d.';
}

const creators = (e: BibEntry) => people(e.fields['author'] ?? e.fields['editor']);

/** Family names for in-text use. */
function shortNames(e: BibEntry, style: CitationStyle): string {
  const a = creators(e).map((p) => p.family);
  if (a.length === 0) return e.fields['title'] ?? e.key;
  if (a.length === 1) return a[0] as string;
  if (a.length === 2) return style === 'apa' ? `${a[0]} & ${a[1]}` : `${a[0]} and ${a[1]}`;
  return `${a[0]} et al.`;
}

// ---- In-text citations ----

export interface CitedKey {
  key: string;
  /** `p. 4` and the like. */
  locator?: string;
}

/** Splits the inside of `[@a; @b, p. 4]`. */
export function parseCitation(raw: string): CitedKey[] {
  return raw
    .split(';')
    .map((part) => /@([^\s;,\]]+)\s*(?:,\s*(.+))?/.exec(part))
    .filter((m): m is RegExpExecArray => !!m)
    .map((m) => ({ key: m[1] as string, ...(m[2]?.trim() ? { locator: m[2].trim() } : {}) }));
}

export class Bibliography {
  private readonly byKey: Map<string, BibEntry>;
  /** Keys in the order they were first cited, used for IEEE numbers and the reference list. */
  readonly order: string[] = [];

  constructor(
    entries: BibEntry[],
    readonly style: CitationStyle = 'apa',
  ) {
    this.byKey = new Map(entries.map((e) => [e.key, e]));
  }

  has(key: string): boolean {
    return this.byKey.has(key);
  }

  /** The text of an in-text citation, e.g. `(Dean & Ghemawat, 2008, p. 4)` or `[2]`. Records the keys as cited. */
  cite(cited: CitedKey[]): string {
    for (const c of cited) if (this.byKey.has(c.key) && !this.order.includes(c.key)) this.order.push(c.key);
    if (this.style === 'ieee') {
      const parts = cited.map((c) => {
        const n = this.order.indexOf(c.key) + 1;
        return n ? `[${n}${c.locator ? `, ${c.locator}` : ''}]` : `[${c.key}]`;
      });
      return parts.join('');
    }
    const parts = cited.map((c) => {
      const e = this.byKey.get(c.key);
      if (!e) return c.key;
      if (this.style === 'apa') return `${shortNames(e, 'apa')}, ${year(e)}${c.locator ? `, ${c.locator}` : ''}`;
      return `${shortNames(e, 'mla')}${c.locator ? ` ${c.locator.replace(/^pp?\.\s*/, '')}` : ''}`;
    });
    return `(${parts.join('; ')})`;
  }

  /** The reference list as HTML list items, in the style's order. */
  references(): string {
    const used = this.order.map((k) => this.byKey.get(k)).filter((e): e is BibEntry => !!e);
    const sorted = this.style === 'ieee' ? used : [...used].sort((a, b) => formatPlain(a).localeCompare(formatPlain(b)));
    const items = sorted.map((e) => `<li id="ref-${escapeHtml(e.key)}">${this.format(e)}</li>`);
    return this.style === 'ieee' ? `<ol class="references">${items.join('')}</ol>` : `<ul class="references">${items.join('')}</ul>`;
  }

  format(e: BibEntry): string {
    return formatEntry(e, this.style);
  }
}

function formatPlain(e: BibEntry): string {
  return `${creators(e).map((p) => p.family).join(' ')} ${year(e)} ${e.fields['title'] ?? ''}`;
}

const esc = escapeHtml;
const end = (s: string) => (/[.?!]$/.test(s) ? s : `${s}.`);

/** One reference in a style, as HTML (titles of larger works are italic). */
export function formatEntry(e: BibEntry, style: CitationStyle): string {
  const f = e.fields;
  const names = creators(e);
  const title = f['title'] ?? e.key;
  const container = f['journal'] ?? f['booktitle'] ?? f['publisher'];
  const isArticle = e.type === 'article' || e.type === 'inproceedings' || e.type === 'incollection';
  const pages = f['pages'];
  const url = f['doi'] ? `https://doi.org/${f['doi']}` : f['url'];
  const link = url ? ` <a href="${esc(url)}">${esc(url)}</a>` : '';

  if (style === 'apa') {
    const who = names.map((p) => `${p.family}, ${initials(p.given)}`.trim());
    const author = who.length <= 1 ? (who[0] ?? '') : `${who.slice(0, -1).join(', ')}, & ${who[who.length - 1]}`;
    const head = author ? `${esc(end(author))} (${esc(year(e))}). ` : `(${esc(year(e))}). `;
    if (isArticle) {
      const vol = f['volume'] ? `, <i>${esc(f['volume'])}</i>${f['number'] ? `(${esc(f['number'])})` : ''}` : '';
      return `${head}${esc(end(title))} <i>${esc(container ?? '')}</i>${vol}${pages ? `, ${esc(pages)}` : ''}.${link}`;
    }
    return `${head}<i>${esc(end(title))}</i>${f['publisher'] ? ` ${esc(end(f['publisher']))}` : ''}${link}`;
  }

  if (style === 'mla') {
    const author = names.length === 0 ? '' : names.length === 1 ? `${names[0]?.family}, ${names[0]?.given}` : names.length === 2 ? `${names[0]?.family}, ${names[0]?.given}, and ${names[1]?.given} ${names[1]?.family}` : `${names[0]?.family}, ${names[0]?.given}, et al`;
    const head = author ? `${esc(end(author))} ` : '';
    if (isArticle) {
      const bits = [f['volume'] ? `vol. ${f['volume']}` : '', f['number'] ? `no. ${f['number']}` : '', year(e), pages ? `pp. ${pages}` : ''].filter(Boolean);
      return `${head}“${esc(end(title))}” <i>${esc(container ?? '')}</i>, ${esc(bits.join(', '))}.${link}`;
    }
    return `${head}<i>${esc(end(title))}</i> ${f['publisher'] ? `${esc(f['publisher'])}, ` : ''}${esc(year(e))}.${link}`;
  }

  // IEEE
  const who = names.map((p) => `${initials(p.given)} ${p.family}`.trim());
  const author = who.length <= 2 ? who.join(' and ') : `${who[0]} et al.`;
  const head = author ? `${esc(author)}, ` : '';
  if (isArticle) {
    const bits = [f['volume'] ? `vol. ${f['volume']}` : '', f['number'] ? `no. ${f['number']}` : '', pages ? `pp. ${pages}` : '', year(e)].filter(Boolean);
    return `${head}“${esc(title)},” <i>${esc(container ?? '')}</i>, ${esc(bits.join(', '))}.${link}`;
  }
  return `${head}<i>${esc(title)}</i>${f['publisher'] ? `. ${esc(f['publisher'])}` : ''}, ${esc(year(e))}.${link}`;
}

// ---- Lookups ----

/** Makes a key like `lamport1978`, avoiding keys in `taken`. */
export function makeKey(e: Pick<BibEntry, 'fields'>, taken: Set<string>): string {
  const family = (creators(e as BibEntry)[0]?.family ?? 'ref').toLowerCase().normalize('NFD').replace(/[^a-z0-9]/g, '');
  const base = `${family || 'ref'}${/\d{4}/.exec(e.fields['year'] ?? '')?.[0] ?? ''}`;
  let key = base;
  for (let n = 2; taken.has(key); n++) key = `${base}${String.fromCharCode(95 + n)}`;
  return key;
}

/** A DOI from `10.1000/xyz`, `doi:10.1000/xyz` or a doi.org URL. */
export function parseDoi(input: string): string | undefined {
  return /10\.\d{4,9}\/[^\s"<>]+/.exec(input.trim())?.[0].replace(/[.,;)]+$/, '');
}

/** An ISBN-10 or ISBN-13 from text, digits only. */
export function parseIsbn(input: string): string | undefined {
  const digits = input.replace(/[\s-]/g, '');
  return /^(?:\d{13}|\d{9}[\dXx])$/.test(digits) ? digits.toUpperCase() : undefined;
}

type Json = Record<string, unknown>;
const str = (v: unknown) => (typeof v === 'string' ? v : undefined);
const first = (v: unknown) => (Array.isArray(v) ? str(v[0]) : str(v));

/** A Crossref `works/{doi}` response as an entry. */
export function entryFromCrossref(response: unknown, taken: Set<string>): BibEntry | undefined {
  const msg = (response as Json | undefined)?.['message'] as Json | undefined;
  if (!msg) return undefined;
  const authors = ((msg['author'] as Json[] | undefined) ?? []).map((a) => `${str(a['family']) ?? ''}, ${str(a['given']) ?? ''}`.replace(/, $/, '')).filter(Boolean);
  const issued = (msg['issued'] as Json | undefined)?.['date-parts'] as number[][] | undefined;
  const type = str(msg['type']) === 'journal-article' ? 'article' : str(msg['type']) === 'proceedings-article' ? 'inproceedings' : str(msg['type'])?.includes('book') ? 'book' : 'misc';
  const fields: Record<string, string> = {};
  if (authors.length) fields['author'] = authors.join(' and ');
  const title = first(msg['title']);
  if (title) fields['title'] = title.replace(/<[^>]+>/g, '');
  const journal = first(msg['container-title']);
  if (journal) fields[type === 'inproceedings' ? 'booktitle' : 'journal'] = journal;
  if (issued?.[0]?.[0]) fields['year'] = String(issued[0][0]);
  for (const k of ['volume', 'issue', 'page', 'publisher', 'DOI']) {
    const v = str(msg[k]);
    if (v) fields[k === 'issue' ? 'number' : k === 'page' ? 'pages' : k.toLowerCase()] = v;
  }
  if (!fields['title']) return undefined;
  return { key: makeKey({ fields }, taken), type, fields };
}

/** An Open Library `api/books?bibkeys=ISBN:…&format=json&jscmd=data` response as an entry. */
export function entryFromOpenLibrary(isbn: string, response: unknown, taken: Set<string>): BibEntry | undefined {
  const book = (response as Json | undefined)?.[`ISBN:${isbn}`] as Json | undefined;
  if (!book) return undefined;
  const fields: Record<string, string> = {};
  const authors = ((book['authors'] as Json[] | undefined) ?? []).map((a) => str(a['name'])).filter((s): s is string => !!s);
  if (authors.length) fields['author'] = authors.join(' and ');
  const title = str(book['title']);
  if (!title) return undefined;
  fields['title'] = [title, str(book['subtitle'])].filter(Boolean).join(': ');
  const publisher = str(((book['publishers'] as Json[] | undefined) ?? [])[0]?.['name']);
  if (publisher) fields['publisher'] = publisher;
  const y = /\d{4}/.exec(str(book['publish_date']) ?? '')?.[0];
  if (y) fields['year'] = y;
  fields['isbn'] = isbn;
  return { key: makeKey({ fields }, taken), type: 'book', fields };
}

const decodeHtml = (s: string) =>
  s.replace(/&(amp|lt|gt|quot|#39|apos);/g, (_m, n: string) => ({ amp: '&', lt: '<', gt: '>', quot: '"', '#39': "'", apos: "'" })[n] ?? '').trim();

/** A web page as an entry, from its `<title>`, `citation_*` or Open Graph tags. */
export function entryFromHtml(url: string, html: string, taken: Set<string>, today: string): BibEntry {
  const meta = (name: string) => {
    const m = new RegExp(`<meta[^>]+(?:name|property)=["']${name}["'][^>]*content=["']([^"']*)["']`, 'i').exec(html) ?? new RegExp(`<meta[^>]+content=["']([^"']*)["'][^>]*(?:name|property)=["']${name}["']`, 'i').exec(html);
    return m?.[1] ? decodeHtml(m[1]) : undefined;
  };
  const title = meta('citation_title') ?? meta('og:title') ?? decodeHtml(/<title[^>]*>([\s\S]*?)<\/title>/i.exec(html)?.[1] ?? url);
  const fields: Record<string, string> = { title: title.replace(/\s+/g, ' ') };
  const author = meta('citation_author') ?? meta('author');
  if (author) fields['author'] = author;
  const site = meta('og:site_name');
  if (site) fields['publisher'] = site;
  const y = /\d{4}/.exec(meta('citation_publication_date') ?? meta('article:published_time') ?? '')?.[0];
  if (y) fields['year'] = y;
  fields['url'] = url;
  fields['urldate'] = today;
  return { key: makeKey({ fields: { ...fields, ...(author ? {} : { author: new URL(url).hostname.replace(/^www\./, '') }) } }, taken), type: 'misc', fields };
}
