import { test } from 'node:test';
import assert from 'node:assert/strict';
import { audioLinks, cleanTranscript, commandWords, placeTranscript } from '../src/core/audio/transcript';
import { reminderMessage, shouldRemind } from '../src/core/study/reminders';

test('audio links: local audio only, outside code', () => {
  const lines = ['[Rec](audio/a%20b.webm)', '[x](https://x.io/a.mp3)', '[doc](notes.md)', '```', '[Rec](audio/c.webm)', '```', 'two [a](a.wav) [b](b.m4a)'];
  assert.deepEqual(audioLinks(lines), [{ line: 0, path: 'audio/a b.webm' }, { line: 6, path: 'a.wav' }, { line: 6, path: 'b.m4a' }]);
});

test('command words keep quoted paths and fill {file}', () => {
  assert.deepEqual(commandWords('whisper-cli -m "my models/x.bin" -f {file}', '/a b/c.webm'), ['whisper-cli', '-m', 'my models/x.bin', '-f', '/a b/c.webm']);
  assert.deepEqual(commandWords("tool --in={file}", 'f.wav'), ['tool', '--in=f.wav']);
});

test('transcript text drops timestamps', () => {
  assert.equal(cleanTranscript('[00:00:00.000 --> 00:00:02.000]  Hello there.\n\n[00:00:02.000 --> 00:00:04.000]  Second line.\n'), 'Hello there. Second line.');
});

test('transcript goes under the link and is replaced, not duplicated', () => {
  const note = ['# T', '', '[Rec](a.webm)', '', 'After.'];
  const once = placeTranscript(note, 2, 'Hello. World here.');
  assert.deepEqual(once, ['# T', '', '[Rec](a.webm)', '', '> [!note] Transcript', '> Hello.', '> World here.', '', 'After.']);
  const twice = placeTranscript(once, 2, 'Changed text.');
  assert.deepEqual(twice, ['# T', '', '[Rec](a.webm)', '', '> [!note] Transcript', '> Changed text.', '', 'After.']);
  assert.deepEqual(placeTranscript(['[Rec](a.webm)'], 0, 'Hi.'), ['[Rec](a.webm)', '', '> [!note] Transcript', '> Hi.']);
});

test('reminder text and once-a-day rule', () => {
  assert.equal(reminderMessage({ dueCards: 0, overdue: 0, dueToday: 0 }), undefined);
  assert.equal(reminderMessage({ dueCards: 1, overdue: 2, dueToday: 3 }), 'YAMD: 1 card to review, 3 deadlines today, 2 overdue.');
  assert.ok(shouldRemind(undefined, '2026-11-05'));
  assert.ok(shouldRemind('2026-11-04', '2026-11-05'));
  assert.ok(!shouldRemind('2026-11-05', '2026-11-05'));
});
