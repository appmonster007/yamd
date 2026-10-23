import assert from 'node:assert/strict';
import { describe, test } from 'node:test';
import { parse, render } from '../src/core';
import { highlight, renderMath } from '../src/core/rich';

const html = (src: string) => render(parse(src));
const count = (s: string, sub: string) => s.split(sub).length - 1;

describe('total rendering', () => {
  test('unclosed constructs still render', () => {
    const out = html('```js\nlet a\n\n:::note\nbody\n\n**open');
    assert.match(out, /<code class="language-js">let a\n\n:::note\nbody\n\n\*\*open\n<\/code>/);
    const out2 = html(':::note\nbody **open');
    assert.match(out2, /callout-note/);
    assert.match(out2, /body \*\*open/);
  });
});

describe('line breaks', () => {
  test('a newline inside a paragraph is a line break', () => {
    assert.equal(html('Roses are red\nViolets are blue'), '<p data-line="0">Roses are red<br>\nViolets are blue</p>');
  });

  test('trailing spaces are ignored', () => {
    assert.equal(html('one  \ntwo'), html('one\ntwo'));
  });

  test('a blank line ends a paragraph', () => {
    assert.equal(count(html('a\n\nb'), '<p'), 2);
  });
});

describe('headings', () => {
  test('a hashtag is a tag, not a heading', () => {
    assert.equal(html('#hashtags are text'), '<p data-line="0"><span class="tag" data-tag="hashtags">#hashtags</span> are text</p>');
  });

  test('setext headings', () => {
    assert.match(html('Title\n====='), /<h1 id="title"/);
  });

  test('generated and explicit ids', () => {
    const out = html('## Getting Started\n\n## Getting Started\n\n## Install {#setup}');
    assert.match(out, /<h2 id="getting-started" data-line="0">/);
    assert.match(out, /<h2 id="getting-started-2" data-line="2">/);
    assert.match(out, /<h2 id="setup" data-line="4">Install<\/h2>/);
  });

  test('headings with variables slug from the resolved value', () => {
    assert.match(html('---\ntitle: Hello World\n---\n# {{ title }}'), /<h1 id="hello-world"/);
  });
});

describe('lists', () => {
  test('changing the bullet marker starts a new list at the same level, as in GFM', () => {
    const out = html('- a\n- b\n* c');
    assert.equal(count(out, '<ul'), 2);
    assert.equal(count(out, '<li'), 3);
    assert.doesNotMatch(out, /<li[^>]*>b\s*<ul/);
    assert.match(out, /<\/ul>\s*<ul/);
  });

  test('a blank line before a new marker starts a sibling list instead', () => {
    const out = html('- a\n\n* b');
    assert.equal(count(out, '<ul'), 2);
  });

  test('any number starts an ordered list', () => {
    assert.match(html('2024. Great year'), /<ol start="2024"/);
    assert.equal(html('2024\\. Great year'), '<p data-line="0">2024. Great year</p>');
  });

  test('{start=N} allows other start numbers', () => {
    assert.match(html('{start=5}\n5. Five\n6. Six'), /<ol start="5"/);
  });

  test('a code block inside a numbered item keeps the list together', () => {
    const out = html('1. Install:\n\n   ```bash\n   npm i\n   ```\n\n2. Run');
    assert.equal(count(out, '<ol'), 1);
    assert.equal(count(out, '<li'), 2);
    assert.match(out, /<code class="language-bash">npm i\n<\/code>/);
  });

  test('nesting is relative to the parent marker', () => {
    const out = html('- one\n  - two\n      - three');
    assert.equal(count(out, '<ul'), 3);
  });

  test('task items render disabled checkboxes', () => {
    const out = html('- [ ] todo\n- [x] done');
    assert.match(out, /<input type="checkbox" disabled> todo/);
    assert.match(out, /<input type="checkbox" disabled checked> done/);
  });

  test('a list can start directly after a paragraph line', () => {
    const out = html('Steps:\n- one\n- two');
    assert.match(out, /<p data-line="0">Steps:<\/p>/);
    assert.equal(count(out, '<li'), 2);
  });
});

describe('inline formatting', () => {
  test('emphasis family', () => {
    assert.equal(
      html('*i* _i_ **b** __b__ ++u++ ~~s~~ ~s~ ==h== H_{2}O x^{2} y^10'),
      '<p data-line="0"><em>i</em> <em>i</em> <strong>b</strong> <strong>b</strong> <u>u</u> <del>s</del> <del>s</del> <mark>h</mark> H<sub>2</sub>O x<sup>2</sup> y<sup>10</sup></p>',
    );
  });

  test('scripts need a preceding character', () => {
    assert.equal(html('a _{x} ^{y}'), '<p data-line="0">a _{x} ^{y}</p>');
    assert.match(html('e^-1'), /e<sup>-1<\/sup>/);
  });

  test('bold italic', () => {
    assert.match(html('***both***'), /<em><strong>both<\/strong><\/em>/);
  });

  test('spaced markers stay literal', () => {
    assert.equal(html('2 * 3 * 4'), '<p data-line="0">2 * 3 * 4</p>');
    assert.equal(html('C++ and C++'), '<p data-line="0">C++ and C++</p>');
  });

  test('intraword underscores stay literal', () => {
    assert.equal(html('snake_case and file_name_here'), '<p data-line="0">snake_case and file_name_here</p>');
  });

  test('bold next to text', () => {
    assert.match(html('**bold**text'), /<strong>bold<\/strong>text/);
  });

  test('code spans with backticks inside', () => {
    assert.match(html('`` a`b ``'), /<code>a`b<\/code>/);
  });

  test('escapes', () => {
    assert.equal(html('\\*not\\* \\# x'), '<p data-line="0">*not* # x</p>');
  });
});

describe('links and images', () => {
  test('bare URLs become links', () => {
    assert.match(html('see https://example.com.'), /<a href="https:\/\/example\.com">https:\/\/example\.com<\/a>\./);
  });

  test('wikilinks', () => {
    assert.match(html('[[guide#Install|setup]]'), /<a href="guide\.yamd#install" class="wikilink">setup<\/a>/);
  });

  test('reference links', () => {
    assert.match(html('[docs][d]\n\n[d]: https://x.dev "X"'), /<a href="https:\/\/x\.dev" title="X">docs<\/a>/);
  });

  test('image with attributes becomes a figure', () => {
    const out = html('![Diagram](a.png){width=300 align=center caption="Overview" #fig:a}');
    assert.match(out, /<figure id="fig:a" class="figure align-center"/);
    assert.match(out, /<img src="a\.png" alt="Diagram" width="300">/);
    assert.match(out, /<figcaption>Figure 1: Overview<\/figcaption>/);
  });

  test('spans with attributes', () => {
    assert.match(html('[red]{color=red .x}'), /<span class="x" style="color: red">red<\/span>/);
  });
});

describe('safe output', () => {
  test('dangerous HTML is removed', () => {
    const out = html('<script>alert(1)</script>\n\n<img src=x onerror=alert(1)>');
    assert.doesNotMatch(out, /<script|alert|onerror/);
  });

  test('allowed HTML is kept', () => {
    assert.match(html('<details><summary>More</summary>\n\nHidden\n\n</details>'), /<details><summary>More<\/summary>/);
    assert.match(html('Press <kbd>Ctrl</kbd>'), /<kbd>Ctrl<\/kbd>/);
  });

  test('unsafe URL schemes are dropped', () => {
    const out = html('[x](javascript:alert(1))');
    assert.doesNotMatch(out, /href/);
    assert.match(out, /<span class="unsafe-link">x<\/span>/);
  });

  test('attribute values are escaped', () => {
    assert.doesNotMatch(html('[x](a "b\\" onclick=\\"c")'), /onclick="/);
    assert.doesNotMatch(html('## T {#a"b}'), /id="a"b"/);
  });

  test(':::html is not rendered', () => {
    const out = html(':::html\n<b>hi</b>\n:::');
    assert.doesNotMatch(out, /<b>/);
    assert.match(out, /&lt;b&gt;hi&lt;\/b&gt;/);
  });
});

describe('tables', () => {
  test('escaped pipes inside code do not split cells', () => {
    const out = html('| A | B |\n| - | - |\n| `a\\|b` | c |');
    assert.equal(count(out, '<td'), 2);
    assert.match(out, /<code>a\|b<\/code>/);
  });

  test('escaped pipes do not split cells', () => {
    assert.equal(count(html('| A |\n| - |\n| a \\| b |'), '<td'), 1);
  });

  test('captions and alignment', () => {
    const out = html('{caption="Pricing" #tbl:p}\n| A | B |\n| :- | -: |\n| 1 | 2 |');
    assert.match(out, /<table id="tbl:p"/);
    assert.match(out, /<caption>Table 1: Pricing<\/caption>/);
    assert.match(out, /<td align="right">2<\/td>/);
  });

  test('colspan', () => {
    assert.match(html('| A | B |\n| - | - |\n| wide {colspan=2} |'), /<td colspan="2">wide<\/td>/);
  });

  test('list tables', () => {
    const out = html(':::table {header=1}\n- - H1\n  - H2\n- - a\n  - - x\n    - y\n- - wide {colspan=2}\n:::');
    assert.match(out, /<thead><tr data-line="1"><th>H1<\/th><th>H2<\/th><\/tr><\/thead>/);
    assert.match(out, /<td colspan="2">wide<\/td>/);
    assert.match(out, /<td><ul data-line="4">/);
  });
});

describe('directives', () => {
  test('callouts', () => {
    const out = html(':::warning {title="Careful"}\nBody\n:::');
    assert.match(out, /class="callout callout-warning"/);
    assert.match(out, /<p class="callout-title">Careful<\/p>/);
  });

  test('unknown containers render their content', () => {
    assert.match(html(':::x-acme-chart\nInside\n:::'), /<p data-line="1">Inside<\/p>/);
  });

  test('nested containers with more colons', () => {
    const out = html('::::columns\n:::column\nA\n:::\n:::column\nB\n:::\n::::');
    assert.equal(count(out, 'class="column"'), 2);
  });

  test('table of contents', () => {
    const out = html('::toc{depth=2}\n\n# A\n\n## B\n\n### C');
    assert.match(out, /<nav class="toc"/);
    // A single H1 is the title, so the contents leave it out.
    assert.doesNotMatch(out, /href="#a"/);
    assert.match(out, /href="#b"/);
    assert.doesNotMatch(out, /href="#c"/);
    assert.match(html('::toc\n\n# A\n\n# B'), /href="#a"[\s\S]*href="#b"/);
  });

  test('highlight.js and KaTeX output is safe', () => {
    const code = highlight('const s = "<img src=x onerror=alert(1)>";', 'js') ?? '';
    assert.match(code, /hljs-string/);
    assert.doesNotMatch(code, /<img/);
    const math = renderMath('\\href{javascript:alert(1)}{x} \\frac{1}{2}', false) ?? '';
    assert.match(math, /class="katex"/);
    // The TeX source appears as escaped text in an <annotation>, but no link is made.
    assert.doesNotMatch(math, /href=|<a /);
    assert.equal(highlight('x', 'not-a-language'), undefined);
  });

  test('highlighting and math hooks', () => {
    const out = render(parse('```js\nlet a\n```\n\n$x^2$'), {
      highlight: (code, lang) => `<b>${lang}:${code}</b>`,
      renderMath: (tex, display) => `<i>${display}:${tex}</i>`,
    });
    assert.match(out, /<div class="code-header"><span class="code-lang">js<\/span><\/div><pre><code class="language-js"><b>js:let a<\/b>/);
    assert.match(out, /<span class="math-inline"><i>false:x\^2<\/i><\/span>/);
  });

  test('inline directives', () => {
    assert.match(html('Press :kbd[Ctrl+S]'), /<kbd>Ctrl\+S<\/kbd>/);
    assert.match(html(':abbr[HTML]{title="HyperText"}'), /<abbr title="HyperText">HTML<\/abbr>/);
  });
});

describe('front matter and variables', () => {
  test('front matter is not rendered', () => {
    assert.doesNotMatch(html('---\ntitle: T\n---\nBody'), /title: T/);
  });

  test('variables are substituted', () => {
    assert.match(html('---\nvars: {support: {email: a@b.c}}\n---\n{{ support.email }}'), /a@b\.c/);
  });

  test('built-in variables', () => {
    assert.match(html('---\nauthor: [Ada, Alan]\n---\nBy {{ author }}'), /By Ada, Alan/);
  });

  test('undefined variables render literally', () => {
    assert.match(html('{{ missing }}'), /\{\{ missing \}\}/);
  });

  test('variables in code are not substituted', () => {
    assert.match(html('---\nvars: {v: 1}\n---\n`{{ v }}`'), /<code>\{\{ v \}\}<\/code>/);
  });
});

describe('comments and review markup', () => {
  test('comments are removed entirely', () => {
    assert.doesNotMatch(html('a %% secret note %% b'), /secret/);
    assert.doesNotMatch(html('%% secret\nmultiline %%\n\nText'), /secret|multiline/);
  });

  test('substitution', () => {
    assert.match(html('{~~old~>new~~}'), /<del class="review-del">old<\/del><ins class="review-ins">new<\/ins>/);
  });

  test('insert, delete and comments', () => {
    const out = html('{++add++} {--cut--} {==this==}{>>why?<<}');
    assert.match(out, /<ins class="review-ins">add<\/ins>/);
    assert.match(out, /<del class="review-del">cut<\/del>/);
    assert.match(out, /<mark class="review-mark">this<\/mark><span class="review-comment">why\?<\/span>/);
  });
});

describe('footnotes and cross-references', () => {
  test('footnotes are numbered by first reference', () => {
    const out = html('B[^b] A[^a]\n\n[^a]: Note A\n[^b]: Note B');
    assert.match(out, /B<sup class="footnote-ref"><a href="#fn-1"/);
    assert.match(out, /A<sup class="footnote-ref"><a href="#fn-2"/);
    assert.match(out, /<li id="fn-1"><p data-line="3">Note B/);
  });

  test('inline footnotes share the numbering', () => {
    assert.match(html('x[^a] y^[inline]\n\n[^a]: A'), /<li id="fn-2"><p>inline/);
  });

  test('cross-references show type and number', () => {
    const out = html(
      '![One](1.png){caption="First" #fig:one}\n\n![Two](2.png){caption="Second" #fig:arch}\n\nSee [@fig:arch].',
    );
    assert.match(out, /<a class="xref" href="#fig:arch">Figure 2<\/a>/);
  });
});

describe('ref= references', () => {
  test('a span with a ref attribute renders as a real link to its target', () => {
    const out = html('[mitosis]{ref=def-mitosis}');
    assert.match(out, /<a href="#def-mitosis">mitosis<\/a>/);
  });

  test('a span without a ref attribute is unaffected', () => {
    const out = html('[small print]{.muted}');
    assert.match(out, /<span class="muted">small print<\/span>/);
  });

  test('a ref attribute combines with other attributes on the same span', () => {
    const out = html('[mitosis]{.key-term ref=def-mitosis}');
    assert.match(out, /<a href="#def-mitosis" class="key-term">mitosis<\/a>/);
  });

  test('an element with a block ID keeps its id for use as a ref target', () => {
    const out = html('Mitosis is nuclear division. ^def-mitosis');
    assert.match(out, /<p id="\^def-mitosis"/);
  });

  test('ref can target a block ID, kept with its caret', () => {
    const out = html('[mitosis]{ref=^def-mitosis}');
    assert.match(out, /<a href="#\^def-mitosis">mitosis<\/a>/);
  });
});

describe('{#id}-labeled paragraphs', () => {
  test('a leading {#id} labels the paragraph, consuming the attrs and not showing them as text', () => {
    const out = html('{#a}\nStart');
    assert.match(out, /<p id="a" data-line="1">Start<\/p>/);
  });

  test('{#id} and the paragraph text can share one line', () => {
    const out = html('{#a} Start\n\n{#b} Receive request');
    assert.match(out, /<p id="a" data-line="0">Start<\/p>/);
    assert.match(out, /<p id="b" data-line="2">Receive request<\/p>/);
  });

  test('a leading attribute list can combine an id with other attributes', () => {
    const out = html('{.muted #a} Start');
    assert.match(out, /<p id="a" class="muted" data-line="0">Start<\/p>/);
  });

  test('braces that do not parse as attrs stay literal, even at the start of a line', () => {
    const out = html('{2+2=4} rest of the line');
    assert.match(out, /<p data-line="0">\{2\+2=4\} rest of the line<\/p>/);
  });
});

describe('fallbacks', () => {
  test('math is shown as source', () => {
    assert.match(html('$E = mc^2$'), /<code class="math">E = mc\^2<\/code>/);
    assert.match(html('$$\nx^2\n$$'), /<div class="math-block" data-line="0"><code class="math">x\^2<\/code><\/div>/);
  });

  test('prices are not math', () => {
    assert.equal(html('$5 and $10'), '<p data-line="0">$5 and $10</p>');
  });

  test('citations', () => {
    assert.match(html('[@lamport1978]'), /<span class="citation">\[lamport1978\]<\/span>/);
  });

  test('an unknown leaf directive (e.g. the retired ::include) degrades to its label as text', () => {
    assert.match(html('::include[changelog.yamd]'), /<p data-line="0">changelog\.yamd<\/p>/);
  });

  test('mermaid', () => {
    assert.match(html('```mermaid\ngraph LR\n```'), /diagram-fallback/);
  });
});
