import assert from 'node:assert/strict';
import { existsSync, mkdtempSync, readFileSync, realpathSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import * as path from 'node:path';
import { describe, test } from 'node:test';
import { lint, parse } from '../src/core';
import type { LintOptions } from '../src/core';

const FM = '---\nlang: en\n---\n';

/** Lints with front matter that sets `lang`, so Y707 doesn't appear unless wanted. */
function codes(body: string, options?: LintOptions, withFm = true): string[] {
  return lint(parse((withFm ? FM : '') + body), options).map((d) => d.code);
}

function find(body: string, code: string, options?: LintOptions) {
  const src = FM + body;
  const d = lint(parse(src), options).find((x) => x.code === code);
  return d ? { ...d, text: src.slice(d.range.start, d.range.end) } : undefined;
}

describe('diagnostic format', () => {
  test('missing alt text', () => {
    const d = find('![](a.png)', 'Y702');
    assert.ok(d);
    assert.equal(d.severity, 'error');
    assert.equal(d.text, '![](a.png)');
    assert.match(d.message, /decorative/);
  });
});

describe('syntax rules', () => {
  test('Y101 tabs in indentation', () => {
    assert.deepEqual(codes('-\tok\n\n\t- item'), ['Y101']);
  });

  test('Y101 is a warning', () => {
    assert.equal(find('-\tok\n\n\t- item', 'Y101')?.severity, 'warning');
  });

  test('Y201 trailing backslash', () => {
    assert.deepEqual(codes('line \\\nnext'), ['Y201']);
    assert.equal(find('line \\\nnext', 'Y201')?.severity, 'info');
    assert.deepEqual(codes('escaped \\\\'), []);
  });

  test('Y301 missing space after ##', () => {
    const d = find('##Title', 'Y301');
    assert.ok(d);
    assert.match(d.message, /heading/);
    assert.deepEqual(codes('#tag at the start'), []);
  });

  test('changing a bullet marker starts a new list, as in GFM, with no diagnostic', () => {
    assert.deepEqual(codes('- a\n- b\n* c'), []);
    assert.deepEqual(codes('- a\n\n1. b'), []);
    assert.deepEqual(codes('- a\n\n* b'), []);
  });

  test('Y210 hard-wrapped paragraph', () => {
    const line = 'word '.repeat(14).trim();
    assert.deepEqual(codes([line, line, line, 'end.'].join('\n')), ['Y210']);
    assert.deepEqual(codes('Roses are red\nViolets are blue\nSugar is sweet'), []);
    assert.deepEqual(codes([line + '.', line + '.', 'end.'].join('\n')), []);
  });

  test('Y401 lazy quote continuation', () => {
    assert.match(find('> quote\nlazy', 'Y401')?.message ?? '', /continues the quote/);
    assert.deepEqual(codes('> quote\nlazy'), ['Y401']);
    assert.deepEqual(codes('> quote\n- list'), []);
  });

  test('Y501 unclosed fence', () => {
    const d = find('```js\ncode', 'Y501');
    assert.ok(d);
    assert.equal(d.text, '```js');
  });

  test('Y601 unknown directive', () => {
    const d = find(':::x-acme-chart\nhi\n:::', 'Y601');
    assert.ok(d);
    assert.match(d.message, /x-acme-chart/);
    assert.deepEqual(codes(':::note\nhi\n:::\n\n::toc\n\n:kbd[K]'), []);
  });
});

describe('link rules', () => {
  test('missing anchor', () => {
    assert.deepEqual(codes('## Tables\n\n[t](#tablez)'), ['Y701']);
    assert.deepEqual(codes('## Tables\n\n[t](#tables)'), []);
  });

  test('missing file', () => {
    const none = { fileExists: () => false };
    const all = { fileExists: () => true };
    assert.deepEqual(codes('[[installation]]', none), ['Y701']);
    assert.deepEqual(codes('[[installation]]', all), []);
    assert.deepEqual(codes('![Logo](img/logo.png)', none), ['Y701']);
  });

  test('wikilinks check the .yamd file', () => {
    const seen: string[] = [];
    codes('[[guide#Intro]]', { fileExists: (p) => (seen.push(p), true) });
    assert.deepEqual(seen, ['guide.yamd']);
  });

  test('external links are not checked', () => {
    let called = false;
    const out = codes('[x](https://example.com) https://example.org', { fileExists: () => ((called = true), false) });
    assert.deepEqual(out, []);
    assert.equal(called, false);
  });

  test('undefined references and footnotes', () => {
    assert.deepEqual(codes('[x][nope] and [^nope]'), ['Y701', 'Y701']);
  });

  test('missing cross-reference target', () => {
    assert.deepEqual(codes('See [@fig:none]'), ['Y701']);
  });

  test('unresolved ref target', () => {
    const d = find('[mitosis]{ref=no-such-id}', 'Y701');
    assert.ok(d);
    assert.equal(d.severity, 'warning');
    assert.match(d.message, /No element has the id "no-such-id"/);
  });

  test('ref target resolves to an attributed span', () => {
    assert.deepEqual(codes('[mitosis]{ref=def-mitosis} [Mitosis]{#def-mitosis}'), []);
  });

  test('ref target resolves to a block ID', () => {
    assert.deepEqual(codes('[mitosis]{ref=^def-mitosis}\n\nMitosis is nuclear division. ^def-mitosis'), []);
  });

  test('Y901 unsafe scheme', () => {
    assert.deepEqual(codes('[x](javascript:alert(1))'), ['Y901']);
  });
});

describe('accessibility rules', () => {
  test('Y704 skipped heading level', () => {
    const d = find('## A\n\n#### B', 'Y704');
    assert.ok(d);
    assert.equal(d.text, '#### B');
  });

  test('Y705 multiple H1', () => {
    assert.deepEqual(codes('# A\n\n# B'), ['Y705']);
  });

  test('decorative images need no alt text', () => {
    assert.deepEqual(codes('![](a.png){decorative}'), []);
  });

  test('Y703 table without header', () => {
    assert.deepEqual(codes('| a | b |\n| c | d |'), ['Y703']);
    assert.deepEqual(codes(':::table\n- - a\n:::'), ['Y703']);
  });

  test('Y706 vague link text', () => {
    assert.deepEqual(codes('[click here](https://x.dev)'), ['Y706']);
  });

  test('Y707 missing lang', () => {
    assert.deepEqual(codes('Text', undefined, false), ['Y707']);
    assert.deepEqual(codes('---\ntitle: T\n---\nText', undefined, false), ['Y707']);
  });
});

describe('kanban rules', () => {
  test('Y603 content before the first column', () => {
    assert.deepEqual(codes(':::kanban\nSprint goals\n\n## Todo\n- a\n:::'), ['Y603']);
  });

  test('Y604 over the limit', () => {
    const d = find(':::kanban\n## Doing {limit=2}\n- a\n- b\n- c\n:::', 'Y604');
    assert.ok(d);
    assert.equal(d.severity, 'info');
  });

  test('board headings are not document headings', () => {
    assert.deepEqual(codes('# Doc\n\n#### Planning\n\n:::kanban\n# Todo\n- a\n# Done\n:::'), ['Y704']);
  });
});

describe('variable rules', () => {
  test('Y801 undefined variable', () => {
    const src = '---\nlang: en\nvars:\n  product: Nimbus\n---\n{{ product }} {{ produc }}';
    const d = lint(parse(src)).filter((x) => x.code === 'Y801');
    assert.equal(d.length, 1);
    assert.match(d[0]?.message ?? '', /produc/);
  });

  test('Y802 template placeholder outside a template insertion', () => {
    const src = '---\nlang: en\n---\n{{@date}}';
    const d = lint(parse(src)).filter((x) => x.code === 'Y802' || x.code === 'Y801');
    assert.equal(d.length, 1);
    assert.equal(d[0]?.code, 'Y802');
    assert.equal(d[0]?.severity, 'info');
  });
});

describe('excluded content', () => {
  test('code, math and comments produce no diagnostics', () => {
    assert.deepEqual(codes('`{{ undefined }}` and `#Title`'), []);
    assert.deepEqual(codes('```\n#Title\n{{ x }}\n\tindent\n```'), []);
    assert.deepEqual(codes('$$\n#x\n$$'), []);
    assert.deepEqual(codes('%% #Title {{ x }} %%'), []);
    assert.deepEqual(codes('%%\n#Title\n%%'), []);
  });
});

describe('database diagnostics', () => {
  const dir = realpathSync(mkdtempSync(path.join(tmpdir(), 'yamd-lint-db-')));
  writeFileSync(path.join(dir, 'tasks.ydb'), 'yamdb: 0.1\nproperties:\n  Title: title\n  Status:\n    type: status\n    options: [Todo, Done]\n');
  writeFileSync(path.join(dir, 'broken.ydb'), 'yamdb: 0.1\nproperties: not-a-map\n');
  writeFileSync(path.join(dir, 'outside.ydb'), 'yamdb: 0.1\nproperties: {Title: title}\n');
  const fsAccess = { exists: existsSync, realpath: realpathSync };
  const dbOptions = (docFile = 'note.yamd'): LintOptions => ({
    databases: {
      docPath: path.join(dir, docFile),
      fs: fsAccess,
      readFile: (p) => {
        try {
          return readFileSync(p, 'utf8');
        } catch {
          return undefined;
        }
      },
    },
  });

  test('an unknown database or alias is Y850', () => {
    assert.ok(find('::db[nope]', 'Y850', dbOptions()));
  });

  test("a database outside the note's folder is Y951", () => {
    assert.ok(find('::db[../outside.ydb]', 'Y951', dbOptions()));
  });

  test('an invalid .ydb file is Y852, found without running any query', () => {
    assert.ok(find('::db[broken.ydb]', 'Y852', dbOptions()));
  });

  test('a view attribute of the wrong type is Y855, found without running any query', () => {
    const d = find('::db[tasks.ydb]{type=board group=Title}', 'Y855', dbOptions());
    assert.ok(d);
    assert.equal(d.severity, 'error');
  });

  test("an attribute that doesn't apply to the chosen type is Y856 (info)", () => {
    const d = find('::db[tasks.ydb]{shape=pie}', 'Y856', dbOptions());
    assert.ok(d);
    assert.equal(d.severity, 'info');
  });

  test('a valid reference and settings report no database diagnostics', () => {
    assert.deepEqual(codes('::db[tasks.ydb]{type=board group=Status}', dbOptions()).filter((c) => /^Y8[5-9]|^Y9[0-9]/.test(c)), []);
  });

  test('without the databases option, database checks are skipped entirely', () => {
    assert.deepEqual(codes('::db[nope]').filter((c) => c.startsWith('Y8')), []);
  });

  test('a SQLite-backed reference is still resolved (Y850/Y951), but its schema is not checked', () => {
    writeFileSync(path.join(dir, 'crm.sqlite'), '');
    assert.deepEqual(codes('::db[crm.sqlite]{type=board group=nonexistent}', dbOptions()).filter((c) => /^Y8[5-9]/.test(c)), []);
  });
});
