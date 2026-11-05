import assert from 'node:assert/strict';
import { readdirSync, readFileSync, statSync, existsSync } from 'node:fs';
import * as path from 'node:path';
import { before, describe, test } from 'node:test';
import initSqlJs from 'sql.js';
import type { SqlJsStatic } from 'sql.js';
import { bibSettings, buildNote } from '../src/core/build/build';
import { calloutProblems, scanCallouts } from '../src/core/build/callouts';
import { collectTargets } from '../src/core/build/refs';
import { finalizeHtml, prepareExport, renderWidgets } from '../src/core/export/prepare';
import { documentHtml, slidesHtml } from '../src/core/export/page';
import { parse, render } from '../src/core/markdown';
import { parseBibtex } from '../src/core/citations/bibtex';
import { loadCsv, loadJson, loadSqlite, readOnlyProblem, runQuery, sourceKind } from '../src/core/query/engine';
import { scanWidgets } from '../src/core/widgets/fences';
import { lintWidgets } from '../src/core/widgets/widgetLint';

const ROOT = path.resolve(__dirname, '..', '..', 'examples');

function notes(dir: string): string[] {
  return readdirSync(dir).flatMap((f) => {
    const p = path.join(dir, f);
    return statSync(p).isDirectory() ? notes(p) : p.endsWith('.md') ? [p] : [];
  });
}

const files = notes(ROOT);
let SQL: SqlJsStatic;
before(async () => {
  SQL = await initSqlJs();
});

function entriesFor(file: string, lines: string[]) {
  const { file: bib } = bibSettings(lines);
  return bib ? parseBibtex(readFileSync(path.resolve(path.dirname(file), bib), 'utf8')) : undefined;
}

describe('example notes', () => {
  test('there are examples', () => {
    assert.ok(files.length >= 15, `found ${files.length}`);
  });

  for (const file of files) {
    const rel = path.relative(ROOT, file);
    const text = readFileSync(file, 'utf8');
    const lines = text.split('\n');

    test(`${rel}: widgets and callouts are well formed`, () => {
      assert.deepEqual(lintWidgets(lines).map((p) => `${p.code} line ${p.line + 1}: ${p.message}`), []);
      assert.deepEqual(calloutProblems(lines).map((p) => `${p.code} line ${p.line + 1}: ${p.message}`), []);
    });

    test(`${rel}: Build leaves it unchanged`, () => {
      const entries = entriesFor(file, lines);
      const built = buildNote(lines, entries ? { entries } : {});
      assert.deepEqual(built.warnings, []);
      assert.deepEqual(built.lines, lines);
    });

    test(`${rel}: images and data files exist, queries run`, () => {
      for (const m of text.matchAll(/!\[[^\]]*\]\(([^)\s]+)/g)) {
        if (/^[a-z]+:/i.test(m[1] as string)) continue;
        assert.ok(existsSync(path.resolve(path.dirname(file), m[1] as string)), `missing image ${m[1]}`);
      }
      for (const w of scanWidgets(lines)) {
        if (w.type === 'gallery' && w.attrs['source']) assert.ok(existsSync(path.resolve(path.dirname(file), w.attrs['source'])), `missing folder ${w.attrs['source']}`);
        if (w.type !== 'sql') continue;
        const source = path.resolve(path.dirname(file), w.attrs['source'] as string);
        assert.ok(existsSync(source), `missing data ${w.attrs['source']}`);
        const kind = sourceKind(source);
        const bytes = readFileSync(source);
        const db = kind === 'csv' ? loadCsv(SQL, source, bytes.toString('utf8')) : kind === 'json' ? loadJson(SQL, source, bytes.toString('utf8')) : loadSqlite(SQL, new Uint8Array(bytes));
        const body = lines.slice(w.bodyStartLine + 1, w.bodyEndLine + 1).join('\n');
        assert.equal(readOnlyProblem(db, body), null, `${w.label}: ${body}`);
        const result = runQuery(db, body);
        assert.ok(result.rows.length > 0, `${w.label} returns rows`);
        if (w.attrs['view'] === 'chart') assert.ok(result.columns.includes(w.attrs['x'] as string) && result.columns.includes(w.attrs['y'] as string), `${w.label} chart columns`);
        if (w.attrs['view'] === 'board') assert.ok(result.columns.includes(w.attrs['group'] as string), `${w.label} board column`);
        db.close();
      }
    });

    test(`${rel}: exports without errors`, () => {
      const prepared = prepareExport(lines);
      const doc = parse(prepared.source, 'gfm');
      const blocks = new Map([...renderWidgets(prepared.widgets), ...prepared.queryBlocks.map((l): [number, string] => [l, '<table></table>'])]);
      const html = finalizeHtml(documentHtml(doc, { css: '', render: { softBreaks: 'newline' } }), blocks);
      assert.doesNotMatch(html, /YAMDANCHOR|YAMDQUERY/);
      assert.ok(slidesHtml(doc, { css: '', render: {} }).includes('slide'));
      void render;
    });
  }

  test('every cross-reference target in the examples is unique', () => {
    for (const file of files) {
      const ids = collectTargets(readFileSync(file, 'utf8').split('\n')).map((t) => t.id);
      assert.equal(new Set(ids).size, ids.length, path.relative(ROOT, file));
    }
  });

  test('the card callouts in the examples are found', () => {
    const cards = files.flatMap((f) => scanCallouts(readFileSync(f, 'utf8').split('\n')).filter((c) => c.type === 'card'));
    assert.ok(cards.length >= 6);
  });
});
