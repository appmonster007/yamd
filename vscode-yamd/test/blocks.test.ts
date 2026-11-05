import assert from 'node:assert/strict';
import { describe, test } from 'node:test';
import { allFences, blockSnippet, findEnclosingFence, findUnclosedFence, matchingFenceLine } from '../src/extension/blocks';

const lines = (text: string) => text.split('\n');

describe('allFences', () => {
  test('finds nested containers', () => {
    const doc = lines(':::note\n:::tip\ntext\n:::\n:::');
    assert.deepEqual(allFences(doc), [
      { openLine: 0, closeLine: 4, name: 'note' },
      { openLine: 1, closeLine: 3, name: 'tip' },
    ]);
  });

  test('ignores an unclosed fence', () => {
    assert.deepEqual(allFences(lines(':::note\ntext')), []);
  });
});

describe('findEnclosingFence', () => {
  test('finds the innermost fence enclosing a line', () => {
    const doc = lines(':::note\n:::tip\ntext\n:::\n:::');
    assert.equal(findEnclosingFence(doc, 2)?.name, 'tip');
    assert.equal(findEnclosingFence(doc, 0)?.name, 'note');
  });

  test('returns undefined outside any fence', () => {
    assert.equal(findEnclosingFence(lines('plain text'), 0), undefined);
  });
});

describe('findUnclosedFence', () => {
  test('finds the nearest still-open container', () => {
    const doc = lines(':::note\ntext');
    assert.equal(findUnclosedFence(doc, 1)?.name, 'note');
  });

  test('is empty once the fence closes', () => {
    const doc = lines(':::note\ntext\n:::\nafter');
    assert.equal(findUnclosedFence(doc, 3), undefined);
  });
});

describe('matchingFenceLine', () => {
  test('jumps from open to close and back', () => {
    const doc = lines(':::note\ntext\n:::');
    assert.equal(matchingFenceLine(doc, 0), 2);
    assert.equal(matchingFenceLine(doc, 2), 0);
  });

  test('handles nesting', () => {
    const doc = lines(':::note\n:::tip\ntext\n:::\n:::');
    assert.equal(matchingFenceLine(doc, 1), 3);
    assert.equal(matchingFenceLine(doc, 0), 4);
  });
});

describe('blockSnippet', () => {
  test('wraps a container with a blank line between the fences', () => {
    assert.deepEqual(blockSnippet({ name: 'note', isContainer: true }), { text: ':::note\n\n:::', cursorOffset: 8 });
  });

  test('inserts a leaf as one line', () => {
    assert.deepEqual(blockSnippet({ name: 'toc', isContainer: false }), { text: '::toc', cursorOffset: 5 });
  });
});
