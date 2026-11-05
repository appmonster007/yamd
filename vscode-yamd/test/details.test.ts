import { test } from 'node:test';
import assert from 'node:assert/strict';
import { computeBoardEdit } from '../src/core/widgets/boardEdit';
import { cardSource, hashText } from '../src/core/widgets/kanban';
import { rewriteDetailsLine } from '../src/core/widgets/detailsEdit';
import { render, parse } from '../src/core/markdown';

const apply = (source: string, e: { startLine: number; endLine: number; text: string }) => {
  const lines = source.split('\n');
  lines.splice(e.startLine, e.endLine - e.startLine + 1, ...e.text.split('\n'));
  return lines.join('\n');
};
const hashAt = (source: string, line: number, end = line) => hashText(cardSource(source.split('\n'), { line, endLine: end } as never));

test('title line: set, change and clear attributes and tags', () => {
  const k = { start: false };
  assert.equal(rewriteDetailsLine('- [ ] Ship #old {due=2026-01-01 color=red}', { due: '2026-02-02', start: '', owner: 'ann', tags: 'a, #b', }, k), '- [ ] Ship #a #b {due=2026-02-02 color=red owner=ann}');
  assert.equal(rewriteDetailsLine('- [x] Ship {due=2026-01-01 owner=bob}', { due: '', start: '', owner: '', tags: '' }, k), '- [x] Ship');
  assert.equal(rewriteDetailsLine('- Plan {start=2026-01-01 due=2026-01-09}', { due: '2026-01-09', start: '2026-01-02', owner: '', tags: '' }, { start: true }), '- Plan {start=2026-01-02 due=2026-01-09}');
});

test('kanban card details: attributes and body', () => {
  const src = ':::kanban\n## Todo\n\n- [ ] Write docs\n  old note\n- [ ] Other\n:::';
  const e = computeBoardEdit(src, { kind: 'kanban', op: 'details', board: 0, card: { line: 3, hash: hashAt(src, 3, 4) }, args: { due: '2026-03-03', owner: 'ann', tags: 'docs', body: 'new note\nsecond line' } });
  assert.ok(e);
  assert.equal(apply(src, e), ':::kanban\n## Todo\n\n- [ ] Write docs #docs {due=2026-03-03 owner=ann}\n  new note\n  second line\n- [ ] Other\n:::');
});

test('details: stale hash and bad date are refused', () => {
  const src = ':::calendar\n- [ ] Event {due=2026-03-03}\n:::';
  assert.equal(computeBoardEdit(src, { kind: 'calendar', op: 'details', board: 0, card: { line: 1, hash: 'nope' }, args: { due: '2026-03-04' } }), null);
  assert.equal(computeBoardEdit(src, { kind: 'calendar', op: 'details', board: 0, card: { line: 1, hash: hashAt(src, 1) }, args: { due: 'tomorrow' } }), null);
  const ok = computeBoardEdit(src, { kind: 'calendar', op: 'details', board: 0, card: { line: 1, hash: hashAt(src, 1) }, args: { due: '2026-03-04' } });
  assert.ok(ok);
  assert.equal(apply(src, ok), ':::calendar\n- [ ] Event {due=2026-03-04}\n:::');
});

test('rendering: edit buttons only when interactive; overdue and filter data', () => {
  const src = ':::kanban\n## Todo\n\n- [ ] Late #x {due=2020-01-01 owner=ann}\n:::';
  const live = render(parse(src), { interactive: true, today: '2026-01-01' });
  assert.match(live, /class="card-edit"/);
  assert.match(live, /data-owner="ann"/);
  assert.match(live, /data-tags="x"/);
  assert.match(live, /kanban-card overdue/);
  assert.doesNotMatch(render(parse(src), { interactive: false, today: '2026-01-01' }), /card-edit/);
  const cal = render(parse(':::calendar\n- [ ] Late {due=2020-01-01}\n:::'), { interactive: true, today: '2026-01-01' });
  assert.match(cal, /db-event overdue/);
  const tl = render(parse(':::timeline\n- [ ] Late {start=2020-01-01 due=2020-02-01}\n:::'), { interactive: true, today: '2026-01-01' });
  assert.match(tl, /db-timeline-bar overdue/);
  assert.match(tl, /db-timeline-item overdue/);
});
