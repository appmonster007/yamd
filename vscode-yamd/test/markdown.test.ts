import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { parse } from '../src/core';
import { documentMarkdown } from '../src/core/study/markdown';

describe('documentMarkdown', () => {
  it('renders front matter, a heading, a paragraph and a link', () => {
    const doc = parse('---\ntitle: Note\n---\n\n# Title\n\nSee [the site](https://example.com).\n');
    const out = documentMarkdown(doc);
    assert.ok(out.startsWith('---\ntitle: Note\n---\n\n'));
    assert.ok(out.includes('# Title'));
    assert.ok(out.includes('See the site.'));
  });

  it('renders a list with a task item', () => {
    const doc = parse('- a\n- [x] b\n');
    const out = documentMarkdown(doc);
    assert.ok(out.includes('- a'));
    assert.ok(out.includes('[x] b'));
  });

  it('round-trips a container directive as a fence', () => {
    const doc = parse(':::note\nBody\n:::\n');
    const out = documentMarkdown(doc);
    assert.ok(out.includes(':::note'));
    assert.ok(out.includes('Body'));
    assert.ok(out.trimEnd().endsWith(':::'));
  });
});
