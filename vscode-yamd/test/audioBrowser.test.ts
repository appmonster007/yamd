import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { existsSync, mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import * as path from 'node:path';
import { test } from 'node:test';
import { recorderHtml } from '../src/extension/audio/recorderPage';
import { startUploadServer } from '../src/extension/audio/uploadServer';

const CHROME = [process.env['CHROME'], '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome', '/usr/bin/google-chrome', '/usr/bin/chromium'].find((c) => c && existsSync(c));

// Records two seconds from Chrome's fake microphone through the real page and the real upload server.
test('the recorder page records and uploads from a browser', { skip: CHROME ? false : 'Chrome is not installed' }, async () => {
  const autoRun = `<script>
    window.addEventListener('load', function () {
      var $ = function (id) { return document.getElementById(id); };
      $('rec').click();
      setTimeout(function () { $('name').value = 'standup'; $('stop').click(); }, 1800);
      setTimeout(function () { $('save').click(); }, 2800);
    });
  </script>`;
  const server = await startUploadServer(() => recorderHtml({ mode: 'browser' }).replace('</body>', `${autoRun}</body>`));
  const chrome = spawn(
    CHROME as string,
    [...(process.env['CI'] ? ['--no-sandbox'] : []), '--headless=new', '--disable-gpu', '--no-first-run', '--use-fake-device-for-media-stream', '--use-fake-ui-for-media-stream', `--user-data-dir=${mkdtempSync(path.join(tmpdir(), 'yamd-chrome-'))}`, server.url],
    { stdio: 'ignore' },
  );
  try {
    const upload = await Promise.race([server.upload, new Promise<never>((_, reject) => setTimeout(() => reject(new Error('no upload within 30 s')), 30000))]);
    assert.match(upload.mime, /^audio\/webm/);
    assert.ok(upload.bytes.length > 1000, `only ${upload.bytes.length} bytes`);
    assert.equal(upload.label, 'standup');
  } finally {
    chrome.kill();
    server.close();
  }
});
