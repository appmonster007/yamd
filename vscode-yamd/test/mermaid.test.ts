import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mermaidFence } from '../src/core/markdown/mermaidFence';
import { parse, render } from '../src/core/markdown';

function fakeMd() {
  const calls: string[] = [];
  const md = {
    renderer: { rules: { fence: (t: { content: string }[], i: number) => (calls.push('original'), `<pre><code>${t[i]?.content}</code></pre>`) } as unknown as Record<string, Function> },
    utils: { escapeHtml: (s: string) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;') },
  };
  return { md, calls };
}
const token = (info: string, content: string) => {
  const classes: string[] = [];
  return { info, content, attrJoin: (_n: string, v: string) => classes.push(v), classes } as never;
};
const self = { renderAttrs: (t: { classes?: string[] }) => ` class="code-line ${(t.classes ?? []).join(' ')}"` };

test('a mermaid fence becomes a diagram holder, with its source escaped', () => {
  const { md } = fakeMd();
  mermaidFence(md as never);
  const rule = (md.renderer.rules as unknown as Record<string, Function>)['fence'] as Function;
  const html = rule([token('mermaid', 'A --> B\n')], 0, {}, {}, self);
  assert.equal(html, '<pre class="code-line yamd-mermaid"><code>A --&gt; B\n</code></pre>\n');
});

test('other fences keep their own rendering', () => {
  const { md, calls } = fakeMd();
  mermaidFence(md as never);
  const rule = (md.renderer.rules as unknown as Record<string, Function>)['fence'] as Function;
  assert.match(rule([token('js', 'x')], 0, {}, {}, self), /<pre><code>x/);
  assert.deepEqual(calls, ['original']);
});

test('exports keep the diagram source in a language-mermaid block for the page script', () => {
  const html = render(parse('```mermaid\nflowchart LR\n  A --> B\n```', 'gfm'), {});
  assert.match(html, /<code class="language-mermaid">/);
  assert.match(html, /A --&gt; B/);
});
