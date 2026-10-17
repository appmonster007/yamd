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

## Installing the extension

YAMD isn't on the VS Code Marketplace yet, so install it by building the `.vsix` from source. You'll need [Node.js](https://nodejs.org) 20+, [VS Code](https://code.visualstudio.com) with its `code` command on PATH, and `make` (preinstalled on macOS and Linux).

```bash
git clone https://github.com/appmonster007/yamd.git
cd yamd
make install
```

`make install` builds the extension, runs the test suite, packages a `.vsix` and installs it into VS Code in one step. Reload or restart VS Code afterwards to activate it.

If `code` isn't on PATH, run **Shell Command: Install 'code' command in PATH** from VS Code's Command Palette and try again — or build the `.vsix` with `make package` and install it by hand from the Extensions view (`...` menu → **Install from VSIX...** → `vscode-yamd/vscode-yamd-<version>.vsix`).

Run `make help` for every available target (`build`, `typecheck`, `test`, `package`, `install`, `uninstall`, `dev`, `clean`).

### Try it out

1. Open any file in `examples/` in VS Code — start with [examples/getting-started.yamd](examples/getting-started.yamd).
2. Run **YAMD: Open Preview to the Side** (Cmd+K V / Ctrl+K V) to see it rendered.
3. Browse `examples/` by topic — basics, documents, linked notes, databases, kanban, moving from Markdown, and study features — or read `yamd-spec.md` for the full reference.

### Working on the extension itself

To iterate on the extension's source without reinstalling each time, open `vscode-yamd/` in VS Code and press F5 — this launches an Extension Development Host window with your changes loaded and the repository root as its workspace.

```bash
make deps       # npm install
make build      # compile into vscode-yamd/dist/
make typecheck
make test
```

(Each target also works as a plain `npm` script inside `vscode-yamd/` — see [vscode-yamd/README.md](vscode-yamd/README.md#development).)

## Status

YAMD is under active development. The format and the extension both already implement the features described in `yamd-spec.md` and `vscode-yamd/README.md`; some advanced interactions (PDF math/image fidelity, runnable code blocks, mobile capture) are tracked as open proposals in `openspec/changes/`.

## Contributing

Contributions are welcome — see [CONTRIBUTING.md](CONTRIBUTING.md) for how the project is organized, how changes are proposed and reviewed, and how to run the tests. Please also read the [Code of Conduct](CODE_OF_CONDUCT.md).

## License

YAMD is licensed under the [MIT License](LICENSE).
