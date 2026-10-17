/**
 * `.ydb` text databases: loading, validation (Y852–Y854) and row-level writes that keep comments,
 * key order and every other row byte-identical.
 */
import { isMap, isScalar, isSeq, parseDocument } from 'yaml';
import type { Document, Node as YamlNode, YAMLMap } from 'yaml';
import type { Diagnostic, Range } from '../types';

export const PROPERTY_TYPES = [
  'title',
  'text',
  'number',
  'select',
  'multi_select',
  'status',
  'date',
  'checkbox',
  'url',
  'email',
  'person',
  'relation',
  'formula',
  'created_time',
  'updated_time',
] as const;
export type PropertyType = (typeof PROPERTY_TYPES)[number];

export interface Property {
  name: string;
  type: PropertyType;
  options?: string[];
  /** Relation target, relative to the database file. */
  database?: string;
  /** SQL expression for formulas. */
  expression?: string;
}

export interface SavedView {
  type?: string;
  filter?: string;
  sort?: string[];
  group?: string;
  columns?: string[];
  limit?: number;
  date?: string;
  cover?: string;
}

export type Row = { id: string } & Record<string, unknown>;

export interface Schema {
  name?: string;
  properties: Property[];
  views: Record<string, SavedView>;
}

export interface YdbDatabase extends Schema {
  rows: Row[];
}

/** Properties computed by YAMD that can't be edited. */
export const READ_ONLY_TYPES = new Set<PropertyType>(['formula', 'created_time', 'updated_time']);

export function titleProperty(schema: Schema): Property | undefined {
  return schema.properties.find((p) => p.type === 'title') ?? schema.properties.find((p) => p.type === 'text');
}

function strings(v: unknown): string[] | undefined {
  if (Array.isArray(v)) return v.map(String);
  if (typeof v === 'string') return v.split(',').map((s) => s.trim()).filter(Boolean);
  return undefined;
}

export function parseView(v: unknown): SavedView {
  const o = (v && typeof v === 'object' ? v : {}) as Record<string, unknown>;
  const str = (k: string) => (typeof o[k] === 'string' ? (o[k] as string) : undefined);
  return {
    type: str('type'),
    filter: str('filter'),
    sort: strings(o['sort']),
    group: str('group'),
    columns: strings(o['columns']),
    limit: typeof o['limit'] === 'number' ? o['limit'] : undefined,
    date: str('date'),
    cover: str('cover'),
  };
}

function rangeOf(node: YamlNode | null | undefined, lineStarts?: number[]): Range {
  void lineStarts;
  const r = node?.range;
  return r ? { start: r[0], end: r[1] } : { start: 0, end: 0 };
}

const ISO_DATE = /^\d{4}-\d{2}-\d{2}(?:[T ]\d{2}:\d{2}(?::\d{2}(?:\.\d+)?)?(?:Z|[+-]\d{2}:?\d{2})?)?$/;

/** Checks a value against its property; returns a problem description or null. */
export function checkValue(p: Property, v: unknown): { message: string; severity: 'error' | 'warning' } | null {
  if (v === null || v === undefined || v === '') return null;
  const err = (message: string) => ({ message, severity: 'error' as const });
  switch (p.type) {
    case 'number':
      return typeof v === 'number' ? null : err(`"${p.name}" is a number property, but the value is ${JSON.stringify(v)}.`);
    case 'checkbox':
      return typeof v === 'boolean' ? null : err(`"${p.name}" is a checkbox property; use true or false.`);
    case 'date':
    case 'created_time':
    case 'updated_time':
      return typeof v === 'string' && ISO_DATE.test(v) ? null : err(`"${p.name}" needs a date like 2026-10-16.`);
    case 'multi_select':
    case 'relation': {
      if (!Array.isArray(v)) return err(`"${p.name}" needs a list, for example [a, b].`);
      if (p.type === 'multi_select' && p.options) {
        const unknown = v.filter((x) => !p.options?.includes(String(x)));
        if (unknown.length) return { message: `${unknown.map((u) => `"${u}"`).join(', ')} isn't an option of "${p.name}".`, severity: 'warning' };
      }
      return null;
    }
    case 'select':
    case 'status':
      if (typeof v === 'object') return err(`"${p.name}" needs a single value.`);
      if (p.options && !p.options.includes(String(v))) return { message: `"${String(v)}" isn't an option of "${p.name}" (${p.options.join(', ')}).`, severity: 'warning' };
      return null;
    case 'url':
    case 'email':
    case 'title':
    case 'text':
    case 'person':
      return typeof v === 'object' ? err(`"${p.name}" needs text.`) : null;
    case 'formula':
      return err(`"${p.name}" is a formula and is computed; remove the stored value.`);
  }
}

export interface LoadResult {
  db: YdbDatabase | null;
  diagnostics: Diagnostic[];
}

/** Parses and validates a `.ydb` file. `db` is null when the structure is unusable. */
export function loadYdb(text: string): LoadResult {
  const diagnostics: Diagnostic[] = [];
  const report = (code: string, severity: Diagnostic['severity'], message: string, range: Range) =>
    diagnostics.push({ code, severity, message, range });
  const doc = parseDocument(text);
  for (const e of doc.errors) {
    report('Y852', 'error', `Invalid YAML: ${e.message.split('\n')[0]}`, { start: e.pos[0], end: e.pos[1] });
  }
  if (doc.errors.length) return { db: null, diagnostics };
  const root = doc.contents;
  if (!isMap(root)) {
    report('Y852', 'error', 'A database must be a YAML map with "yamdb", "properties" and "rows".', { start: 0, end: Math.min(text.length, 1) });
    return { db: null, diagnostics };
  }
  if (!root.has('yamdb')) report('Y852', 'error', 'Add "yamdb: 0.1" to mark this file as a YAMD database.', { start: 0, end: 0 });

  const properties: Property[] = [];
  const propsNode = root.get('properties', true);
  if (!isMap(propsNode)) {
    report('Y852', 'error', '"properties" must map property names to types.', rangeOf(propsNode ?? root));
    return { db: null, diagnostics };
  }
  for (const pair of propsNode.items) {
    const name = isScalar(pair.key) ? String(pair.key.value) : '';
    const value = pair.value as YamlNode | null;
    let type: string | undefined;
    let extra: Record<string, unknown> = {};
    if (isScalar(value)) type = String(value.value);
    else if (isMap(value)) {
      extra = value.toJSON() as Record<string, unknown>;
      type = typeof extra['type'] === 'string' ? (extra['type'] as string) : undefined;
    }
    if (!type || !(PROPERTY_TYPES as readonly string[]).includes(type)) {
      report('Y852', 'error', `Unknown property type "${type ?? ''}" for "${name}". Use one of: ${PROPERTY_TYPES.join(', ')}.`, rangeOf(value ?? (pair.key as YamlNode)));
      continue;
    }
    const p: Property = { name, type: type as PropertyType };
    const options = strings(extra['options']);
    if (options) p.options = options;
    if (typeof extra['database'] === 'string') p.database = extra['database'];
    if (typeof extra['expression'] === 'string') p.expression = extra['expression'];
    if (p.type === 'relation' && !p.database) report('Y852', 'error', `Relation "${name}" needs "database".`, rangeOf(value));
    if (p.type === 'formula' && !p.expression) report('Y852', 'error', `Formula "${name}" needs "expression".`, rangeOf(value));
    properties.push(p);
  }

  const views: Record<string, SavedView> = {};
  const viewsNode = root.get('views', true);
  if (isMap(viewsNode)) {
    for (const pair of viewsNode.items) {
      if (isScalar(pair.key)) views[String(pair.key.value)] = parseView((pair.value as YamlNode | null)?.toJSON());
    }
  }

  const rows: Row[] = [];
  const rowsNode = root.get('rows', true);
  if (rowsNode !== undefined && !isSeq(rowsNode)) {
    report('Y852', 'error', '"rows" must be a list.', rangeOf(rowsNode));
    return { db: null, diagnostics };
  }
  const ids = new Set<string>();
  const byName = new Map(properties.map((p) => [p.name, p]));
  for (const item of isSeq(rowsNode) ? rowsNode.items : []) {
    if (!isMap(item)) {
      report('Y852', 'error', 'Each row must be a map with an "id".', rangeOf(item as YamlNode));
      continue;
    }
    const idNode = item.get('id', true);
    const id = isScalar(idNode) ? String(idNode.value) : '';
    if (!id) {
      report('Y852', 'error', 'This row has no "id".', rangeOf(item));
      continue;
    }
    if (ids.has(id)) report('Y854', 'error', `The row id "${id}" is used more than once.`, rangeOf(idNode as YamlNode));
    ids.add(id);
    const row = item.toJSON() as Row;
    row.id = id;
    for (const pair of item.items) {
      const key = isScalar(pair.key) ? String(pair.key.value) : '';
      if (key === 'id') continue;
      const p = byName.get(key);
      if (!p) continue;
      const problem = checkValue(p, row[key]);
      if (problem) report('Y853', problem.severity, problem.message, rangeOf(pair.value as YamlNode));
    }
    rows.push(row);
  }
  const name = root.get('name');
  return {
    db: { name: typeof name === 'string' ? name : undefined, properties, views, rows },
    diagnostics,
  };
}

// ---- Writes ----

/** Replace lines [startLine, endLine] (inclusive); `endLine < startLine` inserts before `startLine`. */
export interface YdbEdit {
  startLine: number;
  endLine: number;
  text: string;
}

/** Output options matching how people write `.ydb` files: `[a, b]`, no line wrapping. */
const TO_STRING = { lineWidth: 0, flowCollectionPadding: false } as const;

function lineAt(text: string, offset: number): number {
  let n = 0;
  for (let i = 0; i < offset && i < text.length; i++) if (text.charCodeAt(i) === 10) n++;
  return n;
}

function rowsSeq(doc: Document): ReturnType<YAMLMap['get']> {
  return isMap(doc.contents) ? doc.contents.get('rows', true) : undefined;
}

/** The lines of row `id` in the text, from its `- ` line to its last value line. */
function rowLines(text: string, doc: Document, id: string): { start: number; end: number; index: number } | null {
  const seq = rowsSeq(doc);
  if (!isSeq(seq)) return null;
  const index = seq.items.findIndex((it) => isMap(it) && String(it.get('id')) === id);
  const item = seq.items[index] as YamlNode | undefined;
  if (!item?.range) return null;
  // The row starts at its `- ` marker, which is before the map's own range.
  const before = text.lastIndexOf('\n', item.range[0] - 1) + 1;
  let endOffset = item.range[1];
  while (endOffset > item.range[0] && /\s/.test(text[endOffset - 1] ?? '')) endOffset--;
  return { start: lineAt(text, before), end: lineAt(text, endOffset - 1), index };
}

/** Renders one row in the style of the file's other rows: `  - id: x` then `    Key: value`. */
function rowText(text: string, doc: Document, index: number): string {
  const seq = rowsSeq(doc);
  if (!isSeq(seq)) return '';
  const item = seq.items[index];
  // Serialize just this row as a one-item list, then indent it like the original.
  const single = parseDocument('[]');
  const copy = (item as YamlNode).clone() as YamlNode & { spaceBefore?: boolean; commentBefore?: string | null };
  // Blank lines and comments before the row stay outside the replaced lines.
  copy.spaceBefore = false;
  copy.commentBefore = null;
  single.contents = single.createNode([copy]) as never;
  const yaml = single.toString(TO_STRING).trimEnd();
  const lines = text.split('\n');
  const first = (seq.items[0] as YamlNode | undefined)?.range;
  const indent = first ? (/^\s*/.exec(lines[lineAt(text, first[0])] ?? '')?.[0] ?? '') : '  ';
  return yaml
    .split('\n')
    .map((l) => indent + l)
    .join('\n');
}

/** Sets (or with `undefined`, removes) one value in one row. Returns null if the row is missing. */
export function setCell(text: string, id: string, prop: string, value: unknown, now?: string): YdbEdit | null {
  const doc = parseDocument(text);
  const where = rowLines(text, doc, id);
  if (!where) return null;
  const seq = rowsSeq(doc);
  if (!isSeq(seq)) return null;
  const row = seq.items[where.index];
  if (!isMap(row)) return null;
  if (value === undefined || value === null || value === '') row.delete(prop);
  else row.set(prop, value);
  touch(doc, row, now, false);
  return { startLine: where.start, endLine: where.end, text: rowText(text, doc, where.index) };
}

function touch(doc: Document, row: YAMLMap, now: string | undefined, created: boolean) {
  if (!now || !isMap(doc.contents)) return;
  const props = doc.contents.get('properties', true);
  if (!isMap(props)) return;
  for (const pair of props.items) {
    const type = isScalar(pair.value) ? pair.value.value : isMap(pair.value) ? pair.value.get('type') : undefined;
    const key = isScalar(pair.key) ? String(pair.key.value) : '';
    if (type === 'updated_time' || (created && type === 'created_time')) row.set(key, now);
  }
}

/** A new 6-character id not used by any row. */
export function newRowId(existing: Iterable<string>, random: () => number = Math.random): string {
  const used = new Set(existing);
  for (;;) {
    const id = Math.floor(random() * 36 ** 6).toString(36).padStart(6, '0');
    if (!used.has(id)) return id;
  }
}

/** Appends a row (after the last row, or under `rows:`). */
export function addRow(text: string, values: Record<string, unknown>, now?: string, id?: string): { edit: YdbEdit; id: string } | null {
  const doc = parseDocument(text);
  if (!isMap(doc.contents)) return null;
  let seq = rowsSeq(doc);
  const ids = isSeq(seq) ? seq.items.map((it) => (isMap(it) ? String(it.get('id')) : '')) : [];
  const rowId = id ?? newRowId(ids);
  const row = doc.createNode({ id: rowId, ...values }) as YAMLMap;
  touch(doc, row, now, true);
  if (!isSeq(seq)) {
    // No rows yet: write the whole `rows:` key at the end of the file.
    const single = parseDocument('{}');
    single.contents = single.createNode({ rows: [row.toJSON()] }) as never;
    const lines = text.split('\n');
    const last = lines.length - (lines[lines.length - 1] === '' ? 1 : 0);
    const existing = isMap(doc.contents) ? doc.contents.get('rows', true) : undefined;
    if (existing !== undefined && existing !== null) return null;
    return { edit: { startLine: last, endLine: last - 1, text: `\n${single.toString(TO_STRING).trimEnd()}` }, id: rowId };
  }
  seq.items.push(row);
  seq = rowsSeq(doc);
  const lastIndex = isSeq(seq) ? seq.items.length - 2 : -1;
  const prev = lastIndex >= 0 ? rowLines(text, doc, ids[lastIndex] ?? '') : null;
  const textOfNew = rowText(text, doc, lastIndex + 1);
  if (!prev) return null;
  // Keep the file's blank-line spacing between rows.
  const lines = text.split('\n');
  const spaced = prev.start > 0 && (lines[prev.start - 1] ?? '').trim() === '' ? '\n' : '';
  return {
    edit: { startLine: prev.end + 1, endLine: prev.end, text: `${spaced}${textOfNew}` },
    id: rowId,
  };
}

/** Removes a row and the blank line before it. */
export function deleteRow(text: string, id: string): YdbEdit | null {
  const doc = parseDocument(text);
  const where = rowLines(text, doc, id);
  if (!where) return null;
  const lines = text.split('\n');
  const start = where.start > 0 && (lines[where.start - 1] ?? '').trim() === '' ? where.start - 1 : where.start;
  return { startLine: start, endLine: where.end, text: '' };
}

/** Moves row `id` before row `beforeId` (or to the end), for manual ordering. */
export function moveRow(text: string, id: string, beforeId: string | null): YdbEdit | null {
  const doc = parseDocument(text);
  const from = rowLines(text, doc, id);
  if (!from) return null;
  const lines = text.split('\n');
  const seq = rowsSeq(doc);
  if (!isSeq(seq)) return null;
  const all = seq.items.map((it) => (isMap(it) ? String(it.get('id')) : ''));
  const first = rowLines(text, doc, all[0] ?? '');
  const last = rowLines(text, doc, all[all.length - 1] ?? '');
  if (!first || !last) return null;
  const blocks = all.map((rid) => {
    const r = rowLines(text, doc, rid);
    return { id: rid, lines: r ? lines.slice(r.start, r.end + 1) : [] };
  });
  const moving = blocks.find((b) => b.id === id);
  if (!moving) return null;
  const rest = blocks.filter((b) => b.id !== id);
  const at = beforeId === null ? rest.length : rest.findIndex((b) => b.id === beforeId);
  if (at === -1) return null;
  rest.splice(at, 0, moving);
  const spaced = blocks.length > 1 && lines.slice(first.end + 1, (rowLines(text, doc, all[1] ?? '')?.start ?? 0)).some((l) => l.trim() === '');
  const body = rest.map((b) => b.lines.join('\n')).join(spaced ? '\n\n' : '\n');
  return { startLine: first.start, endLine: last.end, text: body };
}

/** Adds or replaces a saved view. */
export function saveView(text: string, name: string, view: SavedView): YdbEdit | null {
  const doc = parseDocument(text);
  if (!isMap(doc.contents)) return null;
  const clean = Object.fromEntries(Object.entries(view).filter(([, v]) => v !== undefined && !(Array.isArray(v) && v.length === 0)));
  doc.setIn(['views', name], clean);
  const lines = text.split('\n');
  // The yaml library rewrites the file keeping comments and key order.
  const out = doc.toString(TO_STRING).replace(/\n$/, '');
  return { startLine: 0, endLine: lines.length - (text.endsWith('\n') ? 2 : 1), text: out };
}
