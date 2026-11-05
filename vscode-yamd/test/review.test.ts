import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { parse } from '../src/core';
import { reviewReplacement, topLevel } from '../src/core/study/review';

const src = 'A {++new++} and {--old--} and {~~cat~>dog~~} here {==marked==}{>>why?<<} end.\n';

describe('review node resolution (for accept/reject at cursor)', () => {
  it('finds the node at a given offset and resolves only it', () => {
    const doc = parse(src);
    const nodes = topLevel(doc);
    // The `{--old--}` node, found the way the command finds the node under the cursor.
    const offset = src.indexOf('{--old--}') + 2;
    const node = nodes.find((n) => n.range.start <= offset && offset <= n.range.end);
    assert.ok(node);
    const raw = doc.source.slice(node!.range.start, node!.range.end);
    assert.equal(reviewReplacement(node!, raw, 'accept'), '');
    assert.equal(reviewReplacement(node!, raw, 'reject'), 'old');
  });

  it('matches resolveReview for the same node', async () => {
    const { resolveReview } = await import('../src/core/study/review');
    const doc = parse(src);
    const node = topLevel(doc).find((n) => doc.source.slice(n.range.start, n.range.end).includes('cat~>dog'));
    assert.ok(node);
    const raw = doc.source.slice(node!.range.start, node!.range.end);
    assert.equal(reviewReplacement(node!, raw, 'accept'), 'dog');
    // The whole-document resolution also turns this substitution into "dog".
    assert.ok(resolveReview(doc, 'accept').includes('dog'));
  });
});
