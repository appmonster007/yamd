import assert from 'node:assert/strict';
import { describe, test } from 'node:test';
import { onEnter, toggleMarker } from '../src/extension/editing';

/** Applies a change and marks the resulting selection with [ and ]. */
function apply(text: string, start: number, end: number, marker: string): string {
  const c = toggleMarker(text, start, end, marker);
  const out = text.slice(0, c.start) + c.text + text.slice(c.end);
  return `${out.slice(0, c.selection[0])}[${out.slice(c.selection[0], c.selection[1])}]${out.slice(c.selection[1])}`;
}

describe('toggleMarker', () => {
  test('wraps a selection', () => {
    assert.equal(apply('a word b', 2, 6, '**'), 'a **[word]** b');
  });

  test('removes markers inside the selection', () => {
    assert.equal(apply('a **word** b', 2, 10, '**'), 'a [word] b');
  });

  test('removes markers around the selection', () => {
    assert.equal(apply('a **word** b', 4, 8, '**'), 'a [word] b');
  });

  test('inserts a pair with no selection', () => {
    assert.equal(apply('ab', 1, 1, '++'), 'a++[]++b');
  });

  test('removes an empty pair', () => {
    assert.equal(apply('a****b', 3, 3, '**'), 'a[]b');
  });

  test('italic inside bold adds italic instead of breaking bold', () => {
    assert.equal(apply('**word**', 2, 6, '*'), '***[word]***');
  });
});

describe('onEnter', () => {
  test('continues a bullet list', () => {
    assert.deepEqual(onEnter('  - Item'), { kind: 'continue', prefix: '  - ' });
  });

  test('continues an ordered list', () => {
    assert.deepEqual(onEnter('3. Third'), { kind: 'continue', prefix: '4. ' });
    assert.deepEqual(onEnter('9) Ninth'), { kind: 'continue', prefix: '10) ' });
  });

  test('continues a task list with an open box', () => {
    assert.deepEqual(onEnter('- [x] Done'), { kind: 'continue', prefix: '- [ ] ' });
  });

  test('ends the list on an empty item', () => {
    assert.deepEqual(onEnter('- '), { kind: 'end' });
    assert.deepEqual(onEnter('2. '), { kind: 'end' });
    assert.deepEqual(onEnter('- [ ] '), { kind: 'end' });
  });

  test('ignores other lines', () => {
    assert.deepEqual(onEnter('Just text'), { kind: 'default' });
    assert.deepEqual(onEnter('---'), { kind: 'default' });
    assert.deepEqual(onEnter('**bold**'), { kind: 'default' });
  });
});
