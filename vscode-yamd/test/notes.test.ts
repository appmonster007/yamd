import assert from 'node:assert/strict';
import { describe, test } from 'node:test';
import { parse, render } from '../src/core';
import { NoteStore, renameEdits, resolveNote, selectEmbed, summarize } from '../src/core/notes';
import { expandPlaceholders, formatDate, newNoteText, parseDate } from '../src/core/templates';
import type { RenderOptions } from '../src/core';

function store(files: Record<string, string>, others: string[] = []) {
  const s = new NoteStore([''], (p) => others.includes(p));
  for (const [path, text] of Object.entries(files)) s.set(path, text);
  return s;
}

const html = (src: string) => render(parse(src));

describe('tags', () => {
  test('tags in text', () => {
    const out = html('Planning #project/web and issue #42');
    assert.match(out, /<span class="tag" data-tag="project\/web">#project\/web<\/span>/);
    assert.match(out, /issue #42/);
  });

  test('tag at the start of a line', () => {
    assert.match(html('#urgent fix the build'), /^<p data-line="0"><span class="tag" data-tag="urgent">#urgent<\/span> fix the build<\/p>$/);
  });

  test('no tags in URLs, code or words', () => {
    const out = html('See https://x.dev/#intro and `#notatag` and C# and x/#y');
    assert.doesNotMatch(out, /class="tag"/);
  });

  test('tags from front matter and text are indexed', () => {
    const s = summarize('a.yamd', '---\ntags: [planning]\n---\nText #project/web');
    assert.deepEqual(s.tags.sort(), ['planning', 'project/web']);
  });
});

describe('block IDs', () => {
  test('are removed from the text and become the id', () => {
    assert.equal(html('Price is $10. ^pricing'), '<p id="^pricing" data-line="0">Price is $10.</p>');
  });

  test('on list items', () => {
    const doc = parse('- one ^first\n- two');
    assert.match(render(doc), /<li id="\^first"/);
    assert.deepEqual(summarize('a.yamd', '- one ^first\n- two').blocks, [{ id: 'first', line: 0 }]);
  });

});

describe('resolution', () => {
  const s = store({
    'projects/2026/roadmap.yamd': '# Roadmap',
    'q3.yamd': '---\naliases: [Q3 Plan]\n---\n# Q3',
    'a/notes.yamd': '',
    'b/notes.yamd': '',
    'dir/near.yamd': '',
    'dir/from.yamd': '',
  });

  test('by file name anywhere', () => {
    assert.equal(resolveNote(s, 'roadmap', 'index.yamd')?.path, 'projects/2026/roadmap.yamd');
    assert.equal(resolveNote(s, 'ROADMAP', 'index.yamd')?.path, 'projects/2026/roadmap.yamd');
  });

  test('by alias, ignoring case', () => {
    assert.equal(resolveNote(s, 'q3 plan', 'x.yamd')?.path, 'q3.yamd');
  });

  test('ambiguous names pick the shortest path and list candidates', () => {
    const r = resolveNote(s, 'notes', 'index.yamd');
    assert.equal(r?.path, 'a/notes.yamd');
    assert.deepEqual(r?.candidates, ['a/notes.yamd', 'b/notes.yamd']);
  });

  test('relative paths first, then the root', () => {
    assert.equal(resolveNote(s, 'near', 'dir/from.yamd')?.path, 'dir/near.yamd');
    assert.equal(resolveNote(s, 'projects/2026/roadmap', 'dir/from.yamd')?.path, 'projects/2026/roadmap.yamd');
    assert.equal(resolveNote(s, 'missing', 'dir/from.yamd'), null);
  });

  test('.ymd is accepted as an alias for .yamd', () => {
    const t = store({ 'short.ymd': '# Short', 'long.yamd': '# Long' });
    assert.equal(resolveNote(t, 'short', 'index.yamd')?.path, 'short.ymd');
    assert.equal(resolveNote(t, 'long', 'index.yamd')?.path, 'long.yamd');
    assert.equal(resolveNote(t, 'short.ymd', 'index.yamd')?.path, 'short.ymd');
  });
});

describe('embeds', () => {
  const GUIDE = '# Guide\n\n## Install\n\nRun it. ^run\n\n### Details\n\nMore.\n\n## Use\n\nLater.';
  const options = (): RenderOptions => ({});

  test('select a section up to the next heading of the same level', () => {
    const blocks = selectEmbed(parse(GUIDE), 'Install');
    assert.deepEqual(blocks?.map((b) => b.type), ['heading', 'paragraph', 'heading', 'paragraph']);
  });

  test('select a block', () => {
    assert.equal(selectEmbed(parse(GUIDE), undefined, 'run')?.[0]?.type, 'paragraph');
    assert.equal(selectEmbed(parse(GUIDE), undefined, 'nope'), null);
  });






  test('image embeds', () => {
    assert.match(html('![[diagram.png]]{width=300}'), /<img src="diagram.png" alt="diagram.png" width="300"/);
  });
});


describe('note store', () => {
  test('titles', () => {
    assert.equal(summarize('r.yamd', '---\ntitle: Roadmap\n---\n# Other').title, 'Roadmap');
    assert.equal(summarize('r.yamd', '# Q3 Plan').title, 'Q3 Plan');
    assert.equal(summarize('dir/plain.yamd', 'text').title, 'plain');
  });

  test('backlinks include links and embeds', () => {
    const s = store({ 'roadmap.yamd': '# Roadmap', 'a.yamd': 'See [[roadmap]]\n\n![[roadmap]]', 'b.yamd': '[r](roadmap.yamd)' });
    const links = s.backlinks('roadmap.yamd').map((b) => `${b.from}:${b.link.kind}:${b.text}`);
    assert.deepEqual(links, ['a.yamd:wiki:See [[roadmap]]', 'a.yamd:embed:![[roadmap]]', 'b.yamd:markdown:[r](roadmap.yamd)']);
  });

  test('nested tags', () => {
    const s = store({ 'w.yamd': '#project/web', 'm.yamd': '#project/mobile', 'o.yamd': '#other' });
    assert.deepEqual(s.notesWithTag('project'), ['m.yamd', 'w.yamd']);
  });

  test('local graph depth and missing notes', () => {
    const s = store({ 'a.yamd': '[[b]] [[ideas]]', 'b.yamd': '[[c]]', 'c.yamd': '' });
    const local = s.localGraph('a.yamd', 1);
    assert.deepEqual(local.nodes.map((n) => n.id).sort(), ['a.yamd', 'b.yamd', 'missing:ideas']);
    assert.equal(local.nodes.find((n) => n.id === 'missing:ideas')?.missing, true);
    assert.equal(s.localGraph('a.yamd', 2).nodes.length, 4);
  });

  test('unlinked mentions skip links, code and front matter', () => {
    const s = store({
      'roadmap.yamd': '# Roadmap',
      'b.yamd': '---\ntitle: Roadmap notes\n---\nThe Roadmap is late.\n\n[[roadmap]] and `Roadmap`\n\n```\nRoadmap\n```',
    });
    const m = s.unlinkedMentions('roadmap.yamd');
    assert.equal(m.length, 1);
    assert.equal(m[0]?.line, 3);
  });

  test('deleting a note removes it', () => {
    const s = store({ 'a.yamd': '[[b]]', 'b.yamd': '' });
    s.delete('a.yamd');
    assert.deepEqual(s.backlinks('b.yamd'), []);
    assert.equal(s.graph().nodes.length, 1);
  });
});

describe('rename', () => {
  test('path-based links are rewritten', () => {
    const s = store({ 'guide.yamd': '# G', 'a.yamd': '[guide](guide.yamd#install)' });
    const edits = renameEdits(s, 'guide.yamd', 'docs/guide.yamd');
    const e = edits.get('a.yamd')?.[0];
    assert.ok(e);
    const text = s.read('a.yamd') ?? '';
    assert.equal(text.slice(0, e.range.start) + e.text + text.slice(e.range.end), '[guide](docs/guide.yamd#install)');
  });

  test('name-based links that still resolve stay', () => {
    const s = store({ 'guide.yamd': '# G', 'a.yamd': '[[guide]] and ![[guide#G]]' });
    assert.equal(renameEdits(s, 'guide.yamd', 'docs/guide.yamd').size, 0);
  });

  test('name-based links follow a renamed file name', () => {
    const s = store({ 'guide.yamd': '# G', 'a.yamd': 'See [[guide|the guide]]' });
    const e = renameEdits(s, 'guide.yamd', 'manual.yamd').get('a.yamd')?.[0];
    assert.ok(e);
    const text = s.read('a.yamd') ?? '';
    assert.equal(text.slice(0, e.range.start) + e.text + text.slice(e.range.end), 'See [[manual|the guide]]');
  });
});

describe('templates', () => {
  const now = new Date(2026, 9, 16, 9, 5);

  test('date tokens', () => {
    assert.equal(formatDate(now, 'YYYY-MM-DD HH:mm'), '2026-10-16 09:05');
    assert.equal(parseDate('2026-10-13', 'YYYY-MM-DD')?.getDate(), 13);
    assert.equal(parseDate('notes', 'YYYY-MM-DD'), null);
  });

  test('custom variables fill their placeholders', () => {
    const r = expandPlaceholders('{{@course}} / {{@title}} / {{@missing}}', { now, title: 'T', vars: { course: 'CS101' } });
    assert.equal(r.text, 'CS101 / T / {{@missing}}');
  });

  test('placeholders and cursor', () => {
    const r = expandPlaceholders('# {{@title}}\nDate: {{@date:DD/MM/YYYY}} {{@time}}\n{{@cursor}}\n{{@other}}', { now, title: 'standup' });
    assert.equal(r.text, '# standup\nDate: 16/10/2026 09:05\n\n{{@other}}');
    assert.equal(r.cursor, '# standup\nDate: 16/10/2026 09:05\n'.length);
  });
});

describe('new notes', () => {
  const now = new Date(2026, 9, 17, 14, 30);

  test('front matter with the title, date and language', () => {
    const text = newNoteText('Meeting notes', now, 'en');
    assert.equal(text, '---\ntitle: Meeting notes\ndate: 2026-10-17\nlang: en\n---\n\n# {{ title }}\n\n');
    assert.match(render(parse(text)), /<h1 id="meeting-notes"[^>]*>Meeting notes<\/h1>/);
  });

  test('titles that YAML would misread are quoted', () => {
    for (const title of ['2026-10-17 14:30', 'yes', 'Q3: plan', '#ideas']) {
      const doc = parse(newNoteText(title, now, 'en'));
      assert.equal(doc.frontMatter?.data['title'], title, title);
    }
  });
});

describe('properties', () => {


});
