/**
 * Syntax highlighting (highlight.js) and math (KaTeX) for the preview. Both produce HTML from
 * escaped text: highlight.js escapes the code it wraps, and KaTeX runs with `trust: false`, so
 * commands such as \href and \includegraphics can't add links or load files.
 *
 * Both libraries are loaded on first use rather than at startup: registering the languages and
 * evaluating KaTeX costs tens of milliseconds, and most sessions never open a preview right away.
 */
import type { HLJSApi } from 'highlight.js';
import type KatexModule from 'katex';

type LanguageModule = { default?: LanguageFn } & LanguageFn;
type LanguageFn = Parameters<HLJSApi['registerLanguage']>[1];

/**
 * Each language is a literal `require`, so the bundler includes it; the call itself runs only when
 * the highlighter is first used.
 */
const LANGUAGES: Record<string, () => LanguageModule> = {
  bash: () => require('highlight.js/lib/languages/bash') as LanguageModule,
  c: () => require('highlight.js/lib/languages/c') as LanguageModule,
  cpp: () => require('highlight.js/lib/languages/cpp') as LanguageModule,
  csharp: () => require('highlight.js/lib/languages/csharp') as LanguageModule,
  css: () => require('highlight.js/lib/languages/css') as LanguageModule,
  diff: () => require('highlight.js/lib/languages/diff') as LanguageModule,
  dockerfile: () => require('highlight.js/lib/languages/dockerfile') as LanguageModule,
  go: () => require('highlight.js/lib/languages/go') as LanguageModule,
  ini: () => require('highlight.js/lib/languages/ini') as LanguageModule,
  java: () => require('highlight.js/lib/languages/java') as LanguageModule,
  javascript: () => require('highlight.js/lib/languages/javascript') as LanguageModule,
  json: () => require('highlight.js/lib/languages/json') as LanguageModule,
  kotlin: () => require('highlight.js/lib/languages/kotlin') as LanguageModule,
  markdown: () => require('highlight.js/lib/languages/markdown') as LanguageModule,
  php: () => require('highlight.js/lib/languages/php') as LanguageModule,
  plaintext: () => require('highlight.js/lib/languages/plaintext') as LanguageModule,
  powershell: () => require('highlight.js/lib/languages/powershell') as LanguageModule,
  python: () => require('highlight.js/lib/languages/python') as LanguageModule,
  ruby: () => require('highlight.js/lib/languages/ruby') as LanguageModule,
  rust: () => require('highlight.js/lib/languages/rust') as LanguageModule,
  scss: () => require('highlight.js/lib/languages/scss') as LanguageModule,
  shell: () => require('highlight.js/lib/languages/shell') as LanguageModule,
  sql: () => require('highlight.js/lib/languages/sql') as LanguageModule,
  swift: () => require('highlight.js/lib/languages/swift') as LanguageModule,
  typescript: () => require('highlight.js/lib/languages/typescript') as LanguageModule,
  xml: () => require('highlight.js/lib/languages/xml') as LanguageModule,
  yaml: () => require('highlight.js/lib/languages/yaml') as LanguageModule,
};

let hljs: HLJSApi | undefined;
let katex: typeof KatexModule | undefined;

/**
 * A small least-recently-used memo. The preview re-renders the whole note on every edit, and nearly
 * all of its code blocks and equations are unchanged between edits.
 */
class Memo {
  private readonly map = new Map<string, string | undefined>();
  constructor(private readonly limit: number) {}

  get(key: string, compute: () => string | undefined): string | undefined {
    if (this.map.has(key)) {
      const value = this.map.get(key);
      this.map.delete(key);
      this.map.set(key, value);
      return value;
    }
    const value = compute();
    this.map.set(key, value);
    if (this.map.size > this.limit) this.map.delete(this.map.keys().next().value as string);
    return value;
  }
}

const highlighted = new Memo(400);
const typeset = new Memo(400);

function loadHighlighter(): HLJSApi {
  if (hljs) return hljs;
  // `require` keeps these out of the startup path; the bundler still includes them.
  const core = (require('highlight.js/lib/core') as { default?: HLJSApi } & HLJSApi).default ?? (require('highlight.js/lib/core') as HLJSApi);
  for (const [name, load] of Object.entries(LANGUAGES)) {
    const mod = load();
    core.registerLanguage(name, mod.default ?? mod);
  }
  // YAMD reads like Markdown; .ydb files are YAML.
  core.registerAliases(['yamd'], { languageName: 'markdown' });
  core.registerAliases(['ydb'], { languageName: 'yaml' });
  core.registerAliases(['terminal', 'console', 'sh', 'zsh'], { languageName: 'bash' });
  core.registerAliases(['html', 'svg'], { languageName: 'xml' });
  core.registerAliases(['toml'], { languageName: 'ini' });
  core.registerAliases(['query'], { languageName: 'sql' });
  hljs = core;
  return core;
}

/** Highlighted HTML for `code`, or undefined when the language isn't known. */
export function highlight(code: string, lang: string): string | undefined {
  const name = lang.toLowerCase();
  return highlighted.get(`${name}\u0000${code}`, () => {
    const h = loadHighlighter();
    if (!h.getLanguage(name)) return undefined;
    try {
      return h.highlight(code, { language: name, ignoreIllegals: true }).value;
    } catch {
      return undefined;
    }
  });
}

/** KaTeX HTML for `tex`. Errors render in place (in red) rather than failing the document. */
export function renderMath(tex: string, display: boolean): string | undefined {
  return typeset.get(`${display ? 'd' : 'i'}\u0000${tex}`, () => typesetMath(tex, display));
}

function typesetMath(tex: string, display: boolean): string | undefined {
  try {
    katex ??= (require('katex') as { default?: typeof KatexModule } & typeof KatexModule).default ?? (require('katex') as typeof KatexModule);
    return katex.renderToString(tex, {
      displayMode: display,
      throwOnError: false,
      trust: false,
      strict: 'ignore',
      output: 'htmlAndMathml',
      maxExpand: 1000,
      maxSize: 50,
    });
  } catch {
    return undefined;
  }
}
