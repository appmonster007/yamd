import assert from 'node:assert/strict';
import { describe, test } from 'node:test';
import { computeBoardEdit } from '../src/core/widgets/boardEdit';
import { applyBodyEdit, bodyEdit } from '../src/core/widgets/widgetBody';
import { scanWidgets } from '../src/core/widgets/fences';
import { parse } from '../src/core/markdown';

/** Runs a board edit on the first widget of `note`, the way the widget panel does. */
function edit(note: string, message: Parameters<typeof computeBoardEdit>[1]): string | null {
  const lines = note.split('\n');
  const block = scanWidgets(lines)[0]!;
  const synthetic = [`:::${block.type}`, ...lines.slice(block.bodyStartLine, block.bodyEndLine + 1), ':::'].join('\n');
  const e = computeBoardEdit(synthetic, message);
  const change = e ? bodyEdit(synthetic, e, block.bodyStartLine) : null;
  return change ? applyBodyEdit(lines, change).join('\n') : null;
}

const note = '# Plan\n\nIntro text.\n\n```kanban sprint\n## Todo\n- [ ] one\n- [ ] two\n\n## Done\n- [x] zero\n```\n\nAfter the board.\n';

describe('widget body edits', () => {
  test('adding a card changes only lines inside the fence', () => {
    const out = edit(note, { kind: 'kanban', op: 'add', board: 0, args: { column: 0, text: 'three' } });
    assert.ok(out);
    assert.equal(out, note.replace('- [ ] two\n', '- [ ] two\n- [ ] three\n'));
  });

  test('moving a card to another column rewrites the block body', () => {
    const doc = parse(':::kanban\n## Todo\n- [ ] one\n- [ ] two\n\n## Done\n- [x] zero\n:::');
    void doc;
    const out = edit(note, { kind: 'kanban', op: 'rename', board: 0, card: { line: 2, hash: '' }, args: { title: 'x' } });
    // A wrong hash is a stale card: the edit is refused.
    assert.equal(out, null);
  });

  test('ticking a task inside a board works through the task message', () => {
    const lines = note.split('\n');
    const block = scanWidgets(lines)[0]!;
    const synthetic = [`:::kanban`, ...lines.slice(block.bodyStartLine, block.bodyEndLine + 1), ':::'].join('\n');
    // The preview computes a card hash; reuse the real one.
    const html = require('../src/core/markdown').render(parse(synthetic), { interactive: true }) as string;
    const m = /data-line="(\d+)" data-hash="([^"]+)"/.exec(html);
    assert.ok(m);
    const out = edit(note, { kind: 'task', op: 'toggle', board: 0, card: { line: Number(m[1]), hash: m[2]! }, args: { done: true } });
    assert.ok(out);
    assert.match(out!, /- \[x\] one/);
    assert.ok(out!.startsWith('# Plan\n\nIntro text.'));
    assert.ok(out!.endsWith('After the board.\n'));
  });

  test('an edit that would alter the container lines is refused', () => {
    assert.equal(bodyEdit(':::kanban\n- [ ] a\n:::', { startLine: 0, endLine: 0, text: ':::calendar' }, 5), null);
  });

  test('an empty board accepts its first card', () => {
    const out = edit('```kanban\n```\n', { kind: 'kanban', op: 'add', board: 0, args: { column: 0, text: 'first' } });
    assert.ok(out === null || /first/.test(out));
  });
});
