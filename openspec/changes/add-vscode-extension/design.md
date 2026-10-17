# Design

## Context

The repo has no code yet: only `yamd-spec.md`, `sample.yamd` and the Markdown notes. See proposal.md for motivation. Requirements are in the four delta specs of this change.

Constraints: TypeScript in strict mode, Node.js 20+, no network access at runtime, and diagnostic codes that match `yamd-spec.md`.

## Goals / Non-Goals

**Goals:**
- One parser shared by the preview and the linter, so they always agree.
- Keep the parser, renderer and linter free of `vscode` imports, so they can be tested with plain Node and later reused by a `yamd` CLI.
- Ship as a single bundled file with no install-time dependencies.

**Non-Goals:**
- Incremental parsing. Documents are reparsed in full on each change, which is fast enough for documents up to a few thousand lines.
- VS Code integration tests (`@vscode/test-electron`). Editor features are checked by hand against `examples/getting-started.yamd` in this change.
- A language server. The linter runs in the extension host.

## Decisions

### 1. A hand-written parser instead of extending markdown-it
YAMD changes core Markdown rules: newlines are breaks, `_` has no meaning, raw HTML is literal, setext headings and indented code are gone, and list rules differ. markdown-it implements CommonMark, so most of its core rules would need to be replaced or turned off, and its HTML output would still have to be checked for safety.
A small two-phase parser is simpler: a block phase builds the tree line by line, and an inline phase parses text within each block. Every node keeps its source range, which the linter and scroll sync need.
*Alternative considered:* markdown-it with plugins. Rejected because of the number of overrides and the risk of CommonMark behavior leaking through.

### 2. Module layout
```
vscode-yamd/
  src/core/        parser, inline parser, renderer, linter, slug, front matter (no vscode imports)
  src/extension/   activation, preview panel, diagnostics provider, commands
  src/preview/     script that runs inside the webview (scroll sync, link clicks)
  media/           preview.css
  syntaxes/        yamd.tmLanguage.json
  snippets/        yamd.code-snippets
  test/            node:test suites for src/core
```

### 3. Front matter parsing with the `yaml` package, bundled
Front matter is YAML, and writing a YAML parser is out of scope. The `yaml` package has no dependencies of its own and is bundled into `dist/extension.js` by esbuild, so the shipped extension still has no runtime dependencies and needs no network.
*Alternative considered:* a minimal key/value parser. Rejected because nested `vars` and lists such as `author: [A, B]` must work.

### 4. esbuild for bundling, tsc for type checking
esbuild bundles `src/extension/extension.ts` to `dist/extension.js` (CommonJS, `vscode` external) and `src/preview/main.ts` to `dist/preview.js` (browser IIFE). `tsc --noEmit` checks types. This keeps builds fast and the package small.

### 5. Tests with `node:test` and `tsx`
Core modules are tested with Node's built-in test runner, loading TypeScript through `tsx`. Each spec scenario in `yamd-rendering` and `document-diagnostics` becomes at least one test. A test renders every file in `examples/` to check that it never throws and that the output has no `<script>` element.

### 6. Renderer safety by construction
The renderer escapes all text and attribute values in one helper and builds HTML only from known tags. URLs pass through one `sanitizeUrl` function that applies the spec's scheme allow-list. Raw HTML is never passed through, so no HTML sanitizer is needed.

### 7. Preview as one webview that follows the active editor
A single `WebviewPanel` is reused. The extension posts the full rendered HTML on each change (debounced by 150 ms), and the webview replaces its body. The panel has:
- A Content Security Policy that only allows the extension's script (with a nonce) and stylesheet, and images from the webview resource origin, `https:` and `http:`.
- `localResourceRoots` set to the workspace folders and the document's folder. The renderer takes an image-URL resolver hook, and the extension uses it to map relative paths through `webview.asWebviewUri`.
- `data-line` attributes on every top-level block, so the webview can scroll to the block matching the editor's first visible line.
- Theme colors from VS Code's `--vscode-*` CSS variables.

### 8. List continuation as an Enter command
`onEnterRules` in `language-configuration.json` can repeat a bullet but can't increment numbers or remove an empty marker. A `yamd.onEnter` command is bound to Enter with `editorLangId == yamd && editorTextFocus && !suggestWidgetVisible && !editorHasMultipleSelections && vim.mode != 'Normal'`. On any line that isn't a list item, it falls back to the default `type` command with a newline.

### 9. Diagnostics provider
A `DiagnosticCollection` named `yamd` is updated on open and change (debounced by 300 ms) and cleared on close. The linter takes the parsed tree and a `fileExists(path)` callback. The extension implements it with `fs.existsSync`, resolved against the document's folder (and the workspace root for `/` paths). Codes in `yamd.diagnostics.ignore` are filtered out afterwards.

### 10. TextMate grammar
A hand-written JSON grammar uses `begin`/`end` rules for front matter, fences, math blocks and directive containers, and `match` rules for inline constructs. Fenced code embeds the grammars of about 20 common languages through `include: source.<lang>` patterns and the `embeddedLanguages` setting.

## Risks / Trade-offs

- [The hand-written parser drifts from the spec] → Tests are written per spec scenario, and every file in `examples/` is used as a regression fixture.
- [Regex-based highlighting can't handle every nested inline case] → Highlighting may be approximate for deeply nested emphasis. The preview and the linter use the real parser.
- [Binding Enter could conflict with other extensions or Vim modes] → Narrow `when` clauses and a fallback to the default newline. The `yamd.editor.listContinuation` setting (default `true`) turns it off.
- [Full re-render on every change is slow for very large files] → Debouncing. Incremental rendering can come later if needed.
- [Remote `http(s)` images in the preview make network requests] → They only load when the author references them explicitly, which the spec allows. Nothing else in the extension makes network requests.

## Migration Plan

Not applicable: this is a new extension. It's packaged with `vsce package` into a `.vsix` and installed locally. Marketplace publishing is a separate decision.

## Open Questions

These spec ambiguities came up while designing. They don't change this plan; the implementation picks the behavior shown and they should be settled in `yamd-spec.md` later.
- **Inline directives:** `:name[` is only treated as a directive at the start of a line or after whitespace, so `Note:[1]` stays text.
- **Decorative images:** the spec doesn't say whether `{decorative}` with non-empty alt text is an error. The extension doesn't report it.
- **Figure numbering:** captioned `:::figure` containers and captioned images share one counter.

Found during implementation:
- **Inline math:** the spec's flanking rules alone would read `$5 and $10 ... $E = mc^2$` as one span. The parser adds one rule: the first unescaped `$` after the opener must be a valid closer, otherwise the opener is literal. So math content never contains `$`.
- **Front matter errors:** invalid YAML front matter is reported as `Y102`, which the spec doesn't define yet. It should be added to the spec's code list, or mapped to an existing code.
- **Ordered list continuation:** the spec says written numbers don't matter, so a `2024.` line after a blank line continues an open ordered list. `sample.yamd` was changed to put that example inside a paragraph instead.
- **List table cells:** trailing `{...}` on a list item's first line belongs to the item, except when the line starts a nested item, so `- - cell {colspan=2}` applies to the cell.
