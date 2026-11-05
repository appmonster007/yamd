import assert from 'node:assert/strict';
import { describe, test } from 'node:test';
import { completionContext } from '../src/core/completion/context';
import { calloutBlock, equationBlock, figureBlock, idFrom, selectionToWidget, tableBlock } from '../src/core/editing/insert';
import { placeBlock } from '../src/core/editing/placeBlock';
import { calloutProblems, scanCallouts } from '../src/core/build/callouts';
import { collectTargets } from '../src/core/build/refs';
import { lintWidgets } from '../src/core/widgets/widgetLint';

const L = (s: string) => s.split('\n');

describe('insert blocks', () => {
  test('ids are a prefix and a slug, kept unique', () => {
    assert.equal(idFrom('thm', "Euclid's theorem!", []), 'thm-euclid-s-theorem');
    assert.equal(idFrom('thm', 'Euclid', ['thm-euclid', 'thm-euclid-2']), 'thm-euclid-3');
  });

  test('a study callout gets a reference id; a plain one and a card do not', () => {
    assert.equal(calloutBlock('theorem', 'Euclid', []), '> [!theorem] Euclid ^thm-euclid\n> ');
    assert.equal(calloutBlock('note', 'Careful'), '> [!note] Careful\n> ');
    assert.equal(calloutBlock('card', 'Q?'), '> [!card] Q?\n> ');
    assert.equal(calloutBlock('theorem', ''), '> [!theorem]\n> ');
  });

  test('inserted callouts, figures and tables are valid, and their targets are found', () => {
    let text = '# T\n\nIntro.\n';
    for (const block of [calloutBlock('theorem', 'Euclid'), figureBlock('The system', 'img/a b.png', []), tableBlock('Results', []), equationBlock('Energy', [])]) {
      const e = placeBlock(text, text.length, block);
      text = text.slice(0, e.offset) + e.insert + text.slice(e.offset + e.remove);
    }
    const lines = L(text);
    assert.deepEqual(calloutProblems(lines), []);
    assert.deepEqual(scanCallouts(lines).map((c) => c.type), ['theorem']);
    assert.deepEqual(collectTargets(lines).map((t) => t.id), ['thm-euclid', 'fig-the-system', 'tbl-results', 'eq-energy']);
    assert.match(text, /!\[The system\]\(img\/a%20b\.png\)/);
  });
});

describe('selection to widget', () => {
  test('a task list becomes a board with a column and a free id', () => {
    const out = selectionToWidget('- [ ] a\n- [ ] b\n', 'kanban', '```kanban kanban-1\n```');
    assert.equal(out, '```kanban kanban-2\n## Todo\n- [ ] a\n- [ ] b\n```');
    assert.deepEqual(lintWidgets(L(out)).filter((p) => p.severity !== 'hint'), []);
  });

  test('a selection that has columns keeps them; other widgets wrap as they are', () => {
    assert.equal(selectionToWidget('## One\n- [ ] x', 'kanban', ''), '```kanban kanban-1\n## One\n- [ ] x\n```');
    assert.equal(selectionToWidget('- [ ] Launch {due=2026-12-01}', 'calendar', ''), '```calendar calendar-1\n- [ ] Launch {due=2026-12-01}\n```');
  });

  test('a code fence inside the selection gets a longer outer fence', () => {
    const out = selectionToWidget('- [ ] a\n```js\nx\n```', 'timeline', '');
    assert.ok(out.startsWith('````timeline timeline-1\n'));
    assert.ok(out.endsWith('\n````'));
  });
});

describe('completion context', () => {
  test('after a fence, a callout bracket, a citation bracket or a marker', () => {
    assert.deepEqual(completionContext(['```kan'], 0, 6), { kind: 'widget-type', prefix: 'kan' });
    assert.deepEqual(completionContext(['> [!the'], 0, 7), { kind: 'callout-type', prefix: 'the' });
    assert.deepEqual(completionContext(['See [@fig-'], 0, 10), { kind: 'reference', prefix: 'fig-' });
    assert.deepEqual(completionContext(['See [@a; @sm'], 0, 12), { kind: 'reference', prefix: 'sm' });
    assert.deepEqual(completionContext(['<!-- yamd:to'], 0, 12), { kind: 'marker', prefix: 'to' });
    assert.equal(completionContext(['plain text'], 0, 5), undefined);
  });

  test('in a query header: values for source, view and columns; in the body: column names', () => {
    const lines = ['```sql', '-- id="q" source="da', 'SELECT na', '```'];
    assert.deepEqual(completionContext(lines, 1, lines[1]!.length), { kind: 'header-value', attr: 'source', prefix: 'da' });
    assert.deepEqual(completionContext(['```sql', '-- id="q" source="a.csv" view="'], 1, 31), { kind: 'header-value', attr: 'view', prefix: '' });
    assert.deepEqual(completionContext(['```sql', '-- id="q" source="a.csv" view="chart" y="'], 1, 42), { kind: 'header-value', attr: 'y', prefix: '' });
    assert.deepEqual(completionContext(lines, 2, 9), { kind: 'sql-body', prefix: 'na', blockLine: 0 });
  });
});
