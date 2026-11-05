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
