import { existsSync, realpathSync } from 'node:fs';
import type { FileAccess } from '../core/db/scope';

/** The `FileAccess` every database-resolving call site needs: real disk access via `node:fs`. */
export const nodeFsAccess: FileAccess = {
  exists: (p) => existsSync(p),
  realpath: (p) => {
    try {
      return realpathSync.native(p);
    } catch {
      return p;
    }
  },
};
