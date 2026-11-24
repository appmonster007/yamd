import { test } from 'node:test';
import assert from 'node:assert/strict';
import { findMentions, namesOf, wikilinkFor } from '../src/core/notes/mentions';
import { headingNodes, mentionNodes, outlineNodes } from '../src/core/sidebar/nodes';

test('headings nest by level and skip code and front matter', () => {
  const lines = ['---', 'title: x', '# not a heading', '---', '# One', '## A', '### Deep', '## B', '```', '# in code', '```', '# Two ^id'];
  const tree = headingNodes(lines);
  assert.deepEqual(tree.map((n) => n.label), ['One', 'Two']);
  assert.deepEqual(tree[0]?.children?.map((n) => n.label), ['A', 'B']);
  assert.equal(tree[0]?.children?.[0]?.children?.[0]?.label, 'Deep');
  assert.equal(tree[0]?.line, 4);
  assert.equal(outlineNodes(lines)[0]?.label, 'Headings');
});

test('a note answers to its file name, title and aliases', () => {
  const n = namesOf('/n/ada-lovelace.md', ['---', 'title: Ada Lovelace', 'aliases: [Ada, Countess]', '---']);
  assert.equal(n.target, 'ada-lovelace');
  // Names match case-insensitively, so "Ada Lovelace" and "ada lovelace" are one name.
  assert.deepEqual([...n.names].sort(), ['Ada', 'Countess', 'ada lovelace', 'ada-lovelace']);
  assert.deepEqual(namesOf('/n/x.md', []).names, []);
});

test('mentions skip links, code, urls, headings, front matter and the note itself', () => {
  const self = namesOf('/n/ada-lovelace.md', []);
  const notes = [
    { path: '/n/other.md', text: '---\nabout: ada lovelace\n---\n# Ada Lovelace heading\nMet Ada Lovelace today.\nLinked [[ada-lovelace]] and [Ada Lovelace](x.md) and `ada lovelace` and https://x.io/ada-lovelace.\n```\nada lovelace\n```\nAda-lovelace again, but not Adas lovelace.' },
    { path: '/n/ada-lovelace.md', text: 'ada lovelace' },
  ];
  const found = findMentions(self, notes, '/n/ada-lovelace.md');
  assert.deepEqual(found.map((m) => [m.line, m.col, m.text]), [[4, 4, 'Ada Lovelace'], [9, 0, 'Ada-lovelace']]);
});

test('short names are ignored and the link keeps the words as written', () => {
  assert.deepEqual(namesOf('/n/ai.md', []).names, []);
  assert.equal(wikilinkFor('ada-lovelace', 'ada-lovelace'), '[[ada-lovelace]]');
  assert.equal(wikilinkFor('ada-lovelace', 'Ada Lovelace'), '[[ada-lovelace|Ada Lovelace]]');
});

test('mention nodes group by note and carry what linking needs', () => {
  const nodes = mentionNodes('/n/ada-lovelace.md', [], [{ path: '/n/b.md', text: 'x\nSee ada lovelace here' }], (p) => p.split('/').pop()!.replace('.md', ''));
  assert.equal(nodes[0]?.label, 'b');
  assert.equal(nodes[0]?.description, '1 mention');
  assert.deepEqual(nodes[0]?.children?.[0]?.mention, { path: '/n/b.md', line: 1, col: 4, length: 12, target: 'ada-lovelace', text: 'ada lovelace' });
});
