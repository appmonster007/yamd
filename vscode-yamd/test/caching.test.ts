import assert from 'node:assert/strict';
import { describe, test } from 'node:test';
import { lint, render } from '../src/core';
import { NoteStore, summarize } from '../src/core/notes';
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

describe('graph cache and revisions', () => {
  const ids = (s: NoteStore) => s.graph().nodes.map((n) => n.id).sort();
  const edges = (s: NoteStore) => s.graph().edges.map((e) => `${e.source}>${e.target}`).sort();

  test('typing that changes nothing in the graph keeps the same graph', () => {
    const s = new NoteStore();
    s.set('a.yamd', '# A\n\n[[b]]');
    s.set('b.yamd', '# B');
    const graph = s.graph();
    const revision = s.graphRevision;
    s.set('a.yamd', '# A\n\n[[b]] with more text typed after it');
    assert.equal(s.graphRevision, revision);
    assert.equal(s.graph(), graph);
  });

  test('changes to links, titles, tags, notes and aliases update the graph', () => {
    const s = new NoteStore();
    s.set('a.yamd', '# A\n\n[[b]]');
    s.set('b.yamd', '# B');
    assert.deepEqual(edges(s), ['a.yamd>b.yamd']);

    s.set('a.yamd', '# A\n\n[[c]]');
    assert.deepEqual(edges(s), ['a.yamd>missing:c']);
    s.set('c.yamd', '# C');
    assert.deepEqual(edges(s), ['a.yamd>c.yamd']);

    s.set('b.yamd', '---\ntitle: Renamed\n---');
    assert.equal(s.graph().nodes.find((n) => n.id === 'b.yamd')?.label, 'Renamed');
    s.set('b.yamd', '---\ntitle: Renamed\n---\n#tagged');
    assert.deepEqual(s.graph().nodes.find((n) => n.id === 'b.yamd')?.tags, ['tagged']);

    s.set('c.yamd', '---\naliases: [Gone]\n---');
    s.set('a.yamd', '# A\n\n[[Gone]]');
    assert.deepEqual(edges(s), ['a.yamd>c.yamd']);
    s.delete('c.yamd');
    assert.deepEqual(ids(s).includes('c.yamd'), false);
    assert.deepEqual(edges(s), ['a.yamd>missing:gone']);
  });

  test('summaries built elsewhere can be added', () => {
    const s = new NoteStore();
    s.setSummarized('w.yamd', '# W\n\n[[x]]', summarize('w.yamd', '# W\n\n[[x]]'));
    s.set('x.yamd', '# X');
    assert.deepEqual(s.backlinks('x.yamd').map((b) => b.from), ['w.yamd']);
    assert.equal(s.summary('w.yamd')?.title, 'W');
  });
});

describe('unlinked mentions', () => {
  test('finds mentions regardless of case and skips notes without the name', () => {
    const s = new NoteStore();
    s.set('roadmap.yamd', '# Roadmap');
    s.set('a.yamd', 'The ROADMAP is late.');
    s.set('b.yamd', 'Nothing relevant here.');
    s.set('c.yamd', 'See [[roadmap]] only.');
    assert.deepEqual(s.unlinkedMentions('roadmap.yamd').map((m) => m.from), ['a.yamd']);
  });
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
    const { SlugRegistry } = await import('../src/core/slug');
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

  test('large notes do not keep their text, but can be read when needed', () => {
    const disk = new Map<string, string>();
    let reads = 0;
    const s = new NoteStore([''], () => false, { keepTextBelow: 1000, reader: (p) => (reads++, disk.get(p)) });
    disk.set('big.yamd', large(1));
    s.set('big.yamd', large(1));
    s.set('small.yamd', small(1));
    s.set('target.yamd', '# Target');
    assert.equal(reads, 0);
    assert.equal(s.read('small.yamd'), small(1));
    assert.equal(s.read('big.yamd'), large(1));
    assert.equal(reads, 1);
  });

  test('backlinks list large notes without reading them', () => {
    let reads = 0;
    const s = new NoteStore([''], () => false, { keepTextBelow: 1000, reader: () => (reads++, undefined) });
    s.set('big.yamd', large(1));
    s.set('target.yamd', '# Target');
    const links = s.backlinks('target.yamd');
    assert.deepEqual(links.map((b) => [b.from, b.text]), [['big.yamd', 'See [[target]] and Target here.']]);
    assert.equal(reads, 0);
  });

  test('an unchanged large note is recognized without its text', () => {
    const s = new NoteStore([''], () => false, { keepTextBelow: 1000 });
    const text = large(2);
    const first = s.set('big.yamd', text);
    assert.equal(s.set('big.yamd', text), first);
    assert.notEqual(s.set('big.yamd', text.replace('Big', 'Bag')), first);
    // Added by a worker with only a size and fingerprint.
    const summary = summarize('w.yamd', text);
    s.setSummarized('w.yamd', { size: text.length, hash: 'x' }, summary);
    assert.equal(s.summary('w.yamd'), summary);
    s.setSummarized('w.yamd', { size: text.length, hash: 'x' }, summarize('w.yamd', text));
    assert.equal(s.summary('w.yamd'), summary);
  });

  test('mentions in large notes are found through the reader', () => {
    const disk = new Map<string, string>([['big.yamd', large(1)]]);
    const s = new NoteStore([''], () => false, { keepTextBelow: 1000, reader: (p) => disk.get(p) });
    s.set('target.yamd', '# Target');
    s.set('big.yamd', large(1));
    assert.deepEqual(s.unlinkedMentions('target.yamd').map((m) => m.from), ['big.yamd']);
  });

  test('renaming works from summaries alone', async () => {
    const { renameEdits } = await import('../src/core/notes');
    const s = new NoteStore([''], () => false, { keepTextBelow: 10 });
    s.set('guide.yamd', '# Guide');
    s.set('a.yamd', 'See [guide](guide.yamd) and [[guide]] in a long enough note.');
    const edits = renameEdits(s, 'guide.yamd', 'docs/guide.yamd');
    assert.deepEqual([...edits.keys()], ['a.yamd']);
    assert.equal(edits.get('a.yamd')?.length, 1);
  });
});
