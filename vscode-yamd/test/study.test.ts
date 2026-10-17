import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { parse, render } from '../src/core';
import { derivationTex } from '../src/core/render';
import { buildQueue, extractCards, parseSchedule, review, stringifySchedule } from '../src/core/study/cards';
import { buildCheatSheet, collectStudyBlocks } from '../src/core/study/blocks';
import { collectDeadlines, courseProgress, groupDeadlines, staleTopics } from '../src/core/study/deadlines';
import { heatmap, parseLog, streak } from '../src/core/study/studylog';
import { Bibliography, entryFromCrossref, parseBibtex, parseCitation, parseDoi } from '../src/core/study/bibtex';

describe('flashcards', () => {
  const src = [
    '---', 'course: CS101', '---', '',
    ':::card', 'What is a **stack**?', '', '---', '', 'A LIFO structure.', ':::', '',
    '::card[Capital of France?]{a="Paris"}', '',
    'The :cloze[mitochondria] is the :cloze[powerhouse] of the cell.', '',
    ':::card', 'No answer here', ':::', '',
  ].join('\n');
  const doc = parse(src);
  const { cards, diagnostics } = extractCards(doc, 'a.yamd');

  it('extracts block, line and cloze cards', () => {
    assert.equal(cards.length, 4);
    assert.equal(cards[0]?.front, 'What is a **stack**?');
    assert.equal(cards[0]?.back, 'A LIFO structure.');
    assert.equal(cards[1]?.back, 'Paris');
    assert.equal(cards[2]?.front, 'The **[…]** is the powerhouse of the cell.');
    assert.equal(cards[3]?.back, 'The mitochondria is the **powerhouse** of the cell.');
    assert.equal(cards[0]?.course, 'CS101');
  });
  it('reports cards without an answer', () => {
    assert.deepEqual(diagnostics.map((d) => d.code), ['Y605']);
  });
  it('schedules with SM-2', () => {
    const a = review(undefined, 'good', '2026-01-01');
    assert.equal(a.due, '2026-01-02');
    const b = review(a, 'good', '2026-01-02');
    assert.equal(b.interval, 6);
    const c = review(b, 'good', '2026-01-08');
    assert.ok(c.interval > 6);
    const d = review(c, 'again', '2026-02-01');
    assert.equal(d.due, '2026-02-01');
    assert.equal(d.lapses, 1);
  });
  it('builds a queue', () => {
    const schedule = parseSchedule(stringifySchedule({ version: 1, cards: { [cards[0]!.id]: review(undefined, 'good', '2026-01-01') } }));
    const q = buildQueue(cards, schedule, '2026-01-05');
    assert.equal(q.due.length, 1);
    assert.equal(q.fresh.length, 3);
    assert.equal(buildQueue(cards, schedule, '2026-01-01').later, 1);
  });
  it('renders a card with the answer hidden', () => {
    const html = render(doc);
    assert.match(html, /class="card-answer"/);
    assert.match(html, /<span class="cloze">mitochondria<\/span>/);
    assert.match(render(doc, { quiz: true }), /cloze-hidden/);
  });
});

describe('study blocks', () => {
  const doc = parse(':::definition {#def:x title="Group"}\nA set with an operation.\n:::\n\n:::theorem\nT.\n:::\n\nSee [@def:x].\n\n:::proof\nTrivial.\n:::\n');
  it('numbers and cross-references', () => {
    const html = render(doc);
    assert.match(html, /Definition 1/);
    assert.match(html, /\(Group\)/);
    assert.match(html, /Theorem 1/);
    assert.match(html, /href="#def:x">Definition 1</);
    assert.match(html, /proof-end/);
  });
  it('builds a cheat sheet', () => {
    const blocks = collectStudyBlocks(doc, 'n/a.yamd');
    assert.equal(blocks.length, 3);
    const sheet = buildCheatSheet(blocks, { date: '2026-01-01', link: (p) => p });
    assert.match(sheet, /## Definitions/);
    assert.match(sheet, /:::definition \{title="Group"\}/);
    assert.doesNotMatch(sheet, /Trivial/);
    assert.equal(parse(sheet).diagnostics.filter((d) => d.code === 'Y601').length, 0);
  });
  it('lays out a derivation', () => {
    const tex = derivationTex('(a+b)^2 = a^2 + 2ab + b^2 // expand\n= a^2 + b^2 + 2ab // reorder');
    assert.match(tex, /\\begin\{aligned\}/);
    assert.match(tex, /\(a\+b\)\^2 &= a\^2/);
    assert.match(tex, /\{\}&= a\^2 \+ b\^2/);
    assert.match(tex, /&& \\text\{expand\}/);
  });
});

describe('deadlines and progress', () => {
  const doc = parse('---\ncourse: Math\ndue: 2026-03-10\n---\n\n- [ ] Read ch 3 {due=2026-03-01}\n- [x] Quiz {due=2026-02-20}\n- [ ] Later {due=2026-04-01}\n- [ ] Undated\n');
  const items = collectDeadlines(doc, 'm.yamd', 'Math');
  it('collects note and task deadlines', () => {
    assert.equal(items.length, 4);
    assert.equal(items[0]?.course, 'Math');
    assert.equal(items.find((d) => d.title === 'Read ch 3')?.line, 5);
  });
  it('groups by urgency', () => {
    const g = groupDeadlines(items, '2026-03-05');
    assert.deepEqual(g.overdue.map((d) => d.title), ['Read ch 3']);
    assert.deepEqual(g.week.map((d) => d.title), ['Math']);
    assert.deepEqual(g.done.map((d) => d.title), ['Quiz']);
    assert.deepEqual(g.later.map((d) => d.title), ['Later']);
  });
  it('summarises courses and stale topics', () => {
    const notes = [
      { path: 'a', title: 'A', course: 'X', tasksDone: 1, tasksTotal: 2, lastTouched: '2026-01-01' },
      { path: 'b', title: 'B', course: 'X', tasksDone: 2, tasksTotal: 2, lastTouched: '2026-03-04' },
      { path: 'c', title: 'C', tasksDone: 0, tasksTotal: 1 },
    ];
    const p = courseProgress(notes);
    assert.deepEqual(p.map((c) => [c.course, c.tasksDone, c.tasksTotal]), [['X', 3, 4], ['(no course)', 0, 1]]);
    assert.deepEqual(staleTopics(notes, '2026-03-05').map((n) => n.title), ['A']);
  });
});

describe('study log', () => {
  const log = parseLog(JSON.stringify({ sessions: [{ date: '2026-03-03', minutes: 25 }, { date: '2026-03-04', minutes: 50, course: 'X' }, { date: '2026-03-05', minutes: 10 }, { date: '2026-02-01', minutes: 5 }] }));
  it('counts streaks', () => {
    assert.equal(streak(log, '2026-03-05'), 3);
    assert.equal(streak(log, '2026-03-06'), 3);
    assert.equal(streak(log, '2026-03-08'), 0);
  });
  it('builds a heatmap', () => {
    const weeks = heatmap(log, '2026-03-05', 4);
    assert.equal(weeks.length, 4);
    assert.equal(weeks[3]?.[3]?.date, '2026-03-05');
    assert.equal(weeks[3]?.[2]?.level, 2);
  });
});

describe('citations', () => {
  const bib = parseBibtex(`@article{lamport1978,\n author = {Leslie Lamport},\n title = {Time, Clocks},\n journal = {CACM},\n volume = {21},\n pages = {558--565},\n year = {1978}\n}\n@book{k, author={Knuth, Donald and Other, Ann}, title={TAOCP}, publisher={AW}, year=1968}`);
  it('parses BibTeX', () => {
    assert.equal(bib.length, 2);
    assert.equal(bib[0]?.fields['pages'], '558–565');
    assert.equal(bib[1]?.fields['year'], '1968');
  });
  it('parses citations with locators', () => {
    assert.deepEqual(parseCitation('@a; @b, p. 4'), [{ key: 'a' }, { key: 'b', locator: 'p. 4' }]);
  });
  it('formats in three styles', () => {
    const cite = [{ key: 'lamport1978', locator: 'p. 5' }];
    assert.equal(new Bibliography(bib, 'apa').cite(cite), '(Lamport, 1978, p. 5)');
    assert.equal(new Bibliography(bib, 'mla').cite(cite), '(Lamport 5)');
    assert.equal(new Bibliography(bib, 'ieee').cite(cite), '[1, p. 5]');
    const apa = new Bibliography(bib, 'apa');
    apa.cite([{ key: 'k' }, { key: 'lamport1978' }]);
    assert.match(apa.references(), /Knuth, D\., &amp; Other, A\./);
  });
  it('renders citations and the reference list', () => {
    const doc = parse('As shown [@lamport1978].\n\n::bibliography\n');
    const html = render(doc, { bibliography: new Bibliography(bib, 'apa') });
    assert.match(html, /\(Lamport, 1978\)/);
    assert.match(html, /<i>CACM<\/i>/);
  });
  it('reads lookup results', () => {
    assert.equal(parseDoi('https://doi.org/10.1145/359545.359563.'), '10.1145/359545.359563');
    const e = entryFromCrossref({ message: { type: 'journal-article', title: ['T'], author: [{ given: 'Ada', family: 'Lovelace' }], 'container-title': ['J'], issued: { 'date-parts': [[1843]] }, DOI: '10.1/x' } }, new Set(['lovelace1843']));
    assert.equal(e?.key, 'lovelace1843a');
    assert.equal(e?.fields['doi'], '10.1/x');
  });
});

describe('peer review', () => {
  const src = 'A {++new++} and {--old--} and {~~cat~>dog~~} here {==marked==}{>>why?<<} end.\n';
  it('lists items', async () => {
    const { collectReview } = await import('../src/core/study/review');
    const items = collectReview(parse(src));
    assert.deepEqual(items.map((i) => i.kind), ['insert', 'delete', 'substitute', 'comment']);
    assert.equal(items[3]?.comment, 'why?');
  });
  it('accepts and rejects', async () => {
    const { resolveReview } = await import('../src/core/study/review');
    assert.equal(resolveReview(parse(src), 'accept'), 'A new and  and dog here marked end.\n');
    assert.equal(resolveReview(parse(src), 'reject'), 'A  and old and cat here marked end.\n');
  });
});

describe('docx export', () => {
  it('writes a valid package', async () => {
    const { buildDocx } = await import('../src/core/study/docx');
    const doc = parse('# Title\n\nHello **bold** [link](https://example.com).\n\n- a\n- [x] b\n\n> quoted\n\n| h |\n| - |\n| c |\n\n```py\nprint(1)\n```\n\n:::definition {title="X"}\nBody\n:::\n');
    const bytes = buildDocx(doc, { title: 'T', author: 'A', date: '2026-01-01', titlePage: true });
    assert.equal(String.fromCharCode(bytes[0]!, bytes[1]!), 'PK');
    const text = Buffer.from(bytes).toString('latin1');
    for (const name of ['word/document.xml', '[Content_Types].xml', 'word/styles.xml']) assert.ok(text.includes(name), name);
    assert.ok(text.includes('<w:b/>') && text.includes('Heading1') && text.includes('rIdLink1'));
  });
});

describe('html export', () => {
  const doc = parse('---\ntitle: Notes\nauthor: Ada\ncourse: CS\n---\n\n# Notes\n\n## One\n\nText\n\n---\n\nMore\n\n## Two\n\n- x\n');
  it('builds a document with a title page and contents', async () => {
    const { documentHtml } = await import('../src/core/study/export');
    const html = documentHtml(doc, { css: '', render: {}, titlePage: true, toc: true });
    assert.match(html, /export-title/);
    assert.match(html, /<h1>Notes<\/h1><p>Ada<\/p><p>CS<\/p>/);
    assert.match(html, /href="#one"/);
    assert.doesNotMatch(html, /<script/);
  });
  it('splits slides', async () => {
    const { slidesHtml, splitSlides } = await import('../src/core/study/export');
    assert.equal(splitSlides(doc.blocks).length, 4);
    const html = slidesHtml(doc, { css: '', render: {} });
    assert.equal((html.match(/class="slide"/g) ?? []).length, 3);
    assert.match(html, /class="slide cover"/);
  });
});

describe('importers', async () => {
  const imp = await import('../src/core/study/importers');
  it('converts Obsidian callouts and image embeds', () => {
    const out = imp.obsidianToYamd('> [!warning] Careful\n> Do not **panic**.\n\n![[diagram one.png|300]]\n\nSee [[Other note]] and ![[Other note#Intro]].\n');
    assert.match(out, /^:::warning \{title="Careful"\}\nDo not \*\*panic\*\*\.\n:::/);
    assert.match(out, /!\[diagram one\]\(diagram%20one\.png\)\{width=300\}/);
    assert.match(out, /\[\[Other note\]\] and !\[\[Other note#Intro\]\]/);
    assert.equal(parse(out).diagnostics.filter((d) => d.code === 'Y601').length, 0);
  });
  it('cleans Notion names and links', () => {
    assert.equal(imp.cleanNotionName('Lecture 1 0123456789abcdef0123456789abcdef.md'), 'Lecture 1.md');
    const out = imp.notionToYamd('See [Week 2](Week%202%20fedcba9876543210fedcba9876543210.md) and [web](https://x.org).\n');
    assert.equal(out, 'See [Week 2](<Week 2.yamd>) and [web](https://x.org).\n');
  });
  it('turns CSV into a database', () => {
    const ydb = imp.csvToYdb('Name,Points,Due\n"Essay, draft",10,2026-03-01\nQuiz,5,\n', 'Work');
    assert.match(ydb, /yamdb: 0\.1/);
    assert.match(ydb, /Points: number/);
    assert.match(ydb, /Due: date/);
    assert.match(ydb, /Name: Essay, draft/);
  });
  it('converts HTML', () => {
    const html = '<html lang="en"><head><title>Week 3</title></head><body><h1>Week 3</h1><p>Some <b>bold</b> and <span style="font-style:italic">italic</span> with a <a href="https://e.org">link</a>.</p><ul><li>one<ul><li>nested</li></ul></li><li>two</li></ul><table><tr><th>A</th><th>B</th></tr><tr><td>1</td><td>2</td></tr></table><pre>x = 1</pre></body></html>';
    const out = imp.htmlToYamd(html, 'x');
    assert.match(out, /^---\ntitle: Week 3\nlang: en\n---\n\n# Week 3\n\nSome \*\*bold\*\* and \*italic\* with a \[link\]\(https:\/\/e\.org\)\./);
    assert.match(out, /- one\n   - nested\n- two/);
    assert.match(out, /\| A \| B \|\n\| --- \| --- \|\n\| 1 \| 2 \|/);
    assert.match(out, /```\nx = 1\n```/);
  });
});
