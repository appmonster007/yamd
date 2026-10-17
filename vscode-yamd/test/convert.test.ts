import assert from 'node:assert/strict';
import { describe, test } from 'node:test';
import { parse, render } from '../src/core';
import { convertFromMarkdown, joinParagraphLines } from '../src/core/convert';

const html = (src: string) => render(parse(src));

describe('convertFromMarkdown', () => {
  test('escapes accidental YAMD syntax', () => {
    const { text } = convertFromMarkdown('a ==b== and {{ x }} and x^2 and [[not a link]] and #tag and ++c++');
    assert.equal(text, 'a \\==b== and \\{{ x }} and x\\^2 and \\[[not a link]] and \\#tag and \\++c++');
    assert.equal(html(text), '<p data-line="0">a ==b== and {{ x }} and x^2 and [[not a link]] and #tag and ++c++</p>');
  });

  test('leaves text YAMD already reads as text', () => {
    const src = 'a == b, {{ not a var }}, 100%% sure, C++ and $5 or $10';
    assert.equal(convertFromMarkdown(src).text, src);
  });

  test('escapes block syntax', () => {
    const { text } = convertFromMarkdown('%%\nshown on GitHub\n%%\n\n:::note\nhi\n:::\n\n## Title {#id}');
    assert.doesNotMatch(html(text), /callout|<h2 id="id"/);
    assert.match(html(text), /shown on GitHub/);
  });

  test('joins wrapped paragraph lines but keeps hard breaks', () => {
    const { text, joined } = convertFromMarkdown('one\ntwo\n> three\n> four\n\nfive  \nsix');
    assert.equal(text, 'one two\n> three four\n\nfive  \nsix');
    assert.equal(joined, 2);
  });

  test('leaves code and front matter alone', () => {
    const src = '---\ntitle: x\n---\n```\n{{ a }}\nb\n```';
    assert.equal(convertFromMarkdown(src).text, src);
  });

  test('is idempotent', () => {
    const once = convertFromMarkdown('a {{b}}\nc ==d==\n\n- e\n  f').text;
    assert.equal(convertFromMarkdown(once).text, once);
  });
});

test('joinParagraphLines', () => {
  assert.equal(joinParagraphLines(['one  ', '  two', 'three']), 'one two three');
  assert.equal(joinParagraphLines(['> one', '> two']), '> one two');
});
