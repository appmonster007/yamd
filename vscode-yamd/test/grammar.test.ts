import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { before, describe, test } from 'node:test';
import * as oniguruma from 'vscode-oniguruma';
import * as textmate from 'vscode-textmate';

const require = createRequire(import.meta.url);
let grammar: textmate.IGrammar;

before(async () => {
  const wasm = readFileSync(require.resolve('vscode-oniguruma/release/onig.wasm'));
  await oniguruma.loadWASM(wasm.buffer.slice(wasm.byteOffset, wasm.byteOffset + wasm.byteLength) as ArrayBuffer);
  const registry = new textmate.Registry({
    onigLib: Promise.resolve({
      createOnigScanner: (patterns) => new oniguruma.OnigScanner(patterns),
      createOnigString: (s) => new oniguruma.OnigString(s),
    }),
    loadGrammar: async (scope) => {
      if (scope !== 'text.yamd') {
        // Embedded languages (YAML, Python, ...) ship with VS Code; stub them here.
        return textmate.parseRawGrammar(JSON.stringify({ scopeName: scope, patterns: [] }), `${scope}.json`);
      }
      const path = new URL('../syntaxes/yamd.tmLanguage.json', import.meta.url);
      return textmate.parseRawGrammar(readFileSync(path, 'utf8'), path.pathname);
    },
  });
  const loaded = await registry.loadGrammar('text.yamd');
  assert.ok(loaded);
  grammar = loaded;
});

/** Tokenizes a document and returns [text, scopes] for every token. */
function tokens(src: string): [string, string[]][] {
  const out: [string, string[]][] = [];
  let state = textmate.INITIAL;
  for (const line of src.split('\n')) {
    const r = grammar.tokenizeLine(line, state);
    for (const t of r.tokens) out.push([line.slice(t.startIndex, t.endIndex), t.scopes]);
    state = r.ruleStack;
  }
  return out;
}

/** Scopes of the first token whose text equals `text`. */
function scopesOf(src: string, text: string): string[] {
  const t = tokens(src).find(([s]) => s === text);
  assert.ok(t, `no token "${text}" in ${JSON.stringify(tokens(src).map(([s]) => s))}`);
  return t[1];
}

const has = (scopes: string[], prefix: string) => scopes.some((s) => s.startsWith(prefix));

describe('block constructs', () => {
  test('front matter', () => {
    assert.ok(has(scopesOf('---\ntitle: x\n---\nBody', '---'), 'punctuation.definition.frontmatter'));
  });

  test('headings', () => {
    assert.ok(has(scopesOf('## Title', 'Title'), 'markup.heading'));
    assert.ok(!has(scopesOf('#tag', '#tag'), 'markup.heading'));
  });

  test('lists and tasks', () => {
    assert.ok(has(scopesOf('- [x] done', '-'), 'punctuation.definition.list'));
    assert.ok(has(scopesOf('- [x] done', '[x]'), 'constant.language.task'));
    assert.ok(has(scopesOf('12. item', '12.'), 'punctuation.definition.list'));
  });

  test('quotes, breaks and tables', () => {
    assert.ok(has(scopesOf('> quote', '>'), 'punctuation.definition.quote'));
    assert.ok(has(scopesOf('Text\n\n---', '---'), 'meta.separator'));
    assert.ok(has(scopesOf('| a | b |', '|'), 'punctuation.separator.table'));
    assert.ok(has(scopesOf('| a |\n| --- |', '| --- |'), 'punctuation.separator.table'));
  });

  test('fenced code and math blocks', () => {
    assert.ok(has(scopesOf('```python\nx = 1\n```', 'python'), 'fenced_code.block.language'));
    assert.ok(has(scopesOf('```python\nx = 1\n```', 'x = 1'), 'meta.embedded.block.python'));
    assert.ok(has(scopesOf('```\nraw\n```', 'raw'), 'markup.raw.block'));
    assert.ok(has(scopesOf('$$\nx^2\n$$', 'x^2'), 'string.other.math.block'));
  });

  test('code content is not highlighted as YAMD', () => {
    assert.ok(!has(scopesOf('```\n**not bold**\n```', '**not bold**'), 'markup.bold'));
  });

  test('directives', () => {
    assert.ok(has(scopesOf(':::note\nBody\n:::', 'note'), 'entity.name.tag.directive'));
    assert.ok(has(scopesOf(':::note\nBody\n:::', 'Body'), 'meta.directive.container'));
    assert.ok(has(scopesOf('::toc{depth=2}', 'toc'), 'entity.name.tag.directive'));
    assert.ok(has(scopesOf('Press :kbd[K]', 'kbd'), 'entity.name.tag.directive'));
  });

  test('attribute lines', () => {
    assert.ok(has(scopesOf('{#id .cls key="v" flag}', '#id'), 'entity.other.attribute-name.id'));
    assert.ok(has(scopesOf('{#id .cls key="v" flag}', '.cls'), 'entity.other.attribute-name.class'));
    assert.ok(has(scopesOf('{#id .cls key="v" flag}', '"v"'), 'string.unquoted.attribute-value'));
  });
});

describe('inline constructs', () => {
  test('emphasis family', () => {
    assert.ok(has(scopesOf('**bold**', 'bold'), 'markup.bold'));
    assert.ok(has(scopesOf('*it*', 'it'), 'markup.italic'));
    assert.ok(has(scopesOf('++u++', 'u'), 'markup.underline'));
    assert.ok(has(scopesOf('~~s~~', 's'), 'markup.strikethrough'));
    assert.ok(has(scopesOf('==h==', 'h'), 'markup.highlight'));
    assert.ok(has(scopesOf('H_{2}O', '2'), 'markup.other.subscript'));
    assert.ok(has(scopesOf('x^{2}', '2'), 'markup.other.superscript'));
    assert.ok(has(scopesOf('x^10', '10'), 'markup.other.superscript'));
    assert.ok(has(scopesOf('~s~', 's'), 'markup.strikethrough'));
    assert.ok(has(scopesOf('_i_', 'i'), 'markup.italic'));
  });

  test('intraword underscores are not emphasis', () => {
    for (const [, scopes] of tokens('snake_case_name and file_name_here')) {
      assert.ok(!has(scopes, 'markup.italic') && !has(scopes, 'markup.bold'));
    }
  });

  test('spaced markers are not emphasis', () => {
    for (const [, scopes] of tokens('2 * 3 * 4 and C++ and C++')) {
      assert.ok(!has(scopes, 'markup.italic') && !has(scopes, 'markup.underline'));
    }
  });

  test('code, math and variables', () => {
    assert.ok(has(scopesOf('a `x` b', 'x'), 'markup.inline.raw'));
    assert.ok(has(scopesOf('$E = mc^2$', 'E = mc^2'), 'string.other.math.inline'));
    assert.ok(has(scopesOf('{{ name }}', 'name'), 'variable.other'));
  });

  test('links, wikilinks and images', () => {
    assert.ok(has(scopesOf('[t](https://x.dev)', 'https://x.dev'), 'markup.underline.link'));
    assert.ok(has(scopesOf('[[guide|Guide]]', 'guide'), 'markup.underline.link.wiki'));
    assert.ok(has(scopesOf('![alt](a.png){width=3}', 'a.png'), 'markup.underline.link.image'));
    assert.ok(has(scopesOf('![alt](a.png){width=3}', 'width'), 'entity.other.attribute-name'));
    assert.ok(has(scopesOf('see https://x.dev now', 'https://x.dev'), 'markup.underline.link'));
  });

  test('footnotes, citations and cross-references', () => {
    assert.ok(has(scopesOf('x[^n]', 'n'), 'constant.other.reference.footnote'));
    assert.ok(has(scopesOf('[@fig:a]', '@fig:a'), 'constant.other.reference.citation'));
  });

  test('comments and review markup', () => {
    assert.ok(has(scopesOf('a %% note %% b', ' note '), 'comment.block'));
    assert.ok(has(scopesOf('{++add++}', '{++add++}'), 'markup.inserted'));
    assert.ok(has(scopesOf('{--cut--}', '{--cut--}'), 'markup.deleted'));
    assert.ok(has(scopesOf('{~~a~>b~~}', 'b'), 'markup.inserted'));
  });

  test('escapes', () => {
    assert.ok(has(scopesOf('\\*', '\\*'), 'constant.character.escape'));
  });
});

test('examples/getting-started.yamd tokenizes without errors', () => {
  const sample = readFileSync(new URL('../../examples/getting-started.yamd', import.meta.url), 'utf8');
  assert.ok(tokens(sample).length > 500);
});
