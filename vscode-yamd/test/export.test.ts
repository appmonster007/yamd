import assert from 'node:assert/strict';
import { describe, test } from 'node:test';
import { parse, render } from '../src/core/markdown';
import { finalizeHtml, prepareExport, renderWidgets } from '../src/core/export/prepare';
import { buildNote } from '../src/core/build/build';
import { documentHtml, slidesHtml } from '../src/core/export/page';

const L = (s: string) => s.split('\n');
const note = `---\ntitle: Paper\n---\n# Paper\n\n> [!theorem] Pythagoras ^thm-pyth\n> a^2 + b^2 = c^2.\n\n> [!note] Heads up\n> Careful.\n\n> [!card] Q?\n> A.\n\n![Diagram](a.png)\n\n^fig-arch\n\nSee [@fig-arch] and [@thm-pyth].\n\n<!-- yamd:pagebreak -->\n\n<!-- yamd:attrs class=wide width=50% -->\n## Second\n\n\`\`\`kanban b\n## Todo\n- [ ] one\n\`\`\`\n\n\`\`\`sql\n-- id="q" source="x.csv"\nSELECT 1;\n\`\`\`\n\n<ins>added</ins> <mark>flag</mark>\n`;

function html(text: string, queries = new Map<number, string>()) {
  const built = buildNote(L(text)).lines;
  const p = prepareExport(built);
  const blocks = new Map([...renderWidgets(p.widgets), ...queries]);
  return { p, html: finalizeHtml(render(parse(p.source, 'gfm'), { softBreaks: 'newline' }), blocks) };
}

describe('export', () => {
  test('callouts become numbered study blocks and plain callouts', () => {
    const { html: h } = html(note);
    assert.match(h, /Theorem 1/);
    assert.match(h, /Pythagoras/);
    assert.match(h, /Heads up/);
  });

  test('targets become anchors and references link to them', () => {
    const { html: h } = html(note);
    assert.match(h, /<a id="fig-arch"><\/a>/);
    assert.match(h, /<a href="#fig-arch"[^>]*>Figure 1<\/a>/);
  });

  test('widgets render as static boards and query blocks as their result', () => {
    const { p } = html(note);
    const queries = new Map<number, string>([[p.queryBlocks[0] as number, '<table id="result"></table>']]);
    const h = html(note, queries).html;
    assert.match(h, /class="kanban/);
    assert.match(h, /<table id="result"><\/table>/);
    assert.doesNotMatch(h, /YAMDQUERY/);
  });

  test('page breaks, attribute comments, critic HTML', () => {
    const { html: h } = html(note);
    assert.match(h, /pagebreak/);
    assert.match(h, /<h2[^>]*class="wide"[^>]*width="50%"[^>]*>Second<\/h2>/);
    assert.match(h, /<ins>added<\/ins>/);
    assert.match(h, /<mark>flag<\/mark>/);
  });

  test('a card exports with its question and answer', () => {
    const { html: h } = html(note);
    assert.match(h, /Q\?/);
    assert.match(h, /card-back|A\./);
  });

  test('document and slides wrappers accept the prepared source', () => {
    const p = prepareExport(buildNote(L(note)).lines);
    const doc = parse(p.source, 'gfm');
    const page = documentHtml(doc, { css: '', render: {}, titlePage: true, toc: true });
    assert.match(page, /<title>Paper<\/title>/);
    const deck = slidesHtml(doc, { css: '', render: {} });
    assert.match(deck, /class="slide/);
  });

  test('code fences are untouched', () => {
    const p = prepareExport(L('```md\n> [!note] x\n^fig-a\n```\n'));
    assert.match(p.source, /> \[!note\] x\n\^fig-a/);
  });
});

describe('export dialect', () => {
  const prose = 'First line\nsecond line.\n\nA #tag, ==marked==, ++under++, x^2 and H_{2}O, {{ name }} and ^[note].\n\n:::note\ntyped by hand\n:::\n\n[[guide]] and [[guide#Install|setup]].\n';

  test('prose is plain Markdown: a newline is a space and YAMD-only syntax stays text', () => {
    const { html: h } = html(prose);
    assert.match(h, /First line\nsecond line\./);
    assert.doesNotMatch(h, /<br/);
    assert.match(h, /A #tag, ==marked==, \+\+under\+\+, x\^2 and H_\{2\}O, \{\{ name \}\} and \^\[note\]\./);
    assert.doesNotMatch(h, /class="tag"|<sup>|<sub>|<mark>|<u>/);
  });

  test('a directive typed by hand is text, not a container', () => {
    const { html: h } = html(prose);
    assert.match(h, /:::note/);
    assert.doesNotMatch(h, /callout-note/);
  });

  test('wikilinks link to the note file next to the export', () => {
    const { html: h } = html(prose);
    assert.match(h, /<a href="guide\.md" class="wikilink">guide<\/a>/);
    assert.match(h, /<a href="guide\.md#install" class="wikilink">setup<\/a>/);
  });

  test('widgets keep the full syntax: tags and attributes work inside them', () => {
    const { html: h } = html('```kanban b\n## Todo\n- [ ] Fix it #bug {due=2026-12-01 owner=ada}\n```\n');
    assert.match(h, /class="kanban/);
    assert.match(h, /bug/);
    assert.match(h, /2026-12-01/);
  });

  test('the full dialect is still available for widget bodies', () => {
    assert.match(render(parse('A #tag and ==mark==')), /tag/);
    assert.doesNotMatch(render(parse('A #tag and ==mark==', 'gfm')), /class="tag"|<mark/);
  });
});
