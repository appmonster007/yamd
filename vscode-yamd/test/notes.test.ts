import assert from 'node:assert/strict';
import { describe, test } from 'node:test';
import { parse, render } from '../src/core';
import { resolveNote, selectEmbed, summarize } from '../src/core/notes';
import { expandPlaceholders, formatDate } from '../src/core/templates';
import type { RenderOptions } from '../src/core';

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


describe('rename', () => {


});

describe('templates', () => {
  const now = new Date(2026, 9, 16, 9, 5);


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


});

describe('properties', () => {


});
