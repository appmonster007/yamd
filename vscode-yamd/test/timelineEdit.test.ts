import assert from 'node:assert/strict';
import { describe, test } from 'node:test';
import { parse } from '../src/core';
import { buildTimeline, cardSource, hashText } from '../src/core/kanban';
import { addTimelineCard, moveTimelineCard, renameTimelineCard } from '../src/core/timelineEdit';
import type { ContainerBlock } from '../src/core';
import type { LineEdit } from '../src/core/kanbanEdit';

const SRC = `:::timeline {title="Q4"}
## Ada

- [ ] Ship billing API {start=2026-10-01 due=2026-10-15}

## Bob

- [ ] Migrate auth {start=2026-10-05 due=2026-11-01}
:::`;

const FLAT = `:::timeline
- [ ] Only task {start=2026-10-01 due=2026-10-05}
:::`;

function apply(src: string, edit: LineEdit | null): string {
  assert.ok(edit, 'expected an edit');
  const lines = src.split('\n');
  lines.splice(edit.startLine, edit.endLine - edit.startLine + 1, ...edit.text.split('\n'));
  return lines.join('\n');
}

function ref(src: string, title: string) {
  const doc = parse(src);
  const container = doc.blocks.find((b): b is ContainerBlock => b.type === 'container' && b.name === 'timeline');
  assert.ok(container);
  for (const g of buildTimeline(container).groups) {
    for (const c of g.cards) {
      const text = c.title.map((n) => ('value' in n ? n.value : '')).join('');
      if (text === title) return { line: c.line, hash: hashText(cardSource(doc.lines, c)) };
    }
  }
  throw new Error(`no card ${title}`);
}

describe('timeline edits', () => {
  test('rescheduling within the same lane shifts start and due together', () => {
    const r = ref(SRC, 'Ship billing API');
    const out = apply(SRC, moveTimelineCard(SRC, 0, r, 0, '2026-10-11'));
    assert.match(out, /- \[ \] Ship billing API \{start=2026-10-11 due=2026-10-25\}/);
  });

  test('rejects a stale hash', () => {
    const r = ref(SRC, 'Ship billing API');
    assert.equal(moveTimelineCard(SRC, 0, { ...r, hash: 'stale' }, 0, '2026-10-11'), null);
  });

  test('moving to a different lane relocates the card under that heading', () => {
    const r = ref(SRC, 'Ship billing API');
    const out = apply(SRC, moveTimelineCard(SRC, 0, r, 1, '2026-10-20'));
    const bobSection = out.slice(out.indexOf('## Bob'));
    assert.match(bobSection, /Ship billing API \{start=2026-10-20 due=2026-11-03\}/);
    assert.doesNotMatch(out.slice(0, out.indexOf('## Bob')), /Ship billing API/);
  });

  test('a flat (headingless) board has one shared lane at index 0', () => {
    const doc = parse(FLAT);
    const container = doc.blocks.find((b): b is ContainerBlock => b.type === 'container' && b.name === 'timeline');
    assert.ok(container);
    const board = buildTimeline(container);
    assert.equal(board.groups.length, 1);
    assert.equal(board.groups[0]?.title, undefined);
  });

  test('adds a card to a lane, after its last card', () => {
    const out = apply(SRC, addTimelineCard(SRC, 0, 1, 'New task', '2026-10-20'));
    assert.match(out, /Migrate auth.*\n- \[ \] New task \{start=2026-10-20\}/s);
  });

  test('adds a card to an empty lane, right after its heading', () => {
    const src = ':::timeline\n## Ada\n\n## Bob\n- [ ] Existing {start=2026-10-01}\n:::';
    const out = apply(src, addTimelineCard(src, 0, 0, 'First for Ada', '2026-10-01'));
    assert.match(out, /## Ada\n\n- \[ \] First for Ada \{start=2026-10-01\}/);
  });

  test('renaming keeps the checkbox and attributes', () => {
    const r = ref(SRC, 'Migrate auth');
    const out = apply(SRC, renameTimelineCard(SRC, 0, r, 'Migrate authentication'));
    assert.match(out, /- \[ \] Migrate authentication \{start=2026-10-05 due=2026-11-01\}/);
  });
});
