import assert from 'node:assert/strict';
import { describe, test } from 'node:test';
import { parse, parseUncached } from '../src/core/markdown/parser';
import { escapeHtml } from '../src/core/markdown/render';

describe('parse cache', () => {
  test('the same text gives the same document, different text a different one', () => {
    const a = parse('# One\n\ntext');
    assert.equal(parse('# One\n\ntext'), a);
    assert.notEqual(parse('# Two\n\ntext'), a);
  });

  test('a cached document matches a fresh parse', () => {
    const src = '---\ntitle: T\n---\n# A\n\n- [ ] task #tag\n\n[[x]] and ![[y]]';
    parse(src);
    assert.deepEqual(parse(src), parseUncached(src));
  });


  test('old entries are dropped, not kept forever', () => {
    const first = parse('first document');
    for (let i = 0; i < 100; i++) parse(`filler document ${i}`);
    assert.notEqual(parse('first document'), first);
  });
});

describe('escapeHtml', () => {
  test('escapes the five characters in one pass', () => {
    assert.equal(escapeHtml(`a & b < c > d " e ' f`), 'a &amp; b &lt; c &gt; d &quot; e &#39; f');
    assert.equal(escapeHtml('&amp;'), '&amp;amp;');
  });

  test('returns text without special characters unchanged', () => {
    const s = 'plain text with nothing to escape';
    assert.equal(escapeHtml(s), s);
  });
});


describe('lint and other notes', () => {
});


describe('unlinked mentions', () => {
});

describe('heading IDs', () => {
  /** The straightforward version the registry replaces. */
  function naive(used: Set<string>, base: string): string {
    const root = base || 'section';
    let id = root;
    for (let n = 2; used.has(id); n++) id = `${root}-${n}`;
    used.add(id);
    return id;
  }

  test('give the same IDs as counting up from -2 each time, including collisions', async () => {
    const { SlugRegistry } = await import('../src/core/markdown/slug');
    let seed = 42;
    const random = () => (seed = (seed * 1664525 + 1013904223) >>> 0) / 2 ** 32;
    const names = ['a', 'a-2', 'a-3', 'b', '', 'a-2-2', 'section', 'section-2'];
    for (let round = 0; round < 200; round++) {
      const registry = new SlugRegistry();
      const used = new Set<string>();
      for (const reserved of ['b-2', 'a-4']) if (random() < 0.5) (registry.reserve(reserved), used.add(reserved));
      for (let i = 0; i < 40; i++) {
        const name = names[Math.floor(random() * names.length)] as string;
        assert.equal(registry.unique(name), naive(used, name), `round ${round} step ${i} name ${name}`);
      }
    }
  });
});

describe('memory of the note index', () => {
  const small = (n: number) => `# Note ${n}\n\nSee [[target]].\n`;
  const large = (n: number) => `# Big ${n}\n\nSee [[target]] and Target here.\n\n${'filler line of text\n'.repeat(400)}`;





});
