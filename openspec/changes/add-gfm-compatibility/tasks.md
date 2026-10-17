# Tasks

## 1. Spec and setup

- [x] 1.1 Update `yamd-spec.md`: GFM as the base in §0, the adopted GFM behaviors in §3 and §4, sanitized HTML in §9, a new §13 "Differences from GFM" with examples and fixes, §14 updated, the LaTeX-style `^{...}` and `_{...}` replacing `^...^` and `~...~`, and the codes Y210 and Y212 with the new Y101 and Y201 severities; verify every intentional difference in the `markdown-compatibility` spec has an entry with a before-and-after example
- [x] 1.2 Add the micromark, mdast and hast dependencies and the `commonmark-spec` dev dependency, and vendor `test/fixtures/gfm-extensions.json` from a tagged `cmark-gfm` release; verify `npm run build` bundles them and the size increase is under 200 KB minified

## 2. Conformance harness

- [x] 2.1 Write `test/conformance.test.ts` with HTML normalization, `known-differences.json`, the unlisted-failure and now-passing checks, and pass-rate reporting; verify it runs against a plain GFM micromark pipeline at 100% before any YAMD extension is added

## 3. Core rebuild

- [x] 3.1 Replace the block and inline parser with micromark + mdast (GFM with defaults, front matter, directives, math) plus the newline-is-break transform; verify the conformance test passes with only `newline-is-break` entries listed
- [x] 3.2 Implement the shared emphasis factory with the `mark` and `ins` extensions, and the `script` extension for `^{...}`, `_{...}` and the digit shortcut; verify with unit tests for the emphasis-family, superscript-and-subscript, braces-required and not-after-a-space scenarios, and that the conformance results don't change
- [x] 3.3 Implement the `attributes`, `variable`, `comment`, `critic`, `citation` and `wikilink` extensions; verify the existing renderer tests for those features pass, and that any conformance example they change is listed as `yamd-syntax` and stays within the limit
- [x] 3.4 Rebuild the renderer on hast (YAMD node handlers, `data-line`, figures and tables with numbering, list tables, directives, footnotes, fallbacks) with `hast-util-raw` and the GitHub sanitize schema extended for YAMD; verify every `yamd-rendering` scenario, including the HTML-allowed and script-removed cases, and update the changed assertions in `test/render.test.ts`
- [x] 3.5 Port the linter to mdast positions, change Y101 to a warning and Y201 to information, update the Y401 message, and add Y212; verify the existing lint tests pass with exact ranges and the new severities, and test the changed-marker scenario
- [x] 3.6 Add the parse benchmark (`examples/getting-started.yamd` × 100 in under 1 second); verify it passes

## 4. Migration

- [x] 4.1 Add Y210 with its quick fix (code action); verify with tests for the wrapped-paragraph and poem scenarios, and by hand that the quick fix applies
- [x] 4.2 Implement `convertFromMarkdown` (join wrapped lines, escape YAMD syntax); verify the round-trip test passes for every conformance example
- [ ] 4.3 (implemented in `src/extension/migration.ts`; manual check in VS Code pending) Add "YAMD: Convert from Markdown" and "YAMD: Open Markdown as YAMD" (Explorer context menu, overwrite prompt); verify each `markdown-migration` command scenario by hand

## 5. Examples, docs and release

- [x] 5.1 Update the examples for the adopted GFM behavior (`01-basics/text-and-paragraphs.yamd` underscores and the new superscript and subscript syntax, `code-and-math.yamd`, `getting-started.yamd`, `headings-and-lists.yamd` setext headings, list starts and marker changes, `02-documents/security.yamd` sanitized HTML, `diagnostics.yamd`), and add `examples/06-markdown/` with a GitHub-style README that works unchanged and a page showing each known difference; verify `test/examples.test.ts` passes with the updated expected codes
- [x] 5.2 Update the TextMate grammar and its tests for `^{...}`, `_{...}`, the digit shortcut and single-tilde strikethrough, and update `vscode-yamd/README.md` (compatibility, migration commands, changed diagnostics); verify the documented commands exist in `package.json`
- [ ] 5.3 (typecheck, 178 tests and `npm run package` pass; installing the `.vsix` and the README check are manual) Run typecheck, tests and `npm run package`, then install the `.vsix`; verify a real-world README (for example this repository's `vscode-yamd/README.md` renamed to `.yamd`) renders as it does on GitHub apart from listed differences

## Workflow follow-up

- Archive `add-vscode-extension` before archiving this change.
- Archive this change before `add-linked-notes`, and update that change's parsing tasks to target `src/core/extensions/`.
