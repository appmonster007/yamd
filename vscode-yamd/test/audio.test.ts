import assert from 'node:assert/strict';
import { existsSync, mkdtempSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import * as path from 'node:path';
import { describe, test } from 'node:test';
import { extensionFor, linkText, placeLink, recordingName, shiftOffset, uniqueName } from '../src/core/audio/audio';
import { recorderHtml } from '../src/extension/audio/recorderPage';
import { saveRecording } from '../src/extension/audio/save';
import { startUploadServer } from '../src/extension/audio/uploadServer';

const apply = (text: string, e: { offset: number; remove: number; insert: string }) => text.slice(0, e.offset) + e.insert + text.slice(e.offset + e.remove);
const LINK = '[Rec](audio/a.webm)';

describe('naming and links', () => {
  test('extension from the recorder MIME type', () => {
    assert.deepEqual(['audio/webm;codecs=opus', 'audio/ogg', 'audio/mp4', 'audio/wav', 'what/ever'].map(extensionFor), ['webm', 'ogg', 'm4a', 'wav', 'webm']);
  });

  test('file names carry the date and time, and an optional label', () => {
    const d = new Date(2026, 10, 5, 14, 3);
    assert.equal(recordingName(d, 'webm'), 'note-2026-11-05-1403.webm');
    assert.equal(recordingName(d, 'webm', ' Stand-up / Q&A! '), 'note-2026-11-05-1403-stand-up-q-a.webm');
  });

  test('a taken name gets a number', () => {
    const taken = new Set(['a.webm', 'a-2.webm']);
    assert.equal(uniqueName('a.webm', (n) => taken.has(n)), 'a-3.webm');
    assert.equal(uniqueName('b.webm', (n) => taken.has(n)), 'b.webm');
  });

  test('the link is relative, encoded, and labelled with the time', () => {
    assert.equal(linkText('audio/my note.webm', new Date(2026, 10, 5, 9, 7)), '[Recording 5 Nov, 09:07](audio/my%20note.webm)');
    assert.equal(linkText('audio/x.webm', new Date(), 'A [b] c'), '[A b c](audio/x.webm)');
  });
});

describe('placing the link', () => {
  const at = (text: string, offset: number) => apply(text, placeLink(text, offset, LINK));

  test('on a blank line, with a blank line kept on each side', () => {
    assert.equal(at('First.\n\n\nSecond.', 7), `First.\n\n${LINK}\n\nSecond.`);
    assert.equal(at('Text\n\nMore', 5), `Text\n\n${LINK}\n\nMore`);
    assert.equal(at('A\n\nB', 3), `A\n\n${LINK}\n\nB`);
  });

  test('in the middle of a line, as its own paragraph after that line', () => {
    assert.equal(at('One two three.\nNext line.', 4), `One two three.\n\n${LINK}\n\nNext line.`);
  });

  test('at the start of a line, before it', () => {
    assert.equal(at('Alpha\nBeta', 6), `Alpha\n\n${LINK}\n\nBeta`);
  });

  test('at the end of the note', () => {
    assert.equal(at('The end.', 8), `The end.\n\n${LINK}`);
  });

  test('a cursor inside a code block puts the link after the block, never inside it', () => {
    const text = 'Before\n\n```js\nlet a = 1;\nlet b = 2;\n```\n\nAfter';
    assert.equal(at(text, text.indexOf('let b')), `Before\n\n\`\`\`js\nlet a = 1;\nlet b = 2;\n\`\`\`\n\n${LINK}\n\nAfter`);
  });
});

describe('tracking the position', () => {
  test('text added before moves it, text after does not, and a replaced range pulls it to the end of the new text', () => {
    assert.equal(shiftOffset(20, [{ rangeOffset: 0, rangeLength: 0, textLength: 5 }]), 25);
    assert.equal(shiftOffset(20, [{ rangeOffset: 30, rangeLength: 0, textLength: 5 }]), 20);
    assert.equal(shiftOffset(20, [{ rangeOffset: 5, rangeLength: 4, textLength: 0 }]), 16);
    assert.equal(shiftOffset(20, [{ rangeOffset: 15, rangeLength: 10, textLength: 3 }]), 18);
    assert.equal(shiftOffset(20, [{ rangeOffset: 0, rangeLength: 0, textLength: 2 }, { rangeOffset: 10, rangeLength: 5, textLength: 1 }]), 18);
  });
});

describe('saving', () => {
  const dir = () => mkdtempSync(path.join(tmpdir(), 'yamd-audio-'));

  test('writes next to the note and returns a relative link; a second save does not overwrite', () => {
    const root = dir();
    const note = path.join(root, 'notes', 'a.md');
    const now = new Date(2026, 10, 5, 14, 30);
    const a = saveRecording({ noteFile: note, folder: 'audio', bytes: new Uint8Array([1, 2, 3]), mime: 'audio/webm;codecs=opus', now });
    assert.equal(a.relativePath, 'audio/note-2026-11-05-1430.webm');
    assert.equal(a.link, '[Recording 5 Nov, 14:30](audio/note-2026-11-05-1430.webm)');
    assert.deepEqual([...readFileSync(a.file)], [1, 2, 3]);
    const b = saveRecording({ noteFile: note, folder: 'audio', bytes: new Uint8Array([9]), mime: 'audio/webm', now });
    assert.equal(b.relativePath, 'audio/note-2026-11-05-1430-2.webm');
    assert.ok(existsSync(a.file) && existsSync(b.file));
  });

  test('a folder outside the note is refused', () => {
    const note = path.join(dir(), 'a.md');
    assert.throws(() => saveRecording({ noteFile: note, folder: '../../elsewhere', bytes: new Uint8Array([1]), mime: 'audio/webm' }), /inside the note's folder/);
  });
});

describe('the recorder page', () => {
  test('its script parses and every element it uses exists', () => {
    for (const mode of ['panel', 'browser'] as const) {
      const html = recorderHtml({ mode, nonce: 'abc', cspSource: 'x' });
      const script = /<script[^>]*>([\s\S]*)<\/script>/.exec(html)?.[1] ?? '';
      assert.doesNotThrow(() => new Function(script), mode);
      for (const id of new Set([...script.matchAll(/\$\('([a-z]+)'\)/g)].map((m) => m[1] as string))) {
        if (id === 'browser' && mode === 'browser') continue;
        assert.ok(html.includes(`id="${id}"`), `${mode}: #${id}`);
      }
    }
    assert.match(recorderHtml({ mode: 'panel', nonce: 'n1' }), /Content-Security-Policy[^>]*script-src 'nonce-n1'/);
    assert.doesNotMatch(recorderHtml({ mode: 'browser' }), /Content-Security-Policy/);
  });
});

describe('the upload server', () => {
  test('serves the page only with the token and takes one upload', async () => {
    const server = await startUploadServer((t) => `<html>page for ${t.length} chars</html>`);
    const base = server.url.split('?')[0] as string;
    const token = new URL(server.url).searchParams.get('token') as string;
    assert.equal((await fetch(base)).status, 403);
    assert.equal((await fetch(`${base}?token=wrong`)).status, 403);
    const page = await fetch(server.url);
    assert.equal(page.status, 200);
    assert.match(await page.text(), /page for/);
    assert.equal((await fetch(`${base}upload?token=bad`, { method: 'POST', body: 'x' })).status, 403);
    const res = await fetch(`${base}upload?token=${token}&label=standup`, { method: 'POST', headers: { 'content-type': 'audio/webm' }, body: new Uint8Array([5, 6, 7]) });
    assert.equal(res.status, 200);
    const upload = await server.upload;
    assert.equal(upload.mime, 'audio/webm');
    assert.equal(upload.label, 'standup');
    assert.deepEqual([...upload.bytes], [5, 6, 7]);
  });

  test('refuses an upload over the size limit, and closing before an upload rejects', async () => {
    const server = await startUploadServer(() => 'x', 4);
    const token = new URL(server.url).searchParams.get('token') as string;
    const base = server.url.split('?')[0] as string;
    const res = await fetch(`${base}upload?token=${token}`, { method: 'POST', body: new Uint8Array(100) }).catch(() => undefined);
    assert.ok(!res || res.status === 413);
    server.close();
    await assert.rejects(server.upload, /closed/);
  });
});
