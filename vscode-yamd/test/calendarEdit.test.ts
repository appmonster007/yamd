import assert from 'node:assert/strict';
import { describe, test } from 'node:test';
import { parse } from '../src/core';
import { buildCalendarCards, cardSource, hashText } from '../src/core/kanban';
import { addCalendarCard, moveCalendarCard, renameCalendarCard } from '../src/core/calendarEdit';
import type { ContainerBlock } from '../src/core';
import type { LineEdit } from '../src/core/kanbanEdit';

const SRC = `:::calendar {title="October"}
- [ ] Submit report {due=2026-10-10}
- [x] Team sync {due=2026-10-14 owner=ada}
:::`;

function apply(src: string, edit: LineEdit | null): string {
  assert.ok(edit, 'expected an edit');
  const lines = src.split('\n');
  lines.splice(edit.startLine, edit.endLine - edit.startLine + 1, ...edit.text.split('\n'));
  return lines.join('\n');
}

function ref(src: string, title: string) {
  const doc = parse(src);
  const container = doc.blocks.find((b): b is ContainerBlock => b.type === 'container' && b.name === 'calendar');
  assert.ok(container);
  for (const c of buildCalendarCards(container).cards) {
    const text = c.title.map((n) => ('value' in n ? n.value : '')).join('');
    if (text === title) return { line: c.line, hash: hashText(cardSource(doc.lines, c)) };
  }
  throw new Error(`no card ${title}`);
}

describe('calendar edits', () => {
  test('moving a card rewrites its due= date, without moving its line', () => {
    const r = ref(SRC, 'Submit report');
    const out = apply(SRC, moveCalendarCard(SRC, 0, r, '2026-10-20'));
    assert.match(out, /- \[ \] Submit report \{due=2026-10-20\}/);
    assert.equal(out.split('\n').length, SRC.split('\n').length);
  });

  test('rejects a stale hash', () => {
    const r = ref(SRC, 'Submit report');
    assert.equal(moveCalendarCard(SRC, 0, { ...r, hash: 'stale' }, '2026-10-20'), null);
  });

  test('adds a card after the last one', () => {
    const out = apply(SRC, addCalendarCard(SRC, 0, '2026-10-25', 'New task'));
    assert.match(out, /Team sync.*\n- \[ \] New task \{due=2026-10-25\}/s);
  });

  test('adds the first card right after an empty calendar opens', () => {
    const empty = ':::calendar\n:::';
    const out = apply(empty, addCalendarCard(empty, 0, '2026-10-25', 'First task'));
    assert.equal(out, ':::calendar\n\n- [ ] First task {due=2026-10-25}\n:::');
  });

  test('renaming keeps the checkbox, tags and attributes', () => {
    const r = ref(SRC, 'Team sync');
    const out = apply(SRC, renameCalendarCard(SRC, 0, r, 'Weekly sync'));
    assert.match(out, /- \[x\] Weekly sync \{due=2026-10-14 owner=ada\}/);
  });
});
