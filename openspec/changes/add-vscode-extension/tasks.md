# Tasks

## 1. Scaffolding

- [x] 1.1 Create `vscode-yamd/` with `package.json`, `tsconfig.json` (strict), esbuild build script and `.vscodeignore`; verify `npm install` succeeds
- [x] 1.2 Add `build`, `watch`, `typecheck`, `test` and `package` npm scripts; verify `npm run typecheck` and `npm run build` succeed on a stub `extension.ts`

## 2. Core parser and renderer

- [x] 2.1 Implement front matter extraction and variable lookup with the `yaml` package; verify with tests for nested `vars`, built-ins and undefined names
- [x] 2.2 Implement the slug algorithm and duplicate-ID handling; verify the heading ID scenarios pass
- [x] 2.3 Implement the block parser (paragraphs, headings, lists, quotes, fences, thematic breaks, pipe tables, math blocks, directives, attribute lines, footnote and reference definitions, comments) with source line ranges; verify the list, heading and unclosed-construct scenarios pass
- [x] 2.4 Implement the inline parser (emphasis family, code spans, links, wikilinks, images, autolinks, spans, footnotes, cross-references, citations, variables, review markup, inline directives, escapes, inline math); verify the inline formatting scenarios pass
- [x] 2.5 Implement the HTML renderer with escaping, the URL allow-list, figures and table captions with numbering, list tables, standard directives, table of contents, footnotes and fallbacks; verify every `yamd-rendering` scenario has a passing test
- [x] 2.6 Add a regression test that renders `examples/getting-started.yamd` without throwing and with no `<script>` element; verify it passes

## 3. Linter

- [x] 3.1 Implement the syntax rules Y101, Y201, Y301, Y401, Y501 and Y601; verify with one test per rule, including the code-excluded case
- [x] 3.2 Implement the link rules Y701 and Y901 using a `fileExists` callback; verify missing-anchor, missing-file and external-link tests pass
- [x] 3.3 Implement the accessibility rules Y702 to Y707 and the variable rule Y801; verify every `document-diagnostics` scenario that doesn't need VS Code has a passing test

## 4. Language support

- [ ] 4.1 Register the `yamd` language in `package.json` and add `language-configuration.json` (`%% %%` comments, brackets, auto-closing pairs); verify `examples/getting-started.yamd` opens in YAMD mode and Toggle Block Comment wraps a selection in `%% %%`
- [x] 4.2 Write the TextMate grammar with embedded fence languages; verify with Developer: Inspect Editor Tokens and Scopes on each construct in `examples/getting-started.yamd`, including that `snake_case` gets no emphasis scope
- [ ] 4.3 Add snippets for front matter, callouts, details, columns, list table, pipe table, code fence, math block, figure and review markup; verify each prefix inserts the expected text
- [ ] 4.4 Implement the toggle-formatting commands and keybindings; verify the add, remove and empty-selection behavior by hand
- [ ] 4.5 Implement the Enter list-continuation command with the `yamd.editor.listContinuation` setting; verify the bullet, numbered, task and end-of-list scenarios by hand

## 5. Preview

- [ ] 5.1 Implement the preview panel with the open commands, editor title button, panel reuse, CSP with a nonce, and theme-aware CSS; verify the preview opens beside `examples/getting-started.yamd` in light and dark themes
- [ ] 5.2 Add live updates (debounced) and following the active YAMD editor; verify typing and switching files update the preview without saving
- [ ] 5.3 Add image path resolution through `asWebviewUri` and alt-text fallback for missing images; verify a relative image shows and a missing one shows its alt text
- [ ] 5.4 Add scroll sync with `data-line` attributes and link handling (external, anchor, workspace file); verify each link scenario by hand

## 6. Diagnostics integration

- [ ] 6.1 Wire the linter into a `DiagnosticCollection` with debounced updates, clearing on close, and the `yamd.diagnostics.enabled` and `yamd.diagnostics.ignore` settings; verify diagnostics appear on `examples/getting-started.yamd`, update as you type, and respect the ignore list

## 7. Packaging and docs

- [x] 7.1 Write `vscode-yamd/README.md` covering features, commands, settings and how to build; verify the build steps work as written
- [ ] 7.2 Package with `vsce package` and install the `.vsix` locally; verify the extension activates on `examples/getting-started.yamd` with all features working

## Workflow follow-up

- Archive the change with `/opsx:archive` after review.
