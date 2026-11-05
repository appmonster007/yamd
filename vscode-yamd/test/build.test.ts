import assert from 'node:assert/strict';
import { describe, test } from 'node:test';
import { buildNote, bibSettings } from '../src/core/build/build';
import { diffLines } from '../src/core/build/diff';
import { calloutProblems, scanCallouts } from '../src/core/callouts';
import { collectTargets, refAt, resolveReferences } from '../src/core/refs';
import { headings, tocLines } from '../src/core/build/toc';
import { parseBibtex } from '../src/core/study/bibtex';

const L = (s: string) => s.split('\n');

const BIB = `@article{smith2020, author={Smith, Jane and Lee, Wei}, title={On Widgets}, journal={Journal of Things}, year={2020}, volume={3}, number={2}, pages={1--9}}
@book{doe2018, author={Doe, John}, title={A Book}, publisher={Press}, year={2018}}`;

describe('callouts', () => {
  const note = '> [!theorem] Pythagoras ^thm-pyth\n> For a right triangle, $a^2 + b^2 = c^2$.\n>\n> More.\n\n> [!theorem] Second\n> text\n\n> [!note] Plain\n> hello\n\n```md\n> [!theorem] inside code\n```\n';

  test('finds callouts, ids and per-type numbers; a blank line ends one', () => {
    const c = scanCallouts(L(note));
    assert.deepEqual(c.map((x) => [x.type, x.title, x.id, x.number, x.startLine, x.endLine]), [
      ['theorem', 'Pythagoras', 'thm-pyth', 1, 0, 3],
      ['theorem', 'Second', undefined, 2, 5, 6],
      ['note', 'Plain', undefined, undefined, 8, 9],
    ]);
  });

  test('flags unknown types and a missing blank line', () => {
    assert.deepEqual(calloutProblems(L('> [!banana] x\n> y\n\nok')).map((p) => p.code), ['C001']);
    assert.deepEqual(calloutProblems(L('> [!note] x\n> y\nlazy line')).map((p) => p.code), ['C002']);
    assert.deepEqual(calloutProblems(L('> [!note] x\n> y\n')), []);
  });
});

describe('references', () => {
  const note = '![Diagram](a.png)\n\n^fig-arch\n\nTable: Results\n\n| a |\n|---|\n| 1 |\n\n^tbl-results\n\n![Two](b.png)\n\n^fig-two\n\n> [!theorem] T ^thm-a\n> x\n\nSee [@fig-two], [@tbl-results] and [@thm-a]; also [@smith2020].\n';

  test('numbers targets per kind in document order', () => {
    assert.deepEqual(collectTargets(L(note)).map((t) => t.label), ['Figure 1', 'Table 1', 'Figure 2', 'Theorem 1']);
  });

  test('turns [@id] into links, leaves citations, and refreshes labels', () => {
    const out = resolveReferences(L(note), collectTargets(L(note))).join('\n');
    assert.match(out, /See \[Figure 2\]\(#fig-two\), \[Table 1\]\(#tbl-results\) and \[Theorem 1\]\(#thm-a\); also \[@smith2020\]\./);
    const stale = resolveReferences(L(out.replace('![Diagram](a.png)\n\n^fig-arch\n\n', '')), collectTargets(L(out.replace('![Diagram](a.png)\n\n^fig-arch\n\n', ''))));
    assert.match(stale.join('\n'), /\[Figure 1\]\(#fig-two\)/);
  });

  test('code is left alone', () => {
    const src = '![x](a.png)\n\n^fig-a\n\n`[@fig-a]`\n\n```\n[@fig-a]\n```\n';
    const out = resolveReferences(L(src), collectTargets(L(src))).join('\n');
    assert.match(out, /`\[@fig-a\]`/);
    assert.match(out, /```\n\[@fig-a\]\n```/);
  });

  test('refAt finds what is under the cursor', () => {
    assert.deepEqual(refAt('see [Figure 2](#fig-two) now', 10), { kind: 'xref', id: 'fig-two' });
    assert.deepEqual(refAt('see [@smith2020; @doe2018, p. 4]', 8), { kind: 'cite', keys: ['smith2020', 'doe2018'] });
    assert.deepEqual(refAt('![alt](img/a.png "t")', 3), { kind: 'image', src: 'img/a.png' });
    assert.equal(refAt('plain text', 3), undefined);
  });
});

describe('toc', () => {
  test('lists headings with anchors, skipping code and front matter, with depth', () => {
    const src = '---\ntitle: x\n---\n# Title\n\n## Intro\n\n### Deep\n\n```\n# not a heading\n```\n\n## Intro\n';
    assert.deepEqual(headings(L(src)).map((h) => h.slug), ['title', 'intro', 'deep', 'intro-1']);
    assert.deepEqual(tocLines(L(src), 'depth=2'), ['- [Title](#title)', '  - [Intro](#intro)', '  - [Intro](#intro-1)']);
  });
});

describe('build', () => {
  const note = `---\nbibliography: refs.bib\ncitation-style: apa\n---\n# Paper\n\n<!-- yamd:toc depth=2 -->\n<!-- /yamd:toc -->\n\n## Intro\n\nSee [@smith2020] and [@doe2018, p. 4], and [@ghost].\n\n![Diagram](a.png)\n\n^fig-arch\n\nAs in [@fig-arch].\n\n## References\n\n<!-- yamd:bibliography -->\n<!-- /yamd:bibliography -->\n`;
  const entries = parseBibtex(BIB);

  test('builds the TOC, reference labels and bibliography', () => {
    const r = buildNote(L(note), { entries });
    const out = r.lines.join('\n');
    assert.match(out, /- \[Paper\]\(#paper\)/);
    assert.match(out, /As in \[Figure 1\]\(#fig-arch\)\./);
    assert.match(out, /<a id="ref-doe2018"><\/a>Doe, J\. \(2018\)/);
    assert.match(out, /<a id="ref-smith2020"><\/a>Smith, J\., &amp; Lee, W\. \(2020\)/);
    assert.deepEqual(r.warnings, ['Citation key "ghost" is not in the bibliography file.']);
  });

  test('a second build changes nothing', () => {
    const once = buildNote(L(note), { entries }).lines;
    const twice = buildNote(once, { entries }).lines;
    assert.deepEqual(twice, once);
    assert.equal(diffLines(once, twice), null);
  });

  test('IEEE numbers the list in citation order', () => {
    const ieee = note.replace('citation-style: apa', 'citation-style: ieee');
    const out = buildNote(L(ieee), { entries }).lines.join('\n');
    assert.match(out, /1\. <a id="ref-smith2020">/);
    assert.match(out, /2\. <a id="ref-doe2018">/);
  });

  test('chicago and harvard produce their own formats', () => {
    const chicago = buildNote(L(note.replace('citation-style: apa', 'citation-style: chicago')), { entries }).lines.join('\n');
    assert.match(chicago, /Doe, John\. 2018\./);
    const harvard = buildNote(L(note.replace('citation-style: apa', 'citation-style: harvard')), { entries }).lines.join('\n');
    assert.match(harvard, /Doe, J\. \(2018\)/);
  });

  test('warns when the bibliography file cannot be read', () => {
    assert.match(buildNote(L(note)).warnings[0] ?? '', /no readable "bibliography:"/);
    assert.deepEqual(bibSettings(L(note)), { file: 'refs.bib', style: 'apa' });
  });

  test('diffLines finds the changed span', () => {
    assert.deepEqual(diffLines(['a', 'b', 'c'], ['a', 'x', 'y', 'c']), { start: 1, removeCount: 1, lines: ['x', 'y'] });
    assert.equal(diffLines(['a'], ['a']), null);
  });
});
