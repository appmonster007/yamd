/**
 * Syntax highlighting (highlight.js) and math (KaTeX) for the preview. Both produce HTML from
 * escaped text: highlight.js escapes the code it wraps, and KaTeX runs with `trust: false`, so
 * commands such as \href and \includegraphics can't add links or load files.
 */
import hljs from 'highlight.js/lib/core';
import bash from 'highlight.js/lib/languages/bash';
import c from 'highlight.js/lib/languages/c';
import cpp from 'highlight.js/lib/languages/cpp';
import csharp from 'highlight.js/lib/languages/csharp';
import css from 'highlight.js/lib/languages/css';
import diff from 'highlight.js/lib/languages/diff';
import dockerfile from 'highlight.js/lib/languages/dockerfile';
import go from 'highlight.js/lib/languages/go';
import ini from 'highlight.js/lib/languages/ini';
import java from 'highlight.js/lib/languages/java';
import javascript from 'highlight.js/lib/languages/javascript';
import json from 'highlight.js/lib/languages/json';
import kotlin from 'highlight.js/lib/languages/kotlin';
import markdown from 'highlight.js/lib/languages/markdown';
import php from 'highlight.js/lib/languages/php';
import plaintext from 'highlight.js/lib/languages/plaintext';
import powershell from 'highlight.js/lib/languages/powershell';
import python from 'highlight.js/lib/languages/python';
import ruby from 'highlight.js/lib/languages/ruby';
import rust from 'highlight.js/lib/languages/rust';
import scss from 'highlight.js/lib/languages/scss';
import shell from 'highlight.js/lib/languages/shell';
import sql from 'highlight.js/lib/languages/sql';
import swift from 'highlight.js/lib/languages/swift';
import typescript from 'highlight.js/lib/languages/typescript';
import xml from 'highlight.js/lib/languages/xml';
import yaml from 'highlight.js/lib/languages/yaml';
import katex from 'katex';

const LANGUAGES = {
  bash, c, cpp, csharp, css, diff, dockerfile, go, ini, java, javascript, json, kotlin, markdown,
  php, plaintext, powershell, python, ruby, rust, scss, shell, sql, swift, typescript, xml, yaml,
};
for (const [name, lang] of Object.entries(LANGUAGES)) hljs.registerLanguage(name, lang);
// YAMD reads like Markdown; .ydb files are YAML.
hljs.registerAliases(['yamd'], { languageName: 'markdown' });
hljs.registerAliases(['ydb'], { languageName: 'yaml' });
hljs.registerAliases(['terminal', 'console', 'sh', 'zsh'], { languageName: 'bash' });
hljs.registerAliases(['html', 'svg'], { languageName: 'xml' });
hljs.registerAliases(['toml'], { languageName: 'ini' });
hljs.registerAliases(['query'], { languageName: 'sql' });

/** Highlighted HTML for `code`, or undefined when the language isn't known. */
export function highlight(code: string, lang: string): string | undefined {
  const name = lang.toLowerCase();
  if (!hljs.getLanguage(name)) return undefined;
  try {
    return hljs.highlight(code, { language: name, ignoreIllegals: true }).value;
  } catch {
    return undefined;
  }
}

/** KaTeX HTML for `tex`. Errors render in place (in red) rather than failing the document. */
export function renderMath(tex: string, display: boolean): string | undefined {
  try {
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
