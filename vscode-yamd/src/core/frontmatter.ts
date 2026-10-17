import { parse } from 'yaml';
import type { FrontMatter } from './types';

/** Extracts YAML front matter if the document starts with a `---` line. */
export function extractFrontMatter(lines: string[]): FrontMatter | null {
  if (lines[0]?.trim() !== '---') return null;
  const end = lines.findIndex((l, i) => i > 0 && (l.trim() === '---' || l.trim() === '...'));
  if (end === -1) return null;
  const yaml = lines.slice(1, end).join('\n');
  try {
    const data: unknown = parse(yaml);
    const record = data && typeof data === 'object' && !Array.isArray(data) ? (data as Record<string, unknown>) : {};
    return { data: record, line: 0, endLine: end };
  } catch (err) {
    return { data: {}, line: 0, endLine: end, error: err instanceof Error ? err.message : String(err) };
  }
}

const BUILT_INS = ['title', 'author', 'date'] as const;

/** Looks up `{{ path }}`: built-ins first, then dotted paths under `vars`. */
export function lookupVariable(fm: FrontMatter | null, path: string): string | undefined {
  const data = fm?.data ?? {};
  if ((BUILT_INS as readonly string[]).includes(path)) return stringify(data[path]);
  let value: unknown = data['vars'];
  for (const key of path.split('.')) {
    if (!value || typeof value !== 'object') return undefined;
    value = (value as Record<string, unknown>)[key];
  }
  return stringify(value);
}

function stringify(value: unknown): string | undefined {
  if (value === undefined || value === null) return undefined;
  if (Array.isArray(value)) return value.map((v) => stringify(v) ?? '').join(', ');
  if (value instanceof Date) return value.toISOString().slice(0, 10);
  if (typeof value === 'object') return undefined;
  return String(value);
}
