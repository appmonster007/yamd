import assert from 'node:assert/strict';
import { describe, test } from 'node:test';
import { parse } from '../src/core';
import { toInternal } from '../src/core/compat';
import { extractCardsMd } from '../src/core/study/calloutCards';
import { collectDeadlines } from '../src/core/study/deadlines';
import { STUDY_TEMPLATES } from '../src/core/study/templates';
import { expandPlaceholders } from '../src/core/templates';
import { scanCallouts } from '../src/core/callouts';

const note = '---\ncourse: CS101\n---\n# Notes\n\n> [!card] What is O(log n)?\n> Binary search.\n>\n> Halving.\n\n> [!card] Second ^c2\n> A2\n\n> [!note] Not a card\n> x\n';

describe('cards from callouts', () => {
  test('question is the title, answer the body, course from front matter', () => {
    const cards = extractCardsMd(note, '/n.md');
    assert.deepEqual(cards.map((c) => [c.front, c.back, c.line, c.course]), [
      ['What is O(log n)?', 'Binary search.\n\nHalving.', 5, 'CS101'],
      ['Second', 'A2', 10, 'CS101'],
    ]);
    assert.equal(cards[1]?.id, 'c2');
  });

  test('editing the answer keeps the id; editing the question changes it', () => {
    const a = extractCardsMd(note, '/n.md')[0]!;
    const b = extractCardsMd(note.replace('Halving.', 'Splitting.'), '/n.md')[0]!;
    const c = extractCardsMd(note.replace('What is O(log n)?', 'Another?'), '/n.md')[0]!;
    assert.equal(a.id, b.id);
    assert.notEqual(a.id, c.id);
  });
});

describe('compat and deadlines', () => {
  test('widget fences become containers line for line', () => {
    const src = 'a\n```kanban x\n## Todo\n- [ ] t {due=2026-12-01}\n```\nb';
    const out = toInternal(src).split('\n');
    assert.equal(out.length, src.split('\n').length);
    assert.equal(out[1], ':::kanban');
    assert.equal(out[4], ':::');
  });

  test('deadlines are found inside widgets and plain tasks, at the right lines', () => {
    const src = '# T\n\n- [ ] plain {due=2026-11-20}\n\n```kanban b\n## Todo\n- [ ] on board {due=2026-12-01}\n```\n';
    const d = collectDeadlines(parse(toInternal(src)), '/n.md', 'T').filter((x) => x.kind === 'task');
    assert.deepEqual(d.map((x) => [x.title, x.due, x.line]), [['plain', '2026-11-20', 2], ['on board', '2026-12-01', 6]]);
  });
});

describe('study templates', () => {
  test('use callouts and fill placeholders once', () => {
    for (const t of STUDY_TEMPLATES) {
      const { text } = expandPlaceholders(t.text, { now: new Date(2026, 10, 5), title: 'T', vars: { course: 'C' } });
      assert.doesNotMatch(text, /\{\{@/);
      assert.doesNotMatch(text, /^:::/m);
    }
    const lecture = expandPlaceholders(STUDY_TEMPLATES[0]!.text, { now: new Date(2026, 10, 5), title: 'T', vars: { course: 'C' } }).text;
    assert.deepEqual(scanCallouts(lecture.split('\n')).map((c) => c.type), ['definition', 'question', 'card', 'summary']);
  });
});
