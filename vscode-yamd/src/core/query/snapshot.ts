import { closeMarker, findRegions, openMarker, writeRegion } from '../build/markers';
import type { QueryResult } from './engine';

const SNAPSHOT_ROWS = 50;

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

const LAST_RUN = /^\*Last run: .*\*$/;
const withoutStamp = (lines: string[]) => lines.filter((l) => !LAST_RUN.test(l));

/**
 * Writes the snapshot under the block that ends on `afterLine`, replacing an earlier snapshot of the
 * same query. When the rows haven't changed, the earlier snapshot (and its `Last run` time) stays, so
 * running a query twice changes nothing.
 */
export function writeSnapshot(lines: string[], id: string, afterLine: number, result: QueryResult, now: Date): string[] {
  const next = snapshotLines(result, now);
  const region = findRegions(lines).find((r) => r.name === `query:${id}`);
  if (region) {
    const current = lines.slice(region.open + 1, region.close);
    const a = withoutStamp(current);
    const b = withoutStamp(next);
    if (a.length === b.length && a.every((l, i) => l === b[i])) return lines;
  }
  return writeRegion(lines, `query:${id}`, next, { insertAfter: afterLine });
}

export { openMarker, closeMarker };
