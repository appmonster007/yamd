import assert from 'node:assert/strict';
import { describe, test } from 'node:test';
import { parse, render } from '../src/core/markdown';
import { finalizeHtml, prepareExport } from '../src/core/export/prepare';
import { buildNote } from '../src/core/build/build';
import { documentHtml, slidesHtml } from '../src/core/export/page';

const L = (s: string) => s.split('\n');
const note = `---\ntitle: Paper\n---\n# Paper\n\n> [!theorem] Pythagoras ^thm-pyth\n> a^2 + b^2 = c^2.\n\n> [!note] Heads up\n> Careful.\n\n> [!card] Q?\n> A.\n\n![Diagram](a.png)\n\n^fig-arch\n\nSee [@fig-arch] and [@thm-pyth].\n\n<!-- yamd:pagebreak -->\n\n<!-- yamd:attrs class=wide width=50% -->\n## Second\n\n\`\`\`kanban b\n## Todo\n- [ ] one\n\`\`\`\n\n\`\`\`sql\n-- id="q" source="x.csv"\nSELECT 1;\n\`\`\`\n\n<ins>added</ins> <mark>flag</mark>\n`;

function html(text: string, queries = new Map<number, string>()) {
  const built = buildNote(L(text)).lines;
  const p = prepareExport(built);
  return { p, html: finalizeHtml(render(parse(p.source)), queries) };
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
    const queries = new Map<number, string>();
    const { p } = html(note);
    queries.set(p.queryBlocks[0] as number, '<table id="result"></table>');
    const h = finalizeHtml(render(parse(p.source)), queries);
    assert.match(h, /class="kanban/);
    assert.match(h, /<table id="result"><\/table>/);
    assert.doesNotMatch(h, /YAMDQUERY/);
  });

  test('page breaks, attribute comments, critic HTML', () => {
    const { html: h } = html(note);
    assert.match(h, /pagebreak/);
    assert.match(h, /class="[^"]*wide/);
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
    const doc = parse(p.source);
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
