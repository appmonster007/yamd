// Reads and parses notes off the extension host's thread, for the first scan of a workspace.
// Parsing is synchronous, so doing thousands of notes on the host would stall typing and the UI.
import { readFileSync, statSync } from 'node:fs';
import { parentPort } from 'node:worker_threads';
import { KEEP_TEXT_BELOW, fingerprint, summarize } from '../core/notes';
import type { NoteSummary } from '../core/notes';

/** Notes larger than this are skipped, as in the host. */
const MAX_BYTES = 2 * 1024 * 1024;

export interface ScanRequest {
  id: number;
  /** Absolute paths with `/` separators, as the index keys them. */
  paths: string[];
}

export type ScanItem =
  /** `text` is a small note's text, or just its size and fingerprint for a large one. */
  | { path: string; text: string | { size: number; hash: string }; summary: NoteSummary }
  | { path: string; skipped: 'large' | 'unreadable' };

export interface ScanResponse {
  id: number;
  items: ScanItem[];
}

parentPort?.on('message', (m: ScanRequest) => {
  const items: ScanItem[] = [];
  for (const path of m.paths) {
    try {
      if (statSync(path).size > MAX_BYTES) {
        items.push({ path, skipped: 'large' });
        continue;
      }
      const text = readFileSync(path, 'utf8');
      const summary = summarize(path, text);
      items.push({ path, text: text.length <= KEEP_TEXT_BELOW ? text : { size: text.length, hash: fingerprint(text) }, summary });
    } catch {
      items.push({ path, skipped: 'unreadable' });
    }
  }
  parentPort?.postMessage({ id: m.id, items } satisfies ScanResponse);
});
