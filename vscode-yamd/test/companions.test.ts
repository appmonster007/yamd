import assert from 'node:assert/strict';
import { describe, test } from 'node:test';
import { COMPANIONS, companionFor, dataKind } from '../src/core/companions';

describe('companions', () => {
  test('data files map to the companion that edits them', () => {
    assert.deepEqual(['a.csv', 'a.SQLITE', 'a.db', 'a.json', 'a.txt'].map((f) => dataKind(f)), ['csv', 'sqlite', 'sqlite', 'json', undefined]);
    assert.equal(companionFor('csv'), COMPANIONS.csv);
    assert.equal(companionFor('sqlite'), COMPANIONS.sqlite);
    assert.equal(companionFor('json'), undefined);
  });
});
