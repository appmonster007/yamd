import assert from 'node:assert/strict';
import { describe, test } from 'node:test';
import { parseAttributes, scanFences, scanWidgets } from '../src/core/fences';

const lines = (s: string) => s.split('\n');

describe('parseAttributes', () => {
  test('key=value, quoted values and bare words', () => {
    assert.deepEqual(parseAttributes('id=a source="my file.csv" view=table'), { attrs: { id: 'a', source: 'my file.csv', view: 'table' }, bare: [] });
    assert.deepEqual(parseAttributes('sprint-12'), { attrs: {}, bare: ['sprint-12'] });
  });
});

describe('scanFences', () => {
  test('finds backtick and tilde fences with their bodies', () => {
    const f = scanFences(lines('text\n```kanban id=a\n## Todo\n- [ ] x\n```\n\n~~~calendar\n- [ ] y\n~~~'));
    assert.equal(f.length, 2);
    assert.deepEqual([f[0]?.startLine, f[0]?.endLine, f[0]?.bodyStartLine, f[0]?.bodyEndLine], [1, 4, 2, 3]);
    assert.equal(f[1]?.type, 'calendar');
  });

  test('a longer closing fence closes; a shorter one does not', () => {
    const f = scanFences(lines('````kanban\n```\ninner\n```\n````'));
    assert.equal(f.length, 1);
    assert.equal(f[0]?.endLine, 4);
  });

  test('fences inside a list or blockquote are found', () => {
    assert.equal(scanFences(lines('- item\n  ```kanban a\n  - [ ] x\n  ```')).length, 1);
    assert.equal(scanFences(lines('> ```kanban a\n> body\n> ```')).length, 1);
  });

  test('an unclosed fence runs to the end of the note', () => {
    const f = scanFences(lines('```kanban a\n- [ ] x\nmore'));
    assert.equal(f[0]?.closed, false);
    assert.equal(f[0]?.bodyEndLine, 2);
  });

  test('a single bare word is the id; with other options it is not', () => {
    assert.equal(scanFences(lines('```kanban sprint-12\n```'))[0]?.id, 'sprint-12');
    assert.equal(scanFences(lines('```kanban id=a extra\n```'))[0]?.id, 'a');
    assert.equal(scanFences(lines('```kanban a b\n```'))[0]?.id, undefined);
  });
});

describe('scanWidgets', () => {
  test('labels widgets by id or by position within their type', () => {
    const w = scanWidgets(lines('```kanban\n```\n\n```kanban sprint\n```\n\n```calendar\n```\n\n```kanban\n```'));
    assert.deepEqual(w.map((x) => x.label), ['kanban #1', 'sprint', 'calendar #1', 'kanban #3']);
  });

  test('a sql block is a widget only when its header names a source', () => {
    const src = '```sql\nSELECT 1;\n```\n\n```sql\n-- id="open-bugs" source="bugs.csv" view="table"\nSELECT * FROM bugs;\n```';
    const w = scanWidgets(lines(src));
    assert.equal(w.length, 1);
    assert.equal(w[0]?.id, 'open-bugs');
    assert.equal(w[0]?.attrs['source'], 'bugs.csv');
  });

  test('other languages are not widgets', () => {
    assert.equal(scanWidgets(lines('```js\nlet a;\n```')).length, 0);
  });
});
