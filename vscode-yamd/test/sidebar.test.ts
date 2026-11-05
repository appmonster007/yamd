import assert from 'node:assert/strict';
import { describe, test } from 'node:test';
import { cardNodes, dataFileNodes, outlineNodes, studyNodes, widgetNodes } from '../src/core/sidebar/nodes';
import type { Card } from '../src/core/study/cards';

const L = (s: string) => s.split('\n');

describe('sidebar views', () => {
  const note = `# T\n\n\`\`\`kanban sprint\n## Todo\n\`\`\`\n\n\`\`\`sql\n-- id="q" source="bugs.csv" view="chart"\nSELECT 1;\n\`\`\`\n\n> [!theorem] Euclid ^thm-e\n> x\n\n> [!note] Heads up\n> y\n\n![A](a.png)\n\n^fig-a\n\n> [!card] Q?\n> A\n`;

  test('widgets in the note, with their kind and line', () => {
    const nodes = widgetNodes(L(note));
    assert.deepEqual(nodes.map((n) => [n.label, n.description, n.icon, n.line, n.widget]), [
      ['sprint', 'kanban · line 3', 'project', 2, true],
      ['q', 'query · line 7 · chart', 'table', 6, true],
    ]);
    assert.deepEqual(widgetNodes(L('# nothing')), []);
  });

  test('callouts are numbered and targets listed without repeating a callout', () => {
    const [headings, callouts, targets] = outlineNodes(L(note));
    assert.equal(headings?.label, 'Headings');
    assert.deepEqual(headings?.children?.map((h) => h.label), ['T']);
    assert.equal(callouts?.label, 'Callouts (3)');
    assert.deepEqual(callouts?.children?.map((c) => c.label), ['Theorem 1: Euclid', 'Note: Heads up', 'Card: Q?']);
    assert.equal(callouts?.children?.[0]?.description, '^thm-e');
    assert.equal(targets?.label, 'Figures, tables and equations (1)');
    assert.deepEqual(targets?.children?.map((t) => [t.label, t.description]), [['Figure 1', '^fig-a']]);
    assert.deepEqual(outlineNodes(L('plain text')), []);
  });

  test('data files list the queries that use them', () => {
    const notes = [
      { path: '/n/a.md', lines: L('```sql\n-- id="q1" source="data/bugs.csv"\nSELECT 1;\n```\n\n```sql\n-- id="q2" source="data/bugs.csv"\nSELECT 2;\n```') },
      { path: '/n/b.md', lines: L('```sql\n-- id="q3" source="people.json"\nSELECT 1;\n```') },
    ];
    const nodes = dataFileNodes(notes, (note, src) => `${note.replace(/[^/]*$/, '')}${src}`, (p) => p.split('/').pop() ?? p);
    assert.deepEqual(nodes.map((n) => [n.label, n.description, n.icon]), [['bugs.csv', '2 queries', 'table'], ['people.json', '1 query', 'json']]);
    assert.deepEqual(nodes[0]?.children?.map((c) => [c.label, c.line]), [['a.md', 0], ['a.md', 5]]);
  });

  test('flashcards show due, new and later, and per course', () => {
    const card = (id: string, course?: string): Card => ({ id, kind: 'qa', front: id, back: 'a', line: 0, path: '/n.md', ...(course ? { course } : {}) });
    const cards = [card('a', 'CS101'), card('b', 'CS101'), card('c', 'Geo')];
    const nodes = cardNodes(cards, { version: 1, cards: {} }, '2026-11-05', 20);
    assert.deepEqual(nodes.slice(0, 3).map((n) => n.label), ['Due today: 0', 'New: 3', 'Scheduled later: 0']);
    assert.deepEqual(nodes[3]?.children?.map((c) => [c.label, c.description, c.review]), [['CS101', '0 due · 2 new', 'CS101'], ['Geo', '0 due · 1 new', 'Geo']]);
    assert.deepEqual(cardNodes([], { version: 1, cards: {} }, '2026-11-05', 20), []);
  });

  test('study progress lists courses, stale notes and study time', () => {
    const nodes = studyNodes({
      today: '2026-11-05',
      agenda: { overdue: [], today: [], week: [], later: [], done: [] },
      courses: [{ course: 'CS101', notes: 2, tasksDone: 1, tasksTotal: 4 }],
      stale: [{ path: '/n/old.md', title: 'old', tasksDone: 0, tasksTotal: 0, lastTouched: '2026-10-01' }],
      staleDays: 14,
      cards: { due: 0, fresh: 0, later: 0 },
      study: { weekMinutes: 90, totalMinutes: 600, streak: 3, byCourse: [], heatmap: [] },
      label: (p) => p.split('/').pop()?.replace('.md', '') ?? p,
    });
    assert.deepEqual(nodes.map((n) => n.label), ['Courses', 'Not touched in 14+ days (1)', 'Study time']);
    assert.equal(nodes[0]?.children?.[0]?.description, '1/4 tasks · 2 notes');
    assert.equal(nodes[1]?.children?.[0]?.label, 'old');
    assert.match(nodes[2]?.children?.[0]?.label ?? '', /This week: 1h 30m|This week: 90m/);
  });
});
