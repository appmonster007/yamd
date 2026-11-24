import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { parse, render } from '../src/core/markdown';
import { derivationTex } from '../src/core/markdown/render';
import { review } from '../src/core/study/cards';
import { collectDeadlines, courseProgress, groupDeadlines, staleTopics } from '../src/core/study/deadlines';
import { heatmap, parseLog, streak } from '../src/core/study/studylog';
import { Bibliography, parseBibtex, parseCitation } from '../src/core/citations/bibtex';


describe('study blocks', () => {
  const doc = parse(':::definition {#def:x title="Group"}\nA set with an operation.\n:::\n\n:::theorem\nT.\n:::\n\nSee [@def:x].\n\n:::proof\nTrivial.\n:::\n');
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
});

describe('peer review', () => {
  const src = 'A {++new++} and {--old--} and {~~cat~>dog~~} here {==marked==}{>>why?<<} end.\n';
});

describe('docx export', () => {
});

describe('html export', () => {
  const doc = parse('---\ntitle: Notes\nauthor: Ada\ncourse: CS\n---\n\n# Notes\n\n## One\n\nText\n\n---\n\nMore\n\n## Two\n\n- x\n');
  it('builds a document with a title page and contents', async () => {
    const { documentHtml } = await import('../src/core/export/page');
    const html = documentHtml(doc, { css: '', render: {}, titlePage: true, toc: true });
    assert.match(html, /export-title/);
    assert.match(html, /<h1>Notes<\/h1><p>Ada<\/p><p>CS<\/p>/);
    assert.match(html, /href="#one"/);
    assert.doesNotMatch(html, /<script/);
  });
  it('splits slides', async () => {
    const { slidesHtml, splitSlides } = await import('../src/core/export/page');
    assert.equal(splitSlides(doc.blocks).length, 4);
    const html = slidesHtml(doc, { css: '', render: {} });
    assert.equal((html.match(/class="slide"/g) ?? []).length, 3);
    assert.match(html, /class="slide cover"/);
  });
});


import { formatClock, nextPhase, normalize } from '../src/core/study/pomodoro';

it('pomodoro settings are clamped and filled', () => {
  assert.deepEqual(normalize({}), normalize(undefined));
  const c = normalize({ focus: 0, short: 'x', long: 9999, every: 1, goal: -5 });
  assert.equal(c.focus, 1);
  assert.equal(c.short, 5);
  assert.equal(c.long, 120);
  assert.equal(c.every, 2);
  assert.equal(c.goal, 0);
});

it('pomodoro rounds: a long break after the set number of focus blocks', () => {
  const cfg = normalize({ every: 3 });
  let p = nextPhase(cfg, 'focus', 0);
  assert.deepEqual(p, { phase: 'short', done: 1 });
  p = nextPhase(cfg, p.phase, p.done);
  assert.deepEqual(p, { phase: 'focus', done: 1 });
  p = nextPhase(cfg, 'focus', 2);
  assert.deepEqual(p, { phase: 'long', done: 3 });
  assert.deepEqual(nextPhase(cfg, 'long', 3), { phase: 'focus', done: 0 });
});

it('formatClock rounds up to whole seconds', () => {
  assert.equal(formatClock(25 * 60_000), '25:00');
  assert.equal(formatClock(1), '00:01');
  assert.equal(formatClock(-5), '00:00');
});
