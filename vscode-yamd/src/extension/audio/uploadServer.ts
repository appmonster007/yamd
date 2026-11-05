import * as http from 'node:http';
import type { AddressInfo } from 'node:net';
import { randomBytes } from 'node:crypto';

export interface Upload {
  mime: string;
  bytes: Uint8Array;
  label?: string;
}

export interface UploadServer {
  /** `http://127.0.0.1:PORT/?token=…`, the page that records. */
  url: string;
  /** Resolves with the recording the page uploads, or rejects when the server is closed first. */
  upload: Promise<Upload>;
  close(): void;
}

/**
 * A one-shot local server for recording in a browser, when VS Code's own panel can't reach the
 * microphone. It listens on 127.0.0.1 only, serves `page` and accepts one upload carrying the secret
 * token, then stops. `maxBytes` caps the upload.
 */
export function startUploadServer(page: (token: string) => string, maxBytes = 200 * 1024 * 1024): Promise<UploadServer> {
  const token = randomBytes(18).toString('hex');
  let resolve!: (u: Upload) => void;
  let reject!: (e: Error) => void;
  const upload = new Promise<Upload>((res, rej) => {
    resolve = res;
    reject = rej;
  });
  upload.catch(() => undefined);

  const server = http.createServer((req, res) => {
    const url = new URL(req.url ?? '/', 'http://127.0.0.1');
    const valid = url.searchParams.get('token') === token;
    if (!valid) {
      res.writeHead(403).end('Forbidden');
      return;
    }
    if (req.method === 'GET' && url.pathname === '/') {
      res.writeHead(200, { 'content-type': 'text/html; charset=utf-8', 'cache-control': 'no-store' }).end(page(token));
      return;
    }
    if (req.method === 'POST' && url.pathname === '/upload') {
      const chunks: Buffer[] = [];
      let size = 0;
      req.on('data', (c: Buffer) => {
        size += c.length;
        if (size > maxBytes) {
          res.writeHead(413).end('Too large');
          req.destroy();
        } else chunks.push(c);
      });
      req.on('end', () => {
        if (size > maxBytes || size === 0) return;
        res.writeHead(200, { 'content-type': 'text/plain' }).end('Saved');
        const label = url.searchParams.get('label') ?? undefined;
        resolve({ mime: String(req.headers['content-type'] ?? 'audio/webm'), bytes: new Uint8Array(Buffer.concat(chunks)), ...(label ? { label } : {}) });
        setTimeout(() => server.close(), 200);
      });
      return;
    }
    res.writeHead(404).end('Not found');
  });

  return new Promise((ok, fail) => {
    server.once('error', fail);
    server.listen(0, '127.0.0.1', () => {
      const { port } = server.address() as AddressInfo;
      ok({
        url: `http://127.0.0.1:${port}/?token=${token}`,
        upload,
        close: () => {
          reject(new Error('closed'));
          server.close();
          server.closeAllConnections?.();
        },
      });
    });
  });
}
