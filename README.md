# YAMD — Yet Another Markdown

YAMD is a plain-text markup format that keeps Markdown's simplicity and fixes its pain points — ambiguous line breaks, no standard front matter, no tracked changes, no built-in citations, lossy conversion to Word or HTML, and more. It's a strict superset of GitHub Flavored Markdown: existing Markdown renders exactly as it does on GitHub, except that a newline is always a line break and YAMD's own syntax is recognized.

This repository holds the format's specification and a full-featured VS Code extension.

```yamd
---
title: Why YAMD?
tags: [format, markdown]
lang: en
---

# Why YAMD?

Markdown is great until you need {++tracked changes++}, a `due: 2026-11-01`
in the front matter, or $E = mc^2$ without a plugin. YAMD adds exactly
the things people keep bolting onto Markdown — and nothing else.

::toc{depth=2}
```

## What's in the box

- **[yamd-spec.md](yamd-spec.md)** — the format specification: block and inline syntax, directives, attributes, review markup, security and accessibility rules, and the full list of differences from GFM.
- **[vscode-yamd/](vscode-yamd/)** — the VS Code extension: syntax highlighting, a live preview with KaTeX math and syntax-highlighted code, diagnostics, linked notes (wikilinks, backlinks, a graph view), databases (`.ydb` and SQLite) with table/list/gallery/calendar/board views, kanban boards, and a full set of tools for students and academic writing (flashcards with spaced repetition, course deadlines, citations, export to HTML/PDF/Word/Slides, and more). See [vscode-yamd/README.md](vscode-yamd/README.md) for the complete feature list.
- **[examples/](examples/)** — a worked example for every feature, organized by topic. Start with [examples/getting-started.yamd](examples/getting-started.yamd).
- **[openspec/](openspec/)** — the spec-driven change proposals the format and extension were built from, each with a proposal, a task list and the resulting spec deltas.

## Getting started

1. Install [Node.js](https://nodejs.org) 20 or later.
2. Open `vscode-yamd/` in VS Code and press F5 to launch the extension in a new Extension Development Host window, with this repository as the workspace.
3. Open `examples/getting-started.yamd` and run **YAMD: Open Preview to the Side** (Cmd+K V / Ctrl+K V) to see it rendered.
4. Browse `examples/` by topic — basics, documents, linked notes, databases, kanban, moving from Markdown, and study features — or read `yamd-spec.md` for the full reference.

To build and test the extension from the command line:

```bash
cd vscode-yamd
npm install
npm run build       # generate the grammar and bundle into dist/
npm test            # parser, renderer, linter, grammar, editing and conformance tests
npm run package     # type-check, test and build a .vsix
```

## Status

YAMD is under active development. The format and the extension both already implement the features described in `yamd-spec.md` and `vscode-yamd/README.md`; some advanced interactions (PDF math/image fidelity, runnable code blocks, mobile capture) are tracked as open proposals in `openspec/changes/`.

## Contributing

Contributions are welcome — see [CONTRIBUTING.md](CONTRIBUTING.md) for how the project is organized, how changes are proposed and reviewed, and how to run the tests. Please also read the [Code of Conduct](CODE_OF_CONDUCT.md).

## License

YAMD is licensed under the [MIT License](LICENSE).
