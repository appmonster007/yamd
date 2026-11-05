import assert from 'node:assert/strict';
import { describe, test } from 'node:test';
import {
  blockAttributesLine,
  codeBlockSnippet,
  crossRefLabel,
  crossRefOrCitation,
  embedLink,
  findCrossRefLabels,
  footnoteDefinition,
  footnoteMarker,
  frontMatterBlock,
  hasFrontMatter,
  headingAnchorSuffix,
  highlightWithComment,
  inlineFootnote,
  reviewCommentSnippet,
  tagSnippet,
  trackedDeletion,
  trackedInsertion,
  trackedSubstitution,
  variableSnippet,
  wikiLink,
  wikiLinkWithAlias,
  wrapInAttributes,
} from '../src/extension/insert';

describe('insert snippet builders', () => {
  test('wikiLink and embedLink', () => {
    assert.equal(wikiLink('Note'), '[[Note]]');
    assert.equal(embedLink('Note#Heading'), '![[Note#Heading]]');
  });

  test('footnoteMarker and footnoteDefinition', () => {
    assert.equal(footnoteMarker('1'), '[^1]');
    assert.equal(footnoteDefinition('1'), '\n\n[^1]: ');
  });

  test('tagSnippet and variableSnippet', () => {
    assert.equal(tagSnippet('project/web'), '#project/web');
    assert.equal(variableSnippet('vars.course'), '{{ vars.course }}');
  });

  test('wrapInAttributes', () => {
    assert.equal(wrapInAttributes('text', '#id .class'), 'text{#id .class}');
  });

  test('hasFrontMatter', () => {
    assert.equal(hasFrontMatter('---\ntitle: x\n---\n'), true);
    assert.equal(hasFrontMatter('# Title\n'), false);
  });

  test('frontMatterBlock', () => {
    assert.equal(frontMatterBlock({ title: 'Note', date: '2026-01-01' }), '---\ntitle: Note\ndate: 2026-01-01\n---\n\n');
  });

  test('wikiLinkWithAlias', () => {
    assert.equal(wikiLinkWithAlias('Note'), '[[Note]]');
    assert.equal(wikiLinkWithAlias('Note#Heading', 'See this'), '[[Note#Heading|See this]]');
  });

  test('codeBlockSnippet', () => {
    const plain = codeBlockSnippet('python');
    assert.equal(plain.text, '```python\n\n```');
    assert.equal(plain.cursorOffset, '```python\n'.length);
    const withAttrs = codeBlockSnippet('python', 'title="app.py" lines=10-20 highlight=12');
    assert.equal(withAttrs.text, '```python {title="app.py" lines=10-20 highlight=12}\n\n```');
  });

  test('headingAnchorSuffix', () => {
    assert.equal(headingAnchorSuffix('## Install Guide'), ' {#install-guide}');
    assert.equal(headingAnchorSuffix('## Install Guide {#install}'), undefined);
  });

  test('blockAttributesLine', () => {
    assert.equal(blockAttributesLine('.warning'), '{.warning}\n');
  });

  test('crossRefLabel and crossRefOrCitation', () => {
    assert.equal(crossRefLabel('fig', 'arch'), '{#fig:arch}');
    assert.equal(crossRefOrCitation('fig:arch'), '[@fig:arch]');
    assert.equal(crossRefOrCitation('smith2020'), '[@smith2020]');
  });

  test('findCrossRefLabels', () => {
    const text = 'See {#fig:arch} and {#tbl:pricing} and {#eq:energy} and {#sec:intro}.';
    assert.deepEqual(findCrossRefLabels(text), ['fig:arch', 'tbl:pricing', 'eq:energy', 'sec:intro']);
  });

  test('inlineFootnote', () => {
    assert.equal(inlineFootnote('a note'), '^[a note]');
  });

  test('review markup builders', () => {
    assert.equal(trackedInsertion('added'), '{++added++}');
    assert.equal(trackedDeletion('removed'), '{--removed--}');
    assert.equal(trackedSubstitution('old', 'new'), '{~~old~>new~~}');
    assert.equal(highlightWithComment('text', 'note'), '{==text==}{>>note<<}');
    assert.equal(reviewCommentSnippet('note'), '{>>note<<}');
  });
});
