// Runs database jobs off the extension host's main thread. The host terminates this worker when a
// query runs past the timeout, which is the only reliable way to stop sql.js mid-statement.
import * as path from 'node:path';
import { parentPort } from 'node:worker_threads';
import initSqlJs from 'sql.js';
import { executeJob } from '../core/db/jobs';
import type { Job } from '../core/db/jobs';

const ready = initSqlJs({ locateFile: () => path.join(__dirname, 'sql-wasm.wasm') });

parentPort?.on('message', async (m: { id: number; job: Job }) => {
  try {
    const SQL = await ready;
    const result = executeJob(SQL, m.job);
    const transfer = result.bytes ? [result.bytes.buffer as ArrayBuffer] : [];
    parentPort?.postMessage({ id: m.id, result }, transfer);
  } catch (err) {
    parentPort?.postMessage({ id: m.id, error: err instanceof Error ? err.message : String(err) });
  }
});
