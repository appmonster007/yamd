import assert from 'node:assert/strict';
import { describe, test } from 'node:test';
import { lint, parse, render } from '../src/core';
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

describe('visual shorthands: calendar, timeline, gallery', () => {
  test(':::calendar places cards by {due=...}, with no column structure', () => {
    const src = ':::calendar {title="October"}\n- [ ] Submit report {due=2026-10-10}\n- [ ] Team sync {due=2026-10-14 owner=ada}\n:::';
    const html = render(parse(src), { today: '2026-10-16' });
    assert.match(html, /class="kanban-calendar"/);
    assert.match(html, /class="db-calendar"/);
    assert.match(html, /data-date="2026-10-10"[^]*?Submit report/);
    assert.match(html, /data-date="2026-10-14"[^]*?Team sync/);
  });

  test('a calendar card with no {due=...} is not shown, and reports Y606', () => {
    const src = ':::calendar\n- [ ] Undated\n- [ ] Dated {due=2026-10-10}\n:::';
    assert.doesNotMatch(render(parse(src), { today: '2026-10-16' }), /Undated/);
    assert.deepEqual(lint(parse(src)).map((d) => d.code).filter((c) => c !== 'Y707'), ['Y606']);
  });

  test('calendar weeks get a week number, and events get a collapsible detail with owner/tags/body', () => {
    const src = ':::calendar\n- [ ] Submit report #finance {due=2026-10-10 owner=ada}\n  Needs the Q3 numbers.\n:::';
    const html = render(parse(src), { today: '2026-10-16' });
    assert.match(html, /class="db-week-number" data-week="\d+">Wk \d+/);
    assert.match(html, /<div class="db-event-summary"><input type="checkbox"[^>]*> Submit report<\/div>/);
    assert.match(html, /class="db-event-detail">.*Needs the Q3 numbers.*tag">#finance.*kanban-owner">@ada/s);
  });

  test('calendar renders a below-grid agenda shell for day/week drill-down', () => {
    const src = ':::calendar\n- [ ] Submit report {due=2026-10-10}\n:::';
    const html = render(parse(src), { today: '2026-10-16' });
    assert.match(html, /<div class="db-agenda" hidden><div class="db-agenda-header"><span class="db-agenda-title"><\/span><button type="button" class="db-agenda-close"[^>]*>Close<\/button><\/div><div class="db-agenda-list"><\/div><\/div>/);
  });

  test('calendar and timeline cards render a clickable task-toggle checkbox, same as kanban', () => {
    const cal = render(parse(':::calendar\n- [x] Done {due=2026-10-10}\n:::'), { today: '2026-10-16', interactive: true, sourcePath: 'x.yamd' });
    assert.match(cal, /<input type="checkbox" class="task-toggle" data-line="1" data-hash="[a-z0-9]+" data-source="x\.yamd" checked aria-label="Toggle task">/);
    const tl = render(parse(':::timeline\n- [ ] Open {start=2026-10-01}\n:::'), { interactive: true, sourcePath: 'x.yamd' });
    assert.match(tl, /<input type="checkbox" class="task-toggle" data-line="1" data-hash="[a-z0-9]+" data-source="x\.yamd" aria-label="Toggle task">/);
  });

  test(':::timeline stretches cards into bars, grouped by heading when present', () => {
    const src = ':::timeline {title="Q4"}\n## Ada\n- [ ] Ship billing {start=2026-10-01 due=2026-10-15}\n\n## Bob\n- [ ] Migrate auth {start=2026-10-05 due=2026-11-01}\n:::';
    const html = render(parse(src));
    assert.match(html, /class="kanban-timeline"/);
    assert.equal((html.match(/db-timeline-row/g) ?? []).length, 2);
    assert.match(html, />Ada</);
    assert.match(html, />Bob</);
    assert.match(html, /db-timeline-bar/);
  });

  test(':::timeline with no headings puts every card on one shared track', () => {
    const src = ':::timeline\n- [ ] Only task {start=2026-10-01 due=2026-10-05}\n:::';
    const html = render(parse(src));
    assert.equal((html.match(/db-timeline-row/g) ?? []).length, 1);
  });

  test('a timeline card with no {start=...} is not shown, and reports Y606', () => {
    const src = ':::timeline\n- [ ] Undated\n- [ ] Dated {start=2026-10-01}\n:::';
    assert.doesNotMatch(render(parse(src)), /Undated/);
    assert.deepEqual(lint(parse(src)).map((d) => d.code).filter((c) => c !== 'Y707'), ['Y606']);
  });

  test(':::gallery turns each image plus its caption into a card', () => {
    const src = ':::gallery {title="Trip photos"}\n![Golden Gate Bridge](ggb.jpg)\nShot at sunset. #landscape\n\n![Yosemite Falls](yosemite.jpg)\nPeak flow in spring.\n:::';
    const html = render(parse(src));
    assert.match(html, /class="kanban-gallery"/);
    assert.equal((html.match(/class="db-card"/g) ?? []).length, 2);
    assert.match(html, /<img src="ggb\.jpg"/);
    assert.match(html, /Shot at sunset/);
    assert.match(html, /class="tag">#landscape/);
  });
});
