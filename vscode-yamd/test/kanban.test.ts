import assert from 'node:assert/strict';
import { describe, test } from 'node:test';
import { parse, render } from '../src/core';
import { buildBoard } from '../src/core/kanban';
import { addCard, cardTitleSource, moveCard, renameCard, toggleTask } from '../src/core/kanbanEdit';
import { cardSource, hashText } from '../src/core/kanban';
import type { ContainerBlock } from '../src/core';
import type { LineEdit } from '../src/core/kanbanEdit';

const BOARD = `:::kanban {title="Sprint"}
## Todo

- [ ] A #ui {due=2026-10-10 owner=ada}
  Body of A.
- [ ] B

## Doing {limit=1}

- [ ] C
- [ ] D

## Done {complete}

- [x] E
:::`;

function board(src = BOARD) {
  const doc = parse(src);
  const container = doc.blocks.find((b): b is ContainerBlock => b.type === 'container' && b.name === 'kanban');
  assert.ok(container);
  return { doc, board: buildBoard(container) };
}

function apply(src: string, edit: LineEdit | null): string {
  assert.ok(edit, 'expected an edit');
  const lines = src.split('\n');
  lines.splice(edit.startLine, edit.endLine - edit.startLine + 1, ...edit.text.split('\n'));
  return lines.join('\n');
}

function ref(src: string, title: string) {
  const { doc, board: b } = board(src);
  for (const col of b.columns) {
    for (const c of col.cards) {
      const text = c.title.map((n) => ('value' in n ? n.value : '')).join('');
      if (text === title) return { line: c.line, hash: hashText(cardSource(doc.lines, c)) };
    }
  }
  throw new Error(`no card ${title}`);
}

const titles = (src: string) =>
  board(src).board.columns.map((c) => c.cards.map((k) => k.title.map((n) => ('value' in n ? n.value : '')).join('')));

describe('board model', () => {
  test('columns and cards', () => {
    const { board: b } = board();
    assert.equal(b.title, 'Sprint');
    assert.deepEqual(titles(BOARD), [['A', 'B'], ['C', 'D'], ['E']]);
    assert.equal(b.columns[1]?.limit, 1);
    assert.equal(b.columns[2]?.complete, true);
  });

  test('card metadata and body', () => {
    const a = board().board.columns[0]?.cards[0];
    assert.ok(a);
    assert.deepEqual(a.tags, ['ui']);
    assert.equal(a.due, '2026-10-10');
    assert.equal(a.owner, 'ada');
    assert.equal(a.endLine, 4);
    assert.match(render(parse(BOARD)), /Body of A\./);
  });

  test('board headings are not in the table of contents', () => {
    const out = render(parse(`## Intro\n\n::toc\n\n${BOARD}`));
    assert.doesNotMatch(out, /<a href="#todo"/);
    assert.match(out, /<a href="#intro"/);
  });
});

describe('rendering', () => {
  test('over-limit columns and overdue cards', () => {
    const out = render(parse(BOARD), { today: '2026-10-16' });
    assert.match(out, /kanban-count over[^>]*>2\/1</);
    assert.match(out, /due overdue/);
  });

  test('done cards are not overdue', () => {
    const out = render(parse(':::kanban\n## Done\n- [x] X {due=2026-01-01}\n:::'), { today: '2026-10-16' });
    assert.doesNotMatch(out, /overdue/);
  });

  test('interactive boards are draggable', () => {
    const out = render(parse(BOARD), { interactive: true });
    assert.match(out, /draggable="true"/);
    assert.match(out, /kanban-add/);
    assert.doesNotMatch(render(parse(BOARD)), /draggable/);
  });
});

describe('moving cards', () => {
  test('between columns, with the body', () => {
    const out = apply(BOARD, moveCard(BOARD, 0, ref(BOARD, 'A'), 1, 0));
    assert.deepEqual(titles(out), [['B'], ['A', 'C', 'D'], ['E']]);
    assert.match(out, /## Doing \{limit=1\}\n\n- \[ \] A #ui \{due=2026-10-10 owner=ada\}\n  Body of A\.\n- \[ \] C/);
  });

  test('into a complete column ticks the card', () => {
    const out = apply(BOARD, moveCard(BOARD, 0, ref(BOARD, 'B'), 2, 1));
    assert.deepEqual(titles(out), [['A'], ['C', 'D'], ['E', 'B']]);
    assert.match(out, /- \[x\] B/);
  });

  test('out of a complete column unticks it', () => {
    const out = apply(BOARD, moveCard(BOARD, 0, ref(BOARD, 'E'), 0, 0));
    assert.match(out, /## Todo\n\n- \[ \] E\n- \[ \] A/);
  });

  test('within a column', () => {
    const out = apply(BOARD, moveCard(BOARD, 0, ref(BOARD, 'C'), 1, 1));
    assert.deepEqual(titles(out), [['A', 'B'], ['D', 'C'], ['E']]);
  });

  test('into an empty column', () => {
    const src = ':::kanban\n## Todo\n\n- [ ] A\n\n## Empty\n\n## Done\n\n- [x] B\n:::';
    const out = apply(src, moveCard(src, 0, ref(src, 'A'), 1, 0));
    assert.deepEqual(titles(out), [[], ['A'], ['B']]);
    assert.match(out, /## Empty\n\n- \[ \] A\n\n## Done/);
  });

  test('stale text is rejected', () => {
    const r = ref(BOARD, 'A');
    const changed = BOARD.replace('Body of A.', 'Edited.');
    assert.equal(moveCard(changed, 0, r, 1, 0), null);
  });

  test('the rest of the document is unchanged', () => {
    const src = `# Title\n\n${BOARD}\n\nAfter.`;
    const out = apply(src, moveCard(src, 2, ref(src, 'D'), 0, 2));
    assert.ok(out.startsWith('# Title\n\n:::kanban'));
    assert.ok(out.endsWith(':::\n\nAfter.'));
  });
});

describe('adding and renaming', () => {
  test('add a card to the end of a column', () => {
    const out = apply(BOARD, addCard(BOARD, 0, 0, 'Fix login'));
    assert.deepEqual(titles(out)[0], ['A', 'B', 'Fix login']);
  });

  test('add a card to an empty column', () => {
    const src = ':::kanban\n## Todo\n:::';
    assert.deepEqual(titles(apply(src, addCard(src, 0, 0, 'First'))), [['First']]);
  });

  test('rename keeps tags and attributes', () => {
    const out = apply(BOARD, renameCard(BOARD, 0, ref(BOARD, 'A'), 'Alpha'));
    assert.match(out, /- \[ \] Alpha #ui \{due=2026-10-10 owner=ada\}/);
  });

  test('title source', () => {
    assert.equal(cardTitleSource('- [ ] Fix it #bug {due=2026-01-01}'), 'Fix it');
  });
});

describe('task toggles', () => {
  test('ticks a task when the line is unchanged', () => {
    const src = 'a\n- [ ] task\n';
    const out = apply(src, toggleTask(src, 1, hashText('- [ ] task'), true));
    assert.equal(out, 'a\n- [x] task\n');
  });

  test('rejects a changed line', () => {
    assert.equal(toggleTask('- [ ] edited', 0, hashText('- [ ] task'), true), null);
  });
});
