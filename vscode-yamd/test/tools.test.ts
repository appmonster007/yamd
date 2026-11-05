import { test } from 'node:test';
import assert from 'node:assert/strict';
import { checkNote } from '../src/core/build/check';
import { cardsFromCallouts } from '../src/core/study/fromCallouts';
import { queryBlock } from '../src/core/editing/queryBuilder';
import { inlineImages } from '../src/core/export/inline';
import { writeRegion } from '../src/core/build/markers';
import { extractCardsMd } from '../src/core/study/calloutCards';

const ctx = (files: string[], bibKeys?: string[]) => ({ exists: (p: string) => files.includes(p), ...(bibKeys ? { bibKeys: new Set(bibKeys) } : {}) });

test('check: missing image, data file, unknown key, dangling reference', () => {
  const lines = ['![a](img/a.png)', '![b](https://x.io/b.png)', '```sql', '-- id="q" source="nope.csv"', 'SELECT 1;', '```', 'See [@smith] and [@fig-x].'];
  const codes = checkNote(lines, ctx([], ['jones'])).map((p) => p.code);
  assert.deepEqual(codes.sort(), ['N001', 'N002', 'N003', 'N004']);
  assert.equal(checkNote(['![a](img/a.png)'], ctx(['img/a.png'])).length, 0);
});

test('check: code spans and fences are ignored', () => {
  assert.equal(checkNote(['`[@fig-x]`', '```', '![a](nope.png)', '[@zzz]', '```'], ctx([], [])).length, 0);
});

test('cards from callouts', () => {
  const lines = ['> [!definition] Prime', '> A number with two divisors.', '', '> [!question] Why?', '> Because.', '', '> [!note] Skip', '> me'];
  const cards = cardsFromCallouts(lines);
  assert.deepEqual(cards, ['> [!card] Definition: Prime', '> A number with two divisors.', '', '> [!card] Why?', '> Because.']);
  const note = writeRegion(lines, 'cards', cards, { insertAfter: lines.length - 1 });
  assert.equal(extractCardsMd(note.join('\n'), 'n.md').length, 2);
  assert.deepEqual(writeRegion(note, 'cards', cards), note);
});

test('query block', () => {
  const b = queryBlock({ id: 'open', source: 'bugs.csv', table: 'bugs', columns: ['id', 'due date'], where: "status = 'open'", orderBy: 'id', limit: 5, view: 'table' });
  assert.equal(b, ['```sql', '-- id="open" source="bugs.csv" view="table"', 'SELECT id, "due date"\nFROM bugs\nWHERE status = \'open\'\nORDER BY id\nLIMIT 5;', '```'].join('\n'));
  assert.match(queryBlock({ id: 'c', source: 'a.csv', table: 'a', columns: [], view: 'chart', x: 'k', y: 'v' }), /x="k" y="v" type="bar"/);
});

test('inline images', () => {
  const r = inlineImages(['![a](a.png "t")', '![b](gone.png)', '![c](https://x/y.png)', '```', '![d](a.png)', '```'], (p) => (p === 'a.png' ? new Uint8Array([1, 2, 3]) : undefined), (b) => Buffer.from(b).toString('base64'));
  assert.equal(r.lines[0], '![a](data:image/png;base64,AQID "t")');
  assert.equal(r.lines[1], '![b](gone.png)');
  assert.equal(r.lines[4], '![d](a.png)');
  assert.deepEqual(r.missing, ['gone.png']);
});
