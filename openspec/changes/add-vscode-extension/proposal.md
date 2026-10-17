# Proposal

## Why

YAMD exists only as a spec and a sample file: nothing can highlight, check, or preview a `.yamd` document, so the format cannot be tried in practice. A VS Code extension is the fastest way to make YAMD usable and to validate the spec's design decisions against real editing.

## What Changes

- New VS Code extension in `vscode-yamd/`, written in TypeScript, that registers the `yamd` language for `.yamd` files.
- Syntax highlighting (TextMate grammar) for every construct in `yamd-spec.md`: front matter, headings, emphasis family, lists, tasks, quotes, fences, tables, directives, attributes, math, variables, comments, review markup, footnotes, citations and wikilinks.
- Editor behavior: comment toggling with `%% %%`, bracket and marker auto-closing, list continuation on Enter, snippets for common constructs, and keyboard shortcuts to toggle bold, italic and underline.
- A TypeScript parser that turns YAMD into a document tree plus diagnostics, shared by the preview and the linter.
- Live HTML preview in a side panel that updates as you type and follows the editor's scroll position.
- Inline diagnostics for a subset of the spec's codes (syntax, links within the workspace, variables, accessibility).

Out of scope for this change: the `yamd` CLI, the formatter (`yamd fmt`), rendering math, Mermaid diagrams, citations and embeds (these show as styled source or links), and resolving `::include`.

## Capabilities

### New Capabilities
- `editor-language-support`: registering the YAMD language in VS Code, syntax highlighting, editing behavior, snippets and formatting shortcuts.
- `yamd-rendering`: converting YAMD source to HTML according to the Core conformance level of `yamd-spec.md`, with defined fallbacks for Full-level features.
- `document-preview`: the live preview panel and how it stays in sync with the editor.
- `document-diagnostics`: which spec diagnostic codes the editor reports, when, and with what severity.

### Modified Capabilities

None. There are no existing specs.

## Impact

- New folder `vscode-yamd/` with its own `package.json`, TypeScript sources, grammar, snippets and tests.
- Dev dependencies: `typescript`, `@types/vscode`, `@types/node`, `esbuild`, `@vscode/vsce`, and a test runner. There are no runtime dependencies, so the extension works offline.
- No changes to `yamd-spec.md` are required. Any ambiguity found while implementing is recorded in `design.md` as an open question.
