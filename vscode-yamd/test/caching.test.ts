import assert from 'node:assert/strict';
import { describe, test } from 'node:test';
import { lint, render } from '../src/core';
import { NoteStore } from '../src/core/notes';
import type { NoteLookup } from '../src/core/notes';
import { parse, parseUncached } from '../src/core/parser';
import { escapeHtml } from '../src/core/render';

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

  test('rendering and linting do not change a shared document', () => {
    const doc = parse('# A\n\n::toc\n\n## B\n\n[x](#nope)');
    const before = JSON.stringify(doc.blocks);
    render(doc);
    lint(doc);
    render(doc, { interactive: true });
    assert.equal(JSON.stringify(doc.blocks), before);
  });

  test('old entries are dropped, not kept forever', () => {
    const first = parse('first document');
    for (let i = 0; i < 40; i++) parse(`filler document ${i}`);
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

describe('incremental link resolution', () => {
  const links = (s: NoteStore, to: string) => s.backlinks(to).map((b) => b.from);

  test('editing a note updates only its own links', () => {
    const s = new NoteStore();
    s.set('target.yamd', '# T');
    s.set('a.yamd', '[[target]]');
    s.set('b.yamd', 'nothing');
    assert.deepEqual(links(s, 'target.yamd'), ['a.yamd']);
    s.set('b.yamd', 'now [[target]]');
    assert.deepEqual(links(s, 'target.yamd'), ['a.yamd', 'b.yamd']);
    s.set('a.yamd', 'removed the link');
    assert.deepEqual(links(s, 'target.yamd'), ['b.yamd']);
  });

  test('creating a note resolves links that were broken', () => {
    const s = new NoteStore();
    s.set('a.yamd', '[[later]]');
    assert.equal(s.graph().nodes.some((n) => n.missing), true);
    s.set('later.yamd', '# Later');
    assert.deepEqual(links(s, 'later.yamd'), ['a.yamd']);
    assert.equal(s.graph().nodes.some((n) => n.missing), false);
  });

  test('deleting a note breaks the links to it again', () => {
    const s = new NoteStore();
    s.set('t.yamd', '');
    s.set('a.yamd', '[[t]]');
    assert.deepEqual(links(s, 't.yamd'), ['a.yamd']);
    s.delete('t.yamd');
    assert.equal(s.graph().nodes.find((n) => n.missing)?.label, 't');
  });

  test('changing an alias moves the links that use it', () => {
    const s = new NoteStore();
    s.set('q3.yamd', '---\naliases: [Plan]\n---');
    s.set('q4.yamd', '---\naliases: [Other]\n---');
    s.set('a.yamd', '[[Plan]]');
    assert.deepEqual(links(s, 'q3.yamd'), ['a.yamd']);
    s.set('q3.yamd', '---\naliases: [Renamed]\n---');
    s.set('q4.yamd', '---\naliases: [Plan]\n---');
    assert.deepEqual(links(s, 'q3.yamd'), []);
    assert.deepEqual(links(s, 'q4.yamd'), ['a.yamd']);
  });

  test('tags follow edits', () => {
    const s = new NoteStore();
    s.set('a.yamd', '#one');
    assert.deepEqual([...s.tags().keys()], ['one']);
    s.set('a.yamd', '#two');
    assert.deepEqual([...s.tags().keys()], ['two']);
    s.delete('a.yamd');
    assert.deepEqual([...s.tags().keys()], []);
  });
});

describe('lint and other notes', () => {
  test('uses the lookup\'s summaries instead of parsing linked notes again', () => {
    const store = new NoteStore();
    store.set('guide.yamd', '# Guide\n\n## Install');
    let summaryCalls = 0;
    let reads = 0;
    const lookup: NoteLookup = {
      has: (p) => store.has(p),
      read: (p) => (reads++, store.read(p)),
      root: (p) => store.root(p),
      byName: (n) => store.byName(n),
      byAlias: (a) => store.byAlias(a),
      summary: (p) => (summaryCalls++, store.summary(p)),
    };
    const src = '---\nlang: en\n---\n[[guide#Install]] [[guide#Missing]]';
    const found = lint(parse(src), { notes: { lookup, path: 'a.yamd' } }).map((d) => d.code);
    assert.deepEqual(found, ['Y701']);
    assert.ok(summaryCalls > 0);
    assert.equal(reads, 0);
  });
});
