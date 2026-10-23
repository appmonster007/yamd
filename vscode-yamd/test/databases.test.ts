import assert from 'node:assert/strict';
import { mkdtempSync, readFileSync, realpathSync, symlinkSync, writeFileSync, mkdirSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import * as path from 'node:path';
import { before, describe, test } from 'node:test';
import initSqlJs from 'sql.js';
import type { SqlJsStatic } from 'sql.js';
import { parse, render } from '../src/core';
import { buildYdb, readOnlyProblem, runQuery } from '../src/core/db/engine';
import { executeJob } from '../src/core/db/jobs';
import type { Job, Source } from '../src/core/db/jobs';
import { dbNodes } from '../src/core/db/nodes';
import { buildNotesTables } from '../src/core/db/notesTables';
import { databaseAliases, resolveDatabase, ydbTableName } from '../src/core/db/scope';
import { NoteStore } from '../src/core/notes';
import { addRow, deleteRow, loadYdb, moveRow, setCell } from '../src/core/db/ydb';

let SQL: SqlJsStatic;
before(async () => {
  SQL = await initSqlJs({ locateFile: () => path.resolve('node_modules/sql.js/dist/sql-wasm.wasm') });
});

const EXAMPLES = path.resolve('../examples/04-databases/data');
const TASKS = readFileSync(path.join(EXAMPLES, 'tasks.ydb'), 'utf8');
const tasks = (): Source => ({ type: 'ydb', name: 'tasks', text: TASKS });
const crm = (table = 'contacts'): Source => ({ type: 'sqlite', table, bytes: readFileSync(path.join(EXAMPLES, 'crm.sqlite')) });

function apply(text: string, e: { startLine: number; endLine: number; text: string } | null): string {
  assert.ok(e);
  const lines = text.split('\n');
  lines.splice(e.startLine, e.endLine - e.startLine + 1, ...(e.text === '' ? [] : e.text.split('\n')));
  return lines.join('\n');
}

function changedLines(a: string, b: string): number {
  const x = a.split('\n');
  const y = b.split('\n');
  let i = 0;
  while (i < x.length && x[i] === y[i]) i++;
  let j = 0;
  while (j < x.length - i && x[x.length - 1 - j] === y[y.length - 1 - j]) j++;
  return Math.max(x.length - i - j, y.length - i - j);
}

const view = (source: Source, attrs: Record<string, string> = {}, extra: Partial<Extract<Job, { kind: 'view' }>> = {}) =>
  executeJob(SQL, { kind: 'view', key: 'v0', ref: 'tasks', source, attrs, interactive: false, today: '2026-10-16', maxRows: 500, ...extra });

describe('.ydb files', () => {
  test('minimal database', () => {
    const { db, diagnostics } = loadYdb('yamdb: 0.1\nproperties: {Title: title, Done: checkbox}\nrows: [{id: t1, Title: Write spec, Done: true}]');
    assert.deepEqual(diagnostics, []);
    assert.deepEqual(db?.rows, [{ id: 't1', Title: 'Write spec', Done: true }]);
  });

  test('validation: Y852, Y853, Y854', () => {
    const text = 'yamdb: 0.1\nproperties:\n  Points: number\n  Stage: {type: select, options: [Todo, Done]}\n  Bad: colour\nrows:\n  - {id: a, Points: three, Stage: Doing}\n  - {id: a}';
    const codes = loadYdb(text).diagnostics.map((d) => `${d.code}:${d.severity}:${text.slice(d.range.start, d.range.end)}`);
    assert.deepEqual(codes, ['Y852:error:colour', 'Y853:error:three', 'Y853:warning:Doing', 'Y854:error:a']);
  });

  test('the example databases are valid', () => {
    for (const f of ['tasks.ydb', 'projects.ydb', '../../05-kanban/data/roadmap.ydb']) {
      assert.deepEqual(loadYdb(readFileSync(path.join(EXAMPLES, f), 'utf8')).diagnostics, [], f);
    }
  });

  test('a cell edit changes only that line', () => {
    const out = apply(TASKS, setCell(TASKS, 't2', 'Status', 'Done'));
    assert.equal(changedLines(TASKS, out), 1);
    assert.match(out, /# A YAMD text database/);
  });

  test('automatic times are set on edit and add', () => {
    const out = apply(TASKS, setCell(TASKS, 't2', 'Points', 9, '2026-10-17T10:00:00Z'));
    assert.match(out, /Points: 9\n[\s\S]*?Updated: 2026-10-17T10:00:00Z/);
    const added = addRow(TASKS, { Title: 'New' }, '2026-10-17T10:00:00Z', 'abc123');
    assert.ok(added);
    const after = loadYdb(apply(TASKS, added.edit)).db?.rows.at(-1);
    assert.deepEqual(after, { id: 'abc123', Title: 'New', Created: '2026-10-17T10:00:00Z', Updated: '2026-10-17T10:00:00Z' });
  });

  test('delete and reorder rows', () => {
    const ids = (t: string) => loadYdb(t).db?.rows.map((r) => r.id);
    assert.deepEqual(ids(apply(TASKS, deleteRow(TASKS, 't3'))), ['t1', 't2', 't4', 't5']);
    assert.deepEqual(ids(apply(TASKS, moveRow(TASKS, 't5', 't1'))), ['t5', 't1', 't2', 't3', 't4']);
  });
});

describe('folder scope', () => {
  const dir = realpathSync(mkdtempSync(path.join(tmpdir(), 'yamd-db-')));
  mkdirSync(path.join(dir, 'projects', 'web'), { recursive: true });
  writeFileSync(path.join(dir, 'projects', 'tasks.ydb'), 'yamdb: 0.1');
  writeFileSync(path.join(dir, 'outside.ydb'), 'yamdb: 0.1');
  symlinkSync(path.join(dir, 'outside.ydb'), path.join(dir, 'projects', 'web', 'link.ydb'));
  const fs = { exists: existsSync, realpath: realpathSync };
  const resolve = (doc: string, ref: string, aliases: Record<string, string> = {}) => resolveDatabase(path.join(dir, doc), ref, aliases, fs);

  test('subfolder', () => {
    const r = resolve('README.yamd', 'projects/tasks.ydb');
    assert.ok(r.ok);
    assert.equal(r.ref.file, path.join(dir, 'projects', 'tasks.ydb'));
  });

  test('parent, absolute and symlink escapes are Y951', () => {
    assert.equal((resolve('projects/web/notes.yamd', '../tasks.ydb') as { code: string }).code, 'Y951');
    assert.equal((resolve('README.yamd', path.join(dir, 'outside.ydb')) as { code: string }).code, 'Y951');
    assert.equal((resolve('projects/web/notes.yamd', 'link.ydb') as { code: string }).code, 'Y951');
  });

  test('aliases and unknown names', () => {
    assert.ok(resolve('README.yamd', 't', { t: 'projects/tasks' }).ok);
    assert.equal((resolve('README.yamd', 'sales') as { code: string }).code, 'Y850');
  });
});

describe('query safety', () => {
  const db = () => buildYdb(SQL, loadYdb(TASKS).db as never, 'tasks');

  for (const [sql, code] of [
    ['DELETE FROM tasks', 'Y950'],
    ['SELECT 1; DROP TABLE tasks', 'Y950'],
    ["ATTACH '/etc/passwd' AS x", 'Y950'],
    ['PRAGMA table_info(tasks)', 'Y950'],
    ['SELECT load_extension(1)', 'Y950'],
    ['SELECT Title FROM', 'Y851'],
  ] as const) {
    test(`refuses ${sql}`, () => assert.equal(readOnlyProblem(db(), sql)?.code, code));
  }

  test('allows reads, including recursive CTEs and keywords in strings', () => {
    assert.equal(readOnlyProblem(db(), "SELECT 'DELETE; PRAGMA' AS x"), null);
    assert.equal(readOnlyProblem(db(), 'WITH RECURSIVE c(x) AS (SELECT 1 UNION ALL SELECT x+1 FROM c LIMIT 5) SELECT x FROM c'), null);
  });

  test('filter injection is refused and the data is unchanged', () => {
    const r = view(tasks(), { filter: '1=1); DELETE FROM tasks; --' });
    assert.equal(r.problem?.code, 'Y950');
  });

  test('SQLite writes use bound parameters', () => {
    const value = "x'); DROP TABLE contacts; --";
    const r = executeJob(SQL, { kind: 'write', source: crm(), sql: 'UPDATE "contacts" SET "name" = ? WHERE rowid = ?', params: [value, 1] });
    assert.equal(r.changes, 1);
    const db = new SQL.Database(r.bytes);
    assert.equal(runQuery(db, 'SELECT name FROM contacts WHERE rowid = 1').rows[0]?.[0], value);
    assert.equal(runQuery(db, 'SELECT count(*) FROM contacts').rows[0]?.[0], 6);
  });
});

describe('queries', () => {
  const q = (source: Source, sql: string, resultView = 'table') => executeJob(SQL, { kind: 'query', source, sql, resultView, maxRows: 500 });

  test('formulas are computed columns', () => {
    assert.deepEqual(q(tasks(), "SELECT Title FROM tasks WHERE Overdue").result?.rows, [['Load test the API']]);
  });

  test('multi-select values are JSON arrays', () => {
    const r = q(tasks(), "SELECT Title FROM tasks, json_each(tasks.Tags) WHERE json_each.value = 'backend'");
    assert.deepEqual(r.result?.rows, [['Finish the sign-up flow'], ['Load test the API']]);
  });

  test('value and list views', () => {
    assert.equal(q(tasks(), "SELECT count(*) FROM tasks WHERE Status = 'Done'", 'value').html, '1');
    assert.match(q(tasks(), 'SELECT Title FROM tasks', 'list').html ?? '', /^<ul class="db-result-list"><li>Write the launch plan<\/li>/);
  });

  test('HTML in data is escaped', () => {
    const html = q(tasks(), "SELECT '<img src=x onerror=alert(1)>' AS x").html ?? '';
    assert.doesNotMatch(html, /<img/);
    assert.match(html, /&lt;img src=x onerror=alert\(1\)&gt;/);
  });

  test('results are capped with a total', () => {
    const r = executeJob(SQL, { kind: 'query', source: tasks(), sql: 'WITH RECURSIVE c(x) AS (SELECT 1 UNION ALL SELECT x+1 FROM c LIMIT 800) SELECT x FROM c', resultView: 'table', maxRows: 500 });
    assert.equal(r.result?.rows.length, 500);
    assert.equal(r.result?.total, 800);
    assert.match(r.html ?? '', /Showing 500 of 800 rows/);
  });

  test('notes tables', () => {
    const source: Source = {
      type: 'notes',
      tables: {
        notes: [
          { path: 'a.yamd', title: 'A', folder: '', status: 'active' },
          { path: 'b.yamd', title: 'B', folder: '', status: 'done' },
        ],
        tags: [
          { path: 'a.yamd', tag: 'project' },
          { path: 'b.yamd', tag: 'project' },
        ],
        links: [],
        tasks: [
          { path: 'a.yamd', line: 3, text: 'Ship', done: 0 },
          { path: 'b.yamd', line: 4, text: 'Plan', done: 1 },
        ],
      },
    };
    assert.deepEqual(q(source, "SELECT title FROM notes JOIN tags USING (path) WHERE tag = 'project' AND status = 'active'").result?.rows, [['A']]);
    assert.deepEqual(q(source, 'SELECT path, text FROM tasks WHERE done = 0').result?.rows, [['a.yamd', 'Ship']]);
  });

  test('SQLite tables and types from _yamd_meta', () => {
    const r = q(crm(), "SELECT name FROM contacts WHERE stage = 'lead' ORDER BY name");
    assert.ok((r.result?.rows.length ?? 0) > 0);
    const schema = executeJob(SQL, { kind: 'schema', source: crm() }).schema;
    assert.equal(schema?.properties.find((p) => p.name === 'stage')?.type, 'status');
  });

  test('console refuses writes when read-only, and applies them otherwise', () => {
    const ro = executeJob(SQL, { kind: 'console', source: crm(), sql: "UPDATE contacts SET stage = 'won'", readOnly: true, maxRows: 100 });
    assert.equal(ro.problem?.code, 'Y950');
    const rw = executeJob(SQL, { kind: 'console', source: tasks(), sql: "UPDATE tasks SET Status = 'Done' WHERE id = 't3'", readOnly: false, maxRows: 100 });
    assert.equal(rw.changes, 1);
    assert.equal(rw.rows?.find((r) => r.id === 't3')?.['Status'], 'Done');
  });
});

describe('views', () => {
  test('table with columns, filter and sort', () => {
    const html = view(tasks(), { columns: 'Title,Status,Due', sort: '-Due', filter: "Status != 'Done'" }).html ?? '';
    const titles = [...html.matchAll(/data-prop="Title"[^>]*>([^<]*)</g)].map((m) => m[1]).filter((t) => t && t !== 'Title');
    assert.deepEqual(titles, ['Pick a mobile framework', 'Design the pricing page', 'Finish the sign-up flow', 'Load test the API']);
    assert.doesNotMatch(html, /Write the launch plan/);
  });

  test('saved view', () => {
    const html = view(tasks(), { view: 'Open' }).html ?? '';
    assert.match(html, /data-prop="Priority"/);
    assert.doesNotMatch(html, /data-prop="Points"/);
  });

  test('grouping follows option order', () => {
    const html = view(tasks(), { group: 'Status' }).html ?? '';
    const groups = [...html.matchAll(/<summary>.*?db-chip[^>]*>([^<]*)<\/span> <span class="db-group-count">(\d+)/g)].map((m) => `${m[1]}:${m[2]}`);
    assert.deepEqual(groups, ['Todo:3', 'Doing:1', 'Done:1']);
  });

  test('relations show the related title', () => {
    const projects = readFileSync(path.join(EXAMPLES, 'projects.ydb'), 'utf8');
    const html = view(tasks(), { columns: 'Title,Project' }, { relations: { Project: { source: { type: 'ydb', name: 'projects', text: projects }, href: 'data/projects.ydb' } } }).html ?? '';
    assert.match(html, /<a class="db-relation" href="data\/projects.ydb#p1">Web launch<\/a>/);
  });

  test('calendar', () => {
    const html = view(tasks(), { type: 'calendar', date: 'Due' }, { month: '2026-10' }).html ?? '';
    assert.match(html, /data-date="2026-10-20"><button type="button" class="db-day-number">20<\/button><div class="db-event" tabindex="0" data-row-id="t2" data-title="Finish the sign-up flow"><div class="db-event-summary">Finish the sign-up flow/);
    assert.match(html, /October 2026/);
  });

  test('a calendar event carries its own data-title, so the client never falls back to its (hidden-detail-including) textContent', () => {
    const html = view(tasks(), { type: 'calendar', date: 'Due', columns: 'Owner' }, { month: '2026-10' }).html ?? '';
    const event = /<div class="db-event"[^>]*>/.exec(html)?.[0] ?? '';
    assert.match(event, /data-title="[^"]+"/);
  });

  test('calendar, timeline and chart stay read-only even in an interactive (trusted) workspace', () => {
    const cases: Record<string, string>[] = [{ type: 'calendar', date: 'Due' }, { type: 'timeline', date: 'Started', 'date-end': 'Due' }, { type: 'chart', x: 'Status' }];
    for (const attrs of cases) {
      const html = view(tasks(), attrs, { interactive: true, month: '2026-10' }).html ?? '';
      assert.doesNotMatch(html, /data-interactive/);
      assert.doesNotMatch(html, /class="db-new"/);
      assert.doesNotMatch(html, /class="db-save-view"/);
    }
    const board = view(tasks(), { type: 'board', group: 'Status' }, { interactive: true }).html ?? '';
    assert.match(board, /data-interactive/);
    assert.match(board, /class="db-new"/);
  });

  test('calendar weeks get a week number, and events get a collapsible detail of the view\'s other columns', () => {
    const html = view(tasks(), { type: 'calendar', date: 'Due', columns: 'Owner' }, { month: '2026-10' }).html ?? '';
    assert.match(html, /class="db-week-number" data-week="\d+">Wk \d+/);
    assert.match(html, /class="db-event-detail"><span class="db-prop" data-prop="Owner" title="Owner">Ada<\/span><\/div>/);
    assert.match(html, /<div class="db-agenda" hidden>/);
  });

  test('list and gallery', () => {
    assert.match(view(tasks(), { type: 'list' }).html ?? '', /<ul class="db-list"><li data-row-id="t1"><span class="db-title">Write the launch plan/);
    const projects: Source = { type: 'ydb', name: 'projects', text: readFileSync(path.join(EXAMPLES, 'projects.ydb'), 'utf8') };
    assert.match(view(projects, { view: 'All projects' }).html ?? '', /<img class="db-cover" src="yamd-cover:..\/..\/assets\/architecture.svg"/);
  });

  test('board grouped by status, and Y855 for other types', () => {
    const roadmap: Source = { type: 'ydb', name: 'roadmap', text: readFileSync(path.join(EXAMPLES, '../../05-kanban/data/roadmap.ydb'), 'utf8') };
    const html = view(roadmap, { view: 'Board' }, { interactive: true }).html ?? '';
    assert.match(html, /class="kanban db-board"[^>]*data-reorder/);
    assert.match(html, /aria-label="Idea"/);
    assert.equal(view(tasks(), { type: 'board', group: 'Points' }).problem?.code, 'Y855');
  });

  test('gallery Y855 for a non-url, non-text cover', () => {
    assert.equal(view(tasks(), { type: 'gallery', cover: 'Points' }).problem?.code, 'Y855');
    assert.match(view(tasks(), { type: 'gallery', cover: 'Link' }).html ?? '', /class="db-gallery"/);
  });

  test('calendar Y855 for a non-date property', () => {
    assert.equal(view(tasks(), { type: 'calendar', date: 'Points' }).problem?.code, 'Y855');
  });

  test('timeline places rows by start/end date, with optional grouping', () => {
    const html = view(tasks(), { type: 'timeline', date: 'Due', group: 'Owner' }).html ?? '';
    assert.match(html, /class="db-timeline"/);
    assert.match(html, /db-timeline-bar/);
    assert.equal(view(tasks(), { type: 'timeline' }).problem?.code, 'Y851');
    assert.equal(view(tasks(), { type: 'timeline', date: 'Points' }).problem?.code, 'Y855');
    assert.equal(view(tasks(), { type: 'timeline', date: 'Due', 'date-end': 'Points' }).problem?.code, 'Y855');
    assert.equal(view(tasks(), { type: 'timeline', date: 'Due', group: 'Points' }).problem?.code, 'Y855');
  });

  test('chart aggregates rows by category', () => {
    const counts = view(tasks(), { type: 'chart', x: 'Status' }).html ?? '';
    assert.match(counts, /class="db-chart db-chart-bar"/);
    const sum = view(tasks(), { type: 'chart', x: 'Status', aggregate: 'sum', y: 'Points' }).html ?? '';
    assert.match(sum, /db-chart-bar/);
    const pie = view(tasks(), { type: 'chart', x: 'Status', shape: 'pie' }).html ?? '';
    assert.match(pie, /class="db-chart db-chart-pie"/);
    assert.equal(view(tasks(), { type: 'chart' }).problem?.code, 'Y851');
    assert.equal(view(tasks(), { type: 'chart', x: 'Status', aggregate: 'sum' }).problem?.code, 'Y851');
    assert.equal(view(tasks(), { type: 'chart', x: 'Status', aggregate: 'sum', y: 'Title' }).problem?.code, 'Y855');
    assert.equal(view(tasks(), { type: 'chart', x: 'Status', aggregate: 'bogus' }).problem?.code, 'Y855');
    assert.equal(view(tasks(), { type: 'chart', x: 'Status', shape: 'bogus' }).problem?.code, 'Y855');
  });

  test('chart bars and pie slices show their value as text, not just on hover', () => {
    const bars = view(tasks(), { type: 'chart', x: 'Status' }).html ?? '';
    assert.match(bars, /<span class="db-chart-value">3<\/span>/);
    const pie = view(tasks(), { type: 'chart', x: 'Status', shape: 'pie' }).html ?? '';
    assert.match(pie, /Todo \(3\)/);
  });

  test('a line chart draws a real connected line, not a copy of the bars', () => {
    const html = view(tasks(), { type: 'chart', x: 'Status', shape: 'line' }).html ?? '';
    assert.match(html, /class="db-chart db-chart-line"/);
    assert.match(html, /<svg[^>]*class="db-chart-svg"/);
    assert.match(html, /<path d="M[\d.]+,[\d.]+ L[\d.]+,[\d.]+ L[\d.]+,[\d.]+" class="db-chart-path">/);
    assert.equal((html.match(/db-chart-dot/g) ?? []).length, 3);
    assert.doesNotMatch(html, /db-chart-bar/);
  });

  test('Y856 for a view attribute that does not apply to the chosen type', () => {
    const html = view(tasks(), { type: 'table', cover: 'Link' }).html ?? '';
    assert.match(html, /Y856/);
    assert.match(html, /cover.*table/);
    const clean = view(tasks(), { type: 'board', group: 'Status' }).html ?? '';
    assert.doesNotMatch(clean, /Y856/);
  });

  test('invalid filter is Y851', () => {
    const r = view(tasks(), { filter: 'Status =' });
    assert.equal(r.problem?.code, 'Y851');
    assert.match(r.html ?? '', /db-error/);
  });

  test('formula and time cells are read-only', () => {
    const html = view(tasks(), { columns: 'Title,Overdue,Updated' }, { interactive: true }).html ?? '';
    assert.match(html, /data-prop="Title" data-type="title" class="db-cell editable"/);
    assert.match(html, /data-prop="Overdue" data-type="formula" class="db-cell"/);
    assert.match(html, /data-prop="Updated" data-type="updated_time" class="db-cell"/);
  });
});

describe('example notes', () => {
  const root = path.resolve('../examples');
  const store = new NoteStore([root], existsSync);
  for (const f of ['03-notes/home.yamd', '03-notes/ideas.yamd', '03-notes/queries.yamd', '03-notes/projects/project-alpha.yamd', '03-notes/projects/project-beta.yamd']) {
    if (existsSync(path.join(root, f))) store.set(path.join(root, f), readFileSync(path.join(root, f), 'utf8'));
  }
  const fs = { exists: existsSync, realpath: realpathSync };

  /** Runs every view and query in a note, as the preview does, and returns the problem codes. */
  function run(file: string): string[] {
    const full = path.join(root, file);
    const doc = parse(readFileSync(full, 'utf8'));
    const aliases = databaseAliases(doc.frontMatter?.data);
    return dbNodes(doc).map((node) => {
      let source: Source;
      if (!node.ref) source = { type: 'notes', tables: buildNotesTables(store, path.dirname(full)) };
      else {
        const r = resolveDatabase(full, node.ref, aliases, fs);
        if (!r.ok) return r.code;
        source = r.ref.kind === 'ydb' ? { type: 'ydb', name: ydbTableName(r.ref.file), text: readFileSync(r.ref.file, 'utf8') } : { type: 'sqlite', table: r.ref.table, bytes: readFileSync(r.ref.file) };
      }
      const job: Job =
        node.kind === 'view'
          ? { kind: 'view', key: node.key, ref: node.ref ?? '', source, attrs: node.attrs?.values as Record<string, string>, interactive: false, today: '2026-10-16', maxRows: 500 }
          : { kind: 'query', source, sql: node.sql ?? '', resultView: node.resultView ?? 'table', maxRows: 500 };
      // The runaway query is stopped by the worker's timeout, which this test doesn't run.
      if (/forever/.test(node.sql ?? '')) return 'Y952';
      return executeJob(SQL, job).problem?.code ?? 'ok';
    });
  }

  test('views and queries run without problems', () => {
    for (const f of ['04-databases/views.yamd', '04-databases/queries.yamd', '03-notes/queries.yamd', '05-kanban/roadmap-board.yamd']) {
      assert.deepEqual(run(f).filter((c) => c !== 'ok'), [], f);
    }
  });

  test('the security example reports each refused case', () => {
    assert.deepEqual(run('04-databases/security.yamd'), ['Y951', 'Y951', 'Y950', 'Y950', 'Y950', 'Y950', 'Y950', 'Y952', 'ok']);
  });
});

describe('document nodes', () => {
  test('placeholders for views and queries; sql blocks are code', () => {
    const src = '::db[tasks]{view=Open}\n\n```query {db=tasks view=list}\nSELECT Title FROM tasks\n```\n\nDone: :query[SELECT count(*) FROM tasks WHERE x * 2 > 1]{db=tasks}\n\n```sql\nDELETE FROM x\n```';
    const doc = parse(src);
    const nodes = dbNodes(doc);
    assert.deepEqual(nodes.map((n) => [n.key.charAt(0), n.ref, n.sql?.trim(), n.resultView]), [
      ['v', 'tasks', undefined, undefined],
      ['q', 'tasks', 'SELECT Title FROM tasks', 'list'],
      ['i', 'tasks', 'SELECT count(*) FROM tasks WHERE x * 2 > 1', 'value'],
    ]);
    const html = render(doc);
    assert.match(html, /class="db-slot db-view" data-db-key="v0"/);
    assert.match(html, /class="db-slot db-query" data-db-key="q2"/);
    assert.match(html, /class="db-slot db-inline"/);
    assert.match(html, /<code class="language-sql">DELETE FROM x/);
  });
});
