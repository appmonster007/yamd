import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { test } from 'node:test';
import { parse } from '../src/core';

test('parses getting-started.yamd 100 times in under a second', () => {
  const src = readFileSync(new URL('../../examples/getting-started.yamd', import.meta.url), 'utf8');
  parse(src); // Warm up.
  // Other test files run in parallel, so time several batches of 10 and use the fastest one.
  let best = Infinity;
  for (let batch = 0; batch < 15; batch++) {
    const start = performance.now();
    for (let i = 0; i < 10; i++) parse(src);
    best = Math.min(best, performance.now() - start);
  }
  const ms = best * 10;
  console.log(`100 parses: ${ms.toFixed(0)} ms`);
  assert.ok(ms < 1000, `took ${ms.toFixed(0)} ms`);
});
