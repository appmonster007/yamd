/**
 * Chunked parsing must give exactly the same document as parsing everything at once. These tests
 * parse the same text both ways, with the minimum chunk size lowered to 1 so every safe split is
 * taken, and compare the results.
 */
import assert from 'node:assert/strict';
import { readdirSync, readFileSync, statSync } from 'node:fs';
import * as path from 'node:path';
import { before, describe, test } from 'node:test';
import commonmark from 'commonmark-spec';
import { planChunks } from '../src/core/chunking';
import { isDefinitionLine, isWarm, parse, parseIfCheap, parseUncached, setChunkMinChars, warmParse } from '../src/core/parser';

before(() => setChunkMinChars(1));

const lineCount = (s: string) => s.split('\n').length;

/** Parses both ways and compares. Returns how many chunks the document was split into. */
function same(source: string, label = source.slice(0, 80)): number {
  const full = parseUncached(source, 'full');
  const chunked = parseUncached(source, 'chunked');
  assert.deepStrictEqual(chunked, full, `chunked parse differs for ${JSON.stringify(label)}`);
  return planChunks(full.lines, 1, isDefinitionLine)?.starts.length ?? 1;
}

const root = path.resolve('../examples');
const walk = (d: string): string[] =>
  readdirSync(d).flatMap((n) => {
    const f = path.join(d, n);
    return statSync(f).isDirectory() ? walk(f) : f.endsWith('.yamd') ? [f] : [];
  });
const examples = walk(root).map((f) => ({ name: path.relative(root, f), text: readFileSync(f, 'utf8') }));

describe('chunked parsing matches a full parse', () => {
  for (const { name, text } of examples) {
    test(`example ${name}`, () => {
      same(text, name);
    });
  }

  test('all examples joined into one document', () => {
    const joined = examples.map((e) => e.text.replace(/^---\n[\s\S]*?\n---\n/, '')).join('\n\n');
    // Some examples contain `]:` text that isn't a definition, so this one may be parsed whole.
    same(joined, 'joined examples');
  });

  test('the CommonMark and GFM spec examples, one at a time', () => {
    for (const e of commonmark.tests as { markdown: string; number: number }[]) same(e.markdown.replace(/→/g, '\t'), `spec ${e.number}`);
  });

  test('the spec examples in random combinations', () => {
    const pool = (commonmark.tests as { markdown: string }[]).map((e) => e.markdown.replace(/→/g, '\t'));
    // A small seeded generator keeps failures reproducible.
    let seed = 12345;
    const random = () => (seed = (seed * 1664525 + 1013904223) >>> 0) / 2 ** 32;
    const separators = ['\n\n', '\n\n\n', '\n', '\n\n  \n', '\n\n'];
    let splits = 0;
    for (let round = 0; round < 400; round++) {
      const parts: string[] = [];
      for (let k = 0, n = 2 + Math.floor(random() * 10); k < n; k++) parts.push(pool[Math.floor(random() * pool.length)] as string);
      let doc = parts[0] as string;
      for (let k = 1; k < parts.length; k++) doc += (separators[Math.floor(random() * separators.length)] as string) + (parts[k] as string);
      splits += same(doc, `round ${round} seed ${seed}`) - 1;
    }
    assert.ok(splits > 200, `only ${splits} splits were exercised`);
  });

  test('YAMD constructs split across blank lines', () => {
    const snippets = [
      '```js\nfirst\n\nsecond\n```',
      '~~~\na\n\n\nb\n~~~',
      '<!--\ncomment\n\nmore\n-->',
      '<pre>\nx\n\ny\n</pre>',
      ':::note {title="T"}\nbody\n\nmore body\n:::',
      '::::outer\n:::inner\nx\n\ny\n:::\n\nz\n::::',
      '$$ {#eq:a}\nE = mc^2\n\n+ 1\n$$',
      '- one\n\n- two\n\n  nested paragraph\n- three',
      '1. a\n\n2. b\n\n   ```\n   code\n\n   more\n   ```',
      '> quote\n>\n> still quote\n\n> second quote',
      '[^1]: Footnote text.\n\n    Second paragraph.',
      'Uses a note[^1] and [a link][ref] and [other][].\n\n[ref]: https://example.com "Title"\n\n[other]: /path',
      '%% block comment\nhidden\n\nmore hidden\n%%',
      '{.cls #id}\nA paragraph with attributes ^blk',
      '| a | b |\n| - | - |\n| 1 | 2 |',
      '## Heading {#h}\n\n#tag text [[wiki]] ![[embed]] {{ var }} ==mark== H_{2}O x^2',
      '    indented code\n\n    still code',
      'Setext\n------\n\nafter',
      '{start=5}\n5. five\n6. six',
      '::toc{depth=2}\n\n::include[x.yamd]\n\n:kbd[Ctrl] inline',
      ':::kanban\n## Todo\n\n- [ ] a\n\n## Done\n\n- [x] b\n:::',
      '***\n\n---\n\n___',
      '  \n\n',
    ];
    let seed = 777;
    const random = () => (seed = (seed * 1664525 + 1013904223) >>> 0) / 2 ** 32;
    let splits = 0;
    for (let round = 0; round < 500; round++) {
      const parts: string[] = [];
      for (let k = 0, n = 2 + Math.floor(random() * 8); k < n; k++) parts.push(snippets[Math.floor(random() * snippets.length)] as string);
      const front = random() < 0.3 ? '---\ntitle: T\nvars:\n  a: 1\n\n  b: 2\n---\n' : '';
      const doc = front + parts.join(random() < 0.5 ? '\n\n' : '\n\n\n') + (random() < 0.5 ? '\n' : '');
      splits += same(doc, `yamd round ${round} seed ${seed}`) - 1;
    }
    assert.ok(splits > 300, `only ${splits} splits were exercised`);
  });

  test('CRLF line endings', () => {
    const doc = examples.find((e) => e.name.endsWith('tables.yamd'))?.text.replace(/\n/g, '\r\n') ?? '';
    same(doc, 'crlf tables');
  });
});

describe('what is not split', () => {
  const starts = (doc: string) => planChunks(doc.split('\n'), 1, isDefinitionLine)?.starts ?? null;

  test('blank lines inside code, comments, containers and math', () => {
    assert.equal(lineCount('x'), 1);
    assert.deepEqual(starts('a\n\n```\nb\n\nc\n```\n\nd'), [0, 2, 8]);
    assert.deepEqual(starts('a\n\n<!--\nb\n\nc\n-->\n\nd'), [0, 2, 8]);
    assert.deepEqual(starts('a\n\n:::note\nb\n\nc\n:::\n\nd'), [0, 2, 8]);
    assert.deepEqual(starts('a\n\n$$\nb\n\nc\n$$\n\nd'), [0, 2, 8]);
  });

  test('a list continues across blank lines, but ends at plain text', () => {
    assert.deepEqual(starts('- a\n\n- b\n\ntext'), [0, 4]);
    assert.deepEqual(starts('- a\n\n  more\n\ntext'), [0, 4]);
  });

  test('documents with definitions that cannot be shared are not split', () => {
    assert.equal(starts('para\n[x]: /url\n\nmore'), null);
    assert.equal(starts('> [x]: /url\n\nmore'), null);
    assert.equal(starts('[x]:\n/url\n\nmore'), null);
    assert.equal(starts('[Foo\n  bar]: /url\n\n[Baz][Foo bar]'), null);
    assert.equal(starts('[foo]: <bar>(baz)\n\n[foo]'), null);
    assert.equal(starts('[a label that\ncontinues]: /url\n\nmore'), null);
    assert.equal(starts('- [x]: /url\n\nmore'), null);
    // These can't be definitions, so they don't stop the document being split.
    assert.deepEqual(starts('- [ ] [[ada]]: text\n\nmore'), [0, 2]);
    assert.deepEqual(starts('[[ada]]: text\n\nmore'), [0, 2]);
    assert.deepEqual(starts('some text with a colon after a bracket [1]: here\n\nmore'), [0, 2]);
  });
});

describe('warming large documents', () => {
  const base = examples.find((e) => e.name === 'getting-started.yamd')?.text.replace(/^---\n[\s\S]*?\n---\n/, '').replace(/^::toc.*$/m, '') ?? '';
  const large = (tag: string) => Array.from({ length: 60 }, (_, i) => `${base}\n\nSection ${tag} ${i}\n`).join('\n\n');

  test('a large cold text is not cheap until it has been warmed', async () => {
    setChunkMinChars(3000);
    const text = large('cold');
    assert.ok(text.length > 150_000);
    assert.equal(isWarm(text), false);
    assert.equal(parseIfCheap(text), undefined);
    await warmParse(text);
    assert.equal(isWarm(text), true);
    assert.ok(parseIfCheap(text));
  });

  test('a warmed parse equals a normal full parse', async () => {
    setChunkMinChars(3000);
    const text = large('equal');
    await warmParse(text);
    assert.deepStrictEqual(parse(text), parseUncached(text, 'full'));
  });

  test('warming stops when the text is no longer current, and small texts are always cheap', async () => {
    setChunkMinChars(3000);
    const text = large('stale');
    await warmParse(text, () => false);
    assert.equal(isWarm(text), false);
    assert.equal(isWarm('# small'), true);
  });

  test('warming yields to the event loop', async () => {
    setChunkMinChars(3000);
    const text = large('yield');
    let ticks = 0;
    const timer = setInterval(() => ticks++, 1);
    await warmParse(text);
    clearInterval(timer);
    assert.ok(ticks > 2, `the loop only ran ${ticks} times while warming`);
  });
});
