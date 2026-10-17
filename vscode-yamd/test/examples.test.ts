import assert from 'node:assert/strict';
import { existsSync, readdirSync, readFileSync } from 'node:fs';
import * as path from 'node:path';
import { describe, test } from 'node:test';
import { fileURLToPath } from 'node:url';
import { convertFromMarkdown, lint, parse, render } from '../src/core';
import { NoteStore } from '../src/core/notes';

const root = fileURLToPath(new URL('../../examples/', import.meta.url));

function yamdFiles(dir: string): string[] {
  return readdirSync(dir, { withFileTypes: true }).flatMap((e) => {
    const full = path.join(dir, e.name);
    if (e.isDirectory()) return yamdFiles(full);
    return e.name.endsWith('.yamd') ? [full] : [];
  });
}

const all = yamdFiles(root);

/** Every example note, so wikilinks and embeds resolve across files as in the extension. */
const posixRoot = root.split(path.sep).join('/').replace(/\/$/, '');
const notes = new NoteStore([posixRoot], (p) => existsSync(p));
for (const f of all) notes.set(f.split(path.sep).join('/'), readFileSync(f, 'utf8'));
const rel = (file: string) => path.relative(root, file).split(path.sep).join('/');

/** Files that only use features the extension supports today. */
const available = all.filter((f) => {
  const r = rel(f);
  return (
    (r.startsWith('01-basics/') ||
      r.startsWith('02-documents/') ||
      r.startsWith('06-markdown/') ||
      (r.startsWith('03-notes/') && r !== '03-notes/queries.yamd') ||
      r === '05-kanban/sprint-board.yamd' ||
      !r.includes('/')) &&
    r !== '02-documents/diagnostics.yamd'
  );
});

function lintFile(file: string) {
  const dir = path.dirname(file);
  // Relative paths resolve from the file's folder, then from the examples root.
  const fileExists = (p: string) =>
    p.startsWith('/') ? existsSync(path.join(root, p)) : existsSync(path.resolve(dir, p)) || existsSync(path.resolve(root, p));
  return lint(parse(readFileSync(file, 'utf8')), { fileExists, notes: { lookup: notes, path: file.split(path.sep).join('/') } });
}

test('the examples folder has files for every area', () => {
  for (const area of ['01-basics', '02-documents', '03-notes', '04-databases', '05-kanban', '06-markdown']) {
    assert.ok(all.some((f) => rel(f).startsWith(`${area}/`)), `no examples in ${area}`);
  }
});

describe('every example renders safely', () => {
  for (const file of all) {
    test(rel(file), () => {
      const html = render(parse(readFileSync(file, 'utf8')));
      assert.doesNotMatch(html, /<script|<iframe|<[a-z][^>]*\son[a-z]+=/i);
    });
  }
});

describe('available examples have no diagnostics', () => {
  for (const file of available) {
    test(rel(file), () => {
      // A GitHub README has no front matter, so it can't set `lang`.
      const readme = rel(file) === '06-markdown/github-readme.yamd';
      // The sprint board is over a column limit on purpose.
      const board = rel(file) === '05-kanban/sprint-board.yamd';
      const found = lintFile(file)
        // home.yamd links to a note that doesn't exist yet, to show note creation.
        .filter((d) => !(readme && d.code === 'Y707') && !(board && d.code === 'Y604'))
        .filter((d) => !(rel(file) === '03-notes/home.yamd' && d.message.includes('"Weekly Review"')))
        .map((d) => `${d.code} ${d.message}`);
      assert.deepEqual(found, []);
    });
  }
});

test('the diagnostics example triggers every check', () => {
  const codes = new Set(lintFile(path.join(root, '02-documents/diagnostics.yamd')).map((d) => d.code));
  const expected = [
    'Y101', 'Y201', 'Y210', 'Y212', 'Y301', 'Y401', 'Y501', 'Y601', 'Y603', 'Y604',
    'Y701', 'Y702', 'Y703', 'Y704', 'Y705', 'Y706', 'Y707', 'Y801', 'Y901',
  ];
  assert.deepEqual([...codes].sort(), expected);
});

test('getting-started renders its title and figures', () => {
  const html = render(parse(readFileSync(path.join(root, 'getting-started.yamd'), 'utf8')));
  assert.match(html, /<h1 id="getting-started-with-nimbus"/);
  assert.match(html, /<a class="xref" href="#fig:arch">Figure 1<\/a>/);
});

test('the GitHub README needs no conversion', () => {
  const src = readFileSync(path.join(root, '06-markdown/github-readme.yamd'), 'utf8');
  assert.equal(convertFromMarkdown(src).text, src);
});
