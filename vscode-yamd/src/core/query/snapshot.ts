import { closeMarker, openMarker, writeRegion } from '../build/markers';
import type { QueryResult } from './engine';

export const SNAPSHOT_ROWS = 50;

const cell = (v: unknown) => (v === null || v === undefined ? '' : String(v)).replace(/\|/g, '\\|').replace(/\r?\n/g, ' ');

/** A Markdown table of the result, at most 50 rows, with a `last run` line and a `+N more rows` note. */
export function snapshotLines(result: QueryResult, now: Date, maxRows = SNAPSHOT_ROWS): string[] {
  const stamp = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-${String(now.getDate()).padStart(2, '0')} ${String(now.getHours()).padStart(2, '0')}:${String(now.getMinutes()).padStart(2, '0')}`;
  const out: string[] = [];
  if (result.columns.length) {
    out.push(`| ${result.columns.map(cell).join(' | ')} |`, `| ${result.columns.map(() => '---').join(' | ')} |`);
    for (const row of result.rows.slice(0, maxRows)) out.push(`| ${row.map(cell).join(' | ')} |`);
  }
  out.push('');
  const more = result.total - Math.min(result.rows.length, maxRows);
  if (more > 0) out.push(`+${more} more rows`, '');
  out.push(`*Last run: ${stamp}*`);
  return out;
}

/** Writes the snapshot under the block that ends on `afterLine`, replacing an earlier snapshot of the same query. */
export function writeSnapshot(lines: string[], id: string, afterLine: number, result: QueryResult, now: Date): string[] {
  return writeRegion(lines, `query:${id}`, snapshotLines(result, now), { insertAfter: afterLine });
}

export { openMarker, closeMarker };
