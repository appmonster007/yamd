/**
 * A markdown-it plugin for VS Code's built-in Markdown preview: a ```mermaid fence becomes
 * `<pre class="yamd-mermaid"><code>…</code></pre>`, which the preview script draws as a diagram.
 * The source stays readable if the script can't run. Typed minimally so it needs no markdown-it import.
 */
interface Token {
  info: string;
  content: string;
  attrJoin(name: string, value: string): void;
}
interface Md {
  renderer: {
    rules: Record<string, ((tokens: Token[], idx: number, options: unknown, env: unknown, self: { renderAttrs(token: Token): string; renderToken?: unknown }) => string) | undefined>;
  };
  utils: { escapeHtml(s: string): string };
}

export function mermaidFence<T extends Md>(md: T): T {
  const original = md.renderer.rules['fence'];
  md.renderer.rules['fence'] = (tokens, idx, options, env, self) => {
    const token = tokens[idx] as Token;
    if (token.info.trim().split(/\s+/)[0] === 'mermaid') {
      token.attrJoin('class', 'yamd-mermaid');
      return `<pre${self.renderAttrs(token)}><code>${md.utils.escapeHtml(token.content)}</code></pre>\n`;
    }
    return original ? original(tokens, idx, options, env, self) : `<pre><code>${md.utils.escapeHtml(token.content)}</code></pre>\n`;
  };
  return md;
}
