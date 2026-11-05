import assert from 'node:assert/strict';
import { describe, test } from 'node:test';
import { computeBoardEdit } from '../src/core/boardEdit';

describe('boardEdit', () => {
  test('adds a kanban card through the generic message', () => {
    const src = ':::kanban\n## Todo\n\n- [ ] one\n:::\n';
    const edit = computeBoardEdit(src, { kind: 'kanban', op: 'add', board: 0, args: { column: 0, text: 'two' } });
    assert.ok(edit);
    assert.match(edit.text, /- \[ \] two/);
  });

  test('returns null for an unknown operation or a stale card', () => {
    assert.equal(computeBoardEdit('x\n', { kind: 'gallery', op: 'toggle', board: 0, args: {} }), null);
    assert.equal(computeBoardEdit('- [ ] a\n', { kind: 'task', op: 'toggle', board: 0, card: { line: 0, hash: 'stale' }, args: { done: true } }), null);
  });

  test('a card operation without a card is refused', () => {
    assert.equal(computeBoardEdit('x\n', { kind: 'kanban', op: 'move', board: 0, args: { toColumn: 0, toIndex: 0 } }), null);
  });
});
