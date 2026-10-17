/**
 * CommonMark 0.31.2 and GFM extension conformance.
 *
 * Examples are rendered with Markdown-style soft breaks and unsanitized HTML, so the suite tests
 * parsing. Newline handling and sanitizing are YAMD behaviors covered by their own tests.
 * Every failing example must be listed in fixtures/known-differences.json with its reason.
 * Run with YAMD_UPDATE_KNOWN=1 to write the current failures to that file.
 */
import assert from 'node:assert/strict';
import { readFileSync, writeFileSync } from 'node:fs';
import { test } from 'node:test';
import commonmark from 'commonmark-spec';
import { parse, render } from '../src/core';
import { convertFromMarkdown } from '../src/core/convert';

interface Example {
  number: number;
  section: string;
  markdown: string;
  html: string;
  extension?: string;
}

const knownPath = new URL('./fixtures/known-differences.json', import.meta.url);
const known = JSON.parse(readFileSync(knownPath, 'utf8')) as Record<'commonmark' | 'gfm', Record<string, string>>;
const gfm = JSON.parse(readFileSync(new URL('./fixtures/gfm-extensions.json', import.meta.url), 'utf8')) as {
  examples: Example[];
};

/** `gfm-extension`: GFM behavior that plain CommonMark doesn't have, such as bare URL autolinks. */
const VALID_REASONS = new Set(['yamd-syntax', 'sanitized-html', 'newline-is-break', 'gfm-extension']);

/** Normalizes HTML so formatting choices don't count as differences. */
export function normalize(html: string): string {
  return (
    html
      // YAMD wraps code blocks in a container.
      .replace(/<div class="code-block[^"]*"[^>]*>(?:<div class="code-header">[\s\S]*?<\/div>)?(<pre>[\s\S]*?<\/pre>)<\/div>/g, '$1')
      // YAMD-only attributes.
      .replace(/ data-[\w-]+(?:="[^"]*")?/g, '')
      .replace(/<(h[1-6]) id="[^"]*"/g, '<$1')
      .replace(/ class="(?!language-)[^"]*"/g, '')
      .replace(/ aria-label="Toggle task"/g, '')
      // Self-closing style and boolean attributes.
      .replace(/\s*\/>/g, '>')
      .replace(/ (\w+)=""/g, ' $1')
      .replace(/&#39;/g, "'")
      // Attribute order.
      .replace(/<(\w+)((?: [\w-]+(?:="[^"]*")?)+)>/g, (_m, tag: string, attrs: string) => {
        const list = attrs.trim().match(/[\w-]+(?:="[^"]*")?/g) ?? [];
        return `<${tag} ${list.sort().join(' ')}>`;
      })
      // Whitespace between tags.
      .replace(/>\s+</g, '><')
      .trim()
  );
}

function renderMarkdown(markdown: string): string {
  return render(parse(markdown), { rawHtml: 'trust', softBreaks: 'newline' });
}

function run(suite: 'commonmark' | 'gfm', examples: Example[]) {
  const failures = new Map<number, { example: Example; actual: string }>();
  for (const example of examples) {
    let actual: string;
    try {
      actual = renderMarkdown(example.markdown);
    } catch (err) {
      actual = `THREW: ${String(err)}`;
    }
    if (normalize(actual) !== normalize(example.html)) failures.set(example.number, { example, actual });
  }
  return failures;
}

/** The spec writes tabs as `→`. */
const withTabs = (e: Example): Example => ({ ...e, markdown: e.markdown.replace(/→/g, '\t'), html: e.html.replace(/→/g, '\t') });

const suites = {
  commonmark: (commonmark.tests as Example[]).map(withTabs),
  // Tag filtering is a sanitizing feature, tested in the security tests.
  gfm: gfm.examples.filter((e) => e.extension !== 'disabled' && e.extension !== 'tagfilter'),
};

const results = {
  commonmark: run('commonmark', suites.commonmark),
  gfm: run('gfm', suites.gfm),
};

if (process.env['YAMD_UPDATE_KNOWN']) {
  const next: Record<string, Record<string, string>> = { commonmark: {}, gfm: {} };
  for (const suite of ['commonmark', 'gfm'] as const) {
    for (const [n] of results[suite]) next[suite]![String(n)] = known[suite]?.[String(n)] ?? 'unclassified';
  }
  writeFileSync(knownPath, `${JSON.stringify(next, null, 2)}\n`);
}

for (const suite of ['commonmark', 'gfm'] as const) {
  test(`${suite} conformance`, () => {
    const total = suites[suite].length;
    const failures = results[suite];
    const listed = known[suite] ?? {};
    const unexpected = [...failures.values()]
      .filter(({ example }) => !(String(example.number) in listed))
      .map(({ example, actual }) =>
        [
          `#${example.number} (${example.section})`,
          `  markdown: ${JSON.stringify(example.markdown)}`,
          `  expected: ${normalize(example.html)}`,
          `  actual:   ${normalize(actual)}`,
        ].join('\n'),
      );
    const nowPassing = Object.keys(listed).filter((n) => !failures.has(Number(n)));
    const badReasons = Object.entries(listed).filter(([, r]) => !VALID_REASONS.has(r));
    const passRate = ((total - failures.size) / total) * 100;
    console.log(`${suite}: ${total - failures.size}/${total} passed (${passRate.toFixed(1)}%), ${failures.size} known differences`);
    assert.deepEqual(unexpected, [], 'Unlisted failures');
    assert.deepEqual(nowPassing, [], 'Listed examples now pass: remove them from known-differences.json');
    assert.deepEqual(badReasons, [], 'Every known difference needs a valid reason');
    assert.ok(passRate >= 90, `Pass rate ${passRate.toFixed(1)}% is below 90%`);
  });
}

/** Collapses whitespace outside `<pre>`, where a newline and a space render the same. */
function collapse(html: string): string {
  return normalize(html)
    .split(/(<pre[\s\S]*?<\/pre>)/)
    .map((part, i) => (i % 2 ? part : part.replace(/\s+/g, ' ')))
    .join('');
}

/** Examples where the converted file renders differently, apart from the known differences. */
const ROUND_TRIP_EXCEPTIONS: Record<string, string> = {
  // A paragraph ends inside raw `<pre>` HTML, and joining its lines changes the preformatted text.
  '148': 'joins a line inside raw <pre> HTML',
};

test('converted Markdown renders as GFM did', () => {
  const failures: string[] = [];
  for (const example of suites.commonmark) {
    const n = String(example.number);
    if (n in known.commonmark || n in ROUND_TRIP_EXCEPTIONS) continue;
    const converted = convertFromMarkdown(example.markdown).text;
    const actual = render(parse(converted), { rawHtml: 'trust' });
    if (collapse(actual) !== collapse(example.html)) failures.push(`#${n}: ${JSON.stringify(converted)}`);
  }
  assert.deepEqual(failures, []);
});
