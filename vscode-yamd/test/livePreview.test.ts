import assert from 'node:assert/strict';
import { describe, test } from 'node:test';
import { applyReveal, computeDecorations } from '../src/core/livePreview';
import type { Deco } from '../src/core/livePreview';
import { parse } from '../src/core';

const decos = (src: string) => computeDecorations(parse(src));
const hidden = (src: string, ds: Deco[]) => ds.filter((d) => d.kind === 'hide').map((d) => src.slice((d as { start: number }).start, (d as { end: number }).end));
const styled = (src: string, ds: Deco[], style: string) => ds.filter((d) => d.kind === 'style' && d.style === style).map((d) => src.slice(d.start, (d as { end: number }).end));

describe('live preview decorations', () => {
  test('headings hide their marker and style the text', () => {
    const src = '## Title here\n';
    const ds = decos(src);
    assert.deepEqual(hidden(src, ds), ['## ']);
    assert.deepEqual(styled(src, ds, 'h2'), ['Title here']);
  });

  test('emphasis hides delimiters and styles the content', () => {
    const src = 'a **bold** and *it* and ~~gone~~ and ==hl==\n';
    const ds = decos(src);
    assert.deepEqual(hidden(src, ds), ['**', '**', '*', '*', '~~', '~~', '==', '==']);
    assert.deepEqual(styled(src, ds, 'bold'), ['bold']);
    assert.deepEqual(styled(src, ds, 'italic'), ['it']);
    assert.deepEqual(styled(src, ds, 'strike'), ['gone']);
    assert.deepEqual(styled(src, ds, 'highlight'), ['hl']);
  });

  test('links keep only their text; wikilinks keep the alias', () => {
    const src = 'see [site](http://x.y "t") and [[note|alias]]\n';
    const ds = decos(src);
    assert.deepEqual(styled(src, ds, 'link'), ['site', 'alias']);
    assert.deepEqual(hidden(src, ds), ['[', '](http://x.y "t")', '[[note|', ']]']);
  });

  test('inline code hides backticks', () => {
    const src = 'use `x + 1` here\n';
    const ds = decos(src);
    assert.deepEqual(hidden(src, ds), ['`', '`']);
    assert.deepEqual(styled(src, ds, 'code'), ['x + 1']);
  });

  test('bullets and tasks become glyphs', () => {
    const src = '- item\n- [ ] open\n- [x] done\n';
    const ds = decos(src);
    assert.deepEqual(ds.filter((d) => d.kind === 'glyph').map((d) => (d as { glyph: string }).glyph), ['•', '☐ ', '☑ ']);
    assert.deepEqual(hidden(src, ds), ['-', '- [ ] ', '- [x] ']);
    assert.deepEqual(styled(src, ds, 'taskDone'), ['done']);
  });

  test('blockquote markers hide and the lines are styled', () => {
    const src = '> one\n> two\n';
    const ds = decos(src);
    assert.deepEqual(hidden(src, ds), ['> ', '> ']);
    assert.equal(ds.filter((d) => d.kind === 'line' && d.line === 'quote').length, 2);
  });

  test('code blocks and containers style their lines without hiding anything', () => {
    const src = '```js\nlet a = 1;\n```\n\n:::note\nHi\n:::\n';
    const ds = decos(src);
    assert.equal(ds.filter((d) => d.kind === 'line' && d.line === 'codeLine').length, 3);
    assert.equal(ds.filter((d) => d.kind === 'line' && d.line === 'container').length, 3);
    assert.deepEqual(hidden(src, ds), []);
  });

  test('syntax inside code is left alone', () => {
    const src = '```\n**not bold**\n```\n';
    assert.deepEqual(hidden(src, decos(src)), []);
  });

  test('the cursor reveals the syntax it touches and nothing else', () => {
    const src = 'a **bold** and *it*\n\nsecond **line**\n';
    const ds = decos(src);
    const at = src.indexOf('bold') + 2;
    const shown = applyReveal(ds, [{ start: at, end: at }]);
    // The bold delimiters on this line are revealed; italics and the other line stay hidden.
    assert.deepEqual(hidden(src, shown), ['*', '*', '**', '**']);
  });

  test('a heading is revealed by the cursor anywhere on its line', () => {
    const src = '# Heading\n\ntext\n';
    const ds = applyReveal(decos(src), [{ start: 4, end: 4 }]);
    assert.deepEqual(hidden(src, ds), []);
  });

  test('a note with no markup produces no decorations', () => {
    assert.deepEqual(decos('just words\n'), []);
  });
});
