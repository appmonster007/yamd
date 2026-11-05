import assert from 'node:assert/strict';
import { describe, test } from 'node:test';
import { scanWidgets } from '../src/core/fences';
import { lintWidgets, setIdChange, suggestId, widgetTemplate } from '../src/core/widgetLint';

const lines = (s: string) => s.split('\n');
const codes = (s: string) => lintWidgets(lines(s)).map((p) => p.code);

describe('lintWidgets', () => {
  test('flags duplicate ids, missing ids and bad characters', () => {
    assert.deepEqual(codes('```kanban a\n```\n\n```kanban a\n```'), ['W001']);
    assert.deepEqual(codes('```kanban\n```'), ['W002']);
    assert.deepEqual(codes('```kanban id=Bad_Id\n```'), ['W003']);
  });

  test('flags an unclosed widget', () => {
    assert.ok(codes('```kanban a\n- [ ] x').includes('W004'));
  });

  test('flags a query block with no source, and bad views', () => {
    assert.deepEqual(codes('```sql\n-- id="q"\nSELECT 1;\n```'), ['W005']);
    assert.deepEqual(codes('```sql\n-- id="q" source="a.csv" view="pie"\nSELECT 1;\n```'), ['W006']);
    assert.deepEqual(codes('```sql\n-- id="q" source="a.csv" view="board"\nSELECT 1;\n```'), ['W007']);
    assert.deepEqual(codes('```sql\n-- id="q" source="a.csv" view="chart" x="a" y="b"\nSELECT 1;\n```'), []);
  });

  test('a clean note has no problems', () => {
    assert.deepEqual(codes('# Title\n\n```kanban sprint\n```\n\n```js\nx\n```'), []);
  });
});

describe('naming', () => {
  test('suggests the next free id', () => {
    assert.equal(suggestId('kanban', ['kanban-1', 'x']), 'kanban-2');
  });

  test('adds an id to an unnamed fence and replaces an existing one', () => {
    const src = lines('```kanban\n```\n\n```kanban old\n```\n\n```kanban id=a view=x\n```');
    const [w1, w2, w3] = scanWidgets(src);
    assert.equal(setIdChange(src, w1!, 'new').text, '```kanban id=new');
    assert.equal(setIdChange(src, w2!, 'new').text, '```kanban id=new');
    assert.equal(setIdChange(src, w3!, 'new').text, '```kanban id=new view=x');
  });

  test('names a query block through its header comment', () => {
    const src = lines('```sql\n-- id="a" source="x.csv"\nSELECT 1;\n```');
    assert.equal(setIdChange(src, scanWidgets(src)[0]!, 'b').text, '-- id="b" source="x.csv"');
  });

  test('templates carry a free id', () => {
    assert.match(widgetTemplate('kanban', ['kanban-1']), /```kanban kanban-2/);
    assert.match(widgetTemplate('sql', []), /id="sql-1"/);
  });
});
