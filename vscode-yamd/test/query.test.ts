import assert from 'node:assert/strict';
import { before, describe, test } from 'node:test';
import initSqlJs from 'sql.js';
import type { SqlJsStatic } from 'sql.js';
import { closeMarker, findRegions, openMarker, writeRegion } from '../src/core/build/markers';
import { parseCsv } from '../src/core/query/csv';
import { loadCsv, loadJson, loadSqlite, readOnlyProblem, runQuery, sourceKind, tableNameFor } from '../src/core/query/engine';
import { snapshotLines, writeSnapshot } from '../src/core/query/snapshot';
import { renderQueryResult } from '../src/core/query/views';

let SQL: SqlJsStatic;
before(async () => {
  SQL = await initSqlJs();
});

const CSV = 'id,title,owner,status\n1,Header overlaps logo,Sam,open\n2,"Slow, image load",Priya,open\n3,Typo in footer,Sam,closed\n';

describe('csv', () => {
  test('quoted fields, doubled quotes, CRLF and a trailing blank line', () => {
    assert.deepEqual(parseCsv('a,b\r\n"x, y","say ""hi"""\r\n\r\n'), [['a', 'b'], ['x, y', 'say "hi"']]);
  });
});

describe('query engine', () => {
  test('a CSV becomes a table named after the file, with inferred types', () => {
    assert.equal(tableNameFor('/data/bugs.csv'), 'bugs');
    assert.equal(tableNameFor('2024 sales.csv'), 't_2024_sales');
    const db = loadCsv(SQL, '/data/bugs.csv', CSV);
    const r = runQuery(db, "SELECT id, title FROM bugs WHERE status != 'closed' ORDER BY id");
    assert.deepEqual(r.columns, ['id', 'title']);
    assert.deepEqual(r.rows, [[1, 'Header overlaps logo'], [2, 'Slow, image load']]);
    assert.equal(r.total, 2);
  });

  test('JSON arrays and wrapped arrays load', () => {
    const db = loadJson(SQL, 'people.json', '{"people":[{"n":"a","age":3},{"n":"b","age":5,"x":[1]}]}');
    assert.deepEqual(runQuery(db, 'SELECT n, age FROM people ORDER BY age').rows, [['a', 3], ['b', 5]]);
    assert.throws(() => loadJson(SQL, 'x.json', '"nope"'));
  });

  test('a SQLite file is read from a copy and cannot be written', () => {
    const src = new SQL.Database();
    src.run('CREATE TABLE t (a INTEGER); INSERT INTO t VALUES (1),(2);');
    const bytes = src.export();
    const db = loadSqlite(SQL, bytes);
    assert.equal(runQuery(db, 'SELECT count(*) FROM t').rows[0]?.[0], 2);
    assert.throws(() => db.run('INSERT INTO t VALUES (3)'));
  });

  test('only a single read-only SELECT is allowed', () => {
    const db = loadCsv(SQL, 'bugs.csv', CSV);
    assert.equal(readOnlyProblem(db, 'SELECT * FROM bugs'), null);
    assert.equal(readOnlyProblem(db, "UPDATE bugs SET status='x'")?.code, 'Q001');
    assert.equal(readOnlyProblem(db, 'DROP TABLE bugs')?.code, 'Q001');
    assert.equal(readOnlyProblem(db, 'SELECT 1; SELECT 2')?.code, 'Q001');
    assert.equal(readOnlyProblem(db, 'PRAGMA table_info(bugs)')?.code, 'Q001');
    assert.equal(readOnlyProblem(db, 'SELECT * FROM missing')?.code, 'Q002');
    assert.equal(readOnlyProblem(db, "SELECT 'DROP TABLE bugs' AS note")?.code, undefined);
    assert.equal(readOnlyProblem(db, '')?.code, 'Q002');
  });

  test('sorting, grouping, joins, subqueries and CTEs are reads, not writes', () => {
    const db = loadCsv(SQL, 'bugs.csv', CSV);
    for (const sql of [
      'SELECT * FROM bugs ORDER BY title DESC',
      'SELECT owner, count(*) AS n FROM bugs GROUP BY owner ORDER BY n',
      'SELECT DISTINCT owner FROM bugs',
      'SELECT * FROM bugs WHERE id IN (SELECT id FROM bugs WHERE status = \'open\')',
      'WITH open AS (SELECT * FROM bugs WHERE status = \'open\') SELECT count(*) FROM open',
      'SELECT a.title FROM bugs a JOIN bugs b ON a.owner = b.owner AND a.id < b.id',
      'SELECT owner FROM bugs UNION SELECT title FROM bugs',
    ]) {
      assert.equal(readOnlyProblem(db, sql), null, sql);
      assert.ok(runQuery(db, sql).rows.length > 0, sql);
    }
  });

  test('detects the source kind from the file name', () => {
    assert.deepEqual(['a.csv', 'a.JSON', 'a.sqlite', 'a.db', 'a.txt'].map(sourceKind), ['csv', 'json', 'sqlite', 'sqlite', undefined]);
  });
});

describe('views', () => {
  const db = () => loadCsv(SQL, 'bugs.csv', CSV);

  test('table escapes values', () => {
    const r = runQuery(db(), "SELECT '<b>x</b>' AS v");
    assert.match(renderQueryResult(r, { view: 'table' }), /&lt;b&gt;x&lt;\/b&gt;/);
  });

  test('board groups rows into columns', () => {
    const html = renderQueryResult(runQuery(db(), 'SELECT title, status FROM bugs'), { view: 'board', group: 'status' });
    assert.equal((html.match(/kanban-column"/g) ?? []).length, 2);
    assert.match(html, /kanban-column-title">open</);
  });

  test('board and chart explain a missing column', () => {
    const r = runQuery(db(), 'SELECT title FROM bugs');
    assert.match(renderQueryResult(r, { view: 'board', group: 'nope' }), /Q003/);
    assert.match(renderQueryResult(r, { view: 'chart', x: 'title', y: 'nope' }), /Q003/);
  });

  test('chart draws bars or a line', () => {
    const r = runQuery(db(), 'SELECT owner, count(*) AS n FROM bugs GROUP BY owner');
    assert.match(renderQueryResult(r, { view: 'chart', type: 'bar', x: 'owner', y: 'n' }), /<rect /);
    assert.match(renderQueryResult(r, { view: 'chart', type: 'line', x: 'owner', y: 'n' }), /<polyline /);
  });

  test('an empty result says so', () => {
    assert.match(renderQueryResult(runQuery(db(), "SELECT * FROM bugs WHERE id = 99"), { view: 'table' }), /No results/);
  });
});

describe('markers and snapshots', () => {
  test('writing a region twice changes nothing the second time', () => {
    const lines = ['a', openMarker('toc'), 'old', closeMarker('toc'), 'b'];
    const once = writeRegion(lines, 'toc', ['x', 'y']);
    assert.deepEqual(once, ['a', openMarker('toc'), 'x', 'y', closeMarker('toc'), 'b']);
    assert.equal(writeRegion(once, 'toc', ['x', 'y']), once);
  });

  test('a missing region is created after the given line, and only then', () => {
    assert.deepEqual(writeRegion(['a', 'b'], 'toc', ['x']), ['a', 'b']);
    assert.deepEqual(writeRegion(['a', 'b'], 'toc', ['x'], { insertAfter: 0 }), ['a', '', openMarker('toc'), 'x', closeMarker('toc'), 'b']);
  });

  test('findRegions reads attributes and ignores unclosed markers', () => {
    const r = findRegions(['<!-- yamd:toc depth=2 -->', 'x', '<!-- /yamd:toc -->', '<!-- yamd:open -->', 'y']);
    assert.deepEqual(r, [{ name: 'toc', attrs: 'depth=2', open: 0, close: 2 }]);
  });

  test('a snapshot is a table of at most 50 rows with a count of the rest', () => {
    const rows = Array.from({ length: 60 }, (_, i) => [i, `n${i}`]);
    const lines = snapshotLines({ columns: ['id', 'name'], rows, total: 60 }, new Date(2026, 10, 5, 9, 7));
    assert.equal(lines[0], '| id | name |');
    assert.equal(lines.filter((l) => l.startsWith('| ') && !l.startsWith('| id') && !l.startsWith('| ---')).length, 50);
    assert.ok(lines.includes('+10 more rows'));
    assert.equal(lines[lines.length - 1], '*Last run: 2026-11-05 09:07*');
  });

  test('a snapshot is written under its block and replaced on the next run', () => {
    const note = ['# T', '', '```sql', '-- id="q" source="a.csv"', 'SELECT 1;', '```', '', 'After.'];
    const r1 = { columns: ['a'], rows: [[1]], total: 1 };
    const first = writeSnapshot(note, 'q', 5, r1, new Date(2026, 0, 1, 1, 1));
    assert.equal(first[6], '');
    assert.equal(first[7], openMarker('query:q'));
    const second = writeSnapshot(first, 'q', 5, { columns: ['a'], rows: [[2]], total: 1 }, new Date(2026, 0, 1, 1, 1));
    assert.equal(second.filter((l) => l === openMarker('query:q')).length, 1);
    assert.ok(second.includes('| 2 |'));
    assert.equal(second[second.length - 1], 'After.');
  });

  test('running again with the same rows changes nothing, even at a later time', () => {
    const note = ['```sql', '-- id="q" source="a.csv"', 'SELECT 1;', '```'];
    const r = { columns: ['a'], rows: [[1]], total: 1 };
    const first = writeSnapshot(note, 'q', 3, r, new Date(2026, 0, 1, 1, 1));
    assert.equal(writeSnapshot(first, 'q', 3, r, new Date(2026, 5, 1, 9, 9)), first);
    const changed = writeSnapshot(first, 'q', 3, { columns: ['a'], rows: [[2]], total: 1 }, new Date(2026, 5, 1, 9, 9));
    assert.ok(changed.includes('*Last run: 2026-06-01 09:09*'));
  });

  test('pipes and newlines in cells do not break the table', () => {
    const lines = snapshotLines({ columns: ['a'], rows: [['x|y\nz']], total: 1 }, new Date());
    assert.equal(lines[2], '| x\\|y z |');
  });
});
