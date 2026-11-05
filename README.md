# YAMD — Markdown with widgets

YAMD adds boards, calendars, timelines, galleries and SQL query views to plain Markdown notes, plus callouts for study notes, cross-references and citations, a generated table of contents and bibliography, HTML and slide export, and study tools. Notes stay ordinary `.md` files; without the extension a widget is just a code block, so nothing breaks on GitHub or in another editor.

````markdown
```kanban sprint-12
## Todo
- [ ] Write the release notes {due=2026-12-14}

## Done
- [x] Kick-off meeting
```
````

In VS Code, a link above the block opens it as a draggable board beside the note, and every edit rewrites the block in the note.

## What's in the box

- **[vscode-yamd/](vscode-yamd/)** — the VS Code extension (1.145 or later). See [vscode-yamd/README.md](vscode-yamd/README.md) for the features and settings.
- **[yamd-1.2.0-spec.md](yamd-1.2.0-spec.md)** — the 1.2 specification and its decision log, with the [implementation plan](yamd-1.2.0-plan.md).
- **[examples/](examples/)** — a working note for every feature, with the data files they use. Start with [examples/getting-started.md](examples/getting-started.md).
- **[docs/0.1/](docs/0.1/)** — the archived 0.1 specification (the former `.yamd` language) and the Markdown pain-point notes behind it.
- **[openspec/](openspec/)** — the spec-driven change proposals from the 0.1 design.

## Installing the extension

YAMD isn't on the VS Code Marketplace yet, so build the `.vsix` from source. You'll need [Node.js](https://nodejs.org) 20+, [VS Code](https://code.visualstudio.com) with its `code` command on PATH, and `make`.

```bash
git clone https://github.com/appmonster007/yamd.git
cd yamd
make install
```

`make install` builds the extension, runs the tests, packages a `.vsix` and installs it. Installing also brings in the companion extensions (Foam, a SQLite editor, two CSV extensions and Markdown tooling). Reload VS Code afterwards. `make help` lists every target.

### Try it out

Open [examples/README.md](examples/README.md) and follow "Try it": open a kanban board, run a query, run **YAMD: Build** on the references note, and export a page.

### Working on the extension

Open `vscode-yamd/` in VS Code and press F5 to start an Extension Development Host. The code layout is described in [CONTRIBUTING.md](CONTRIBUTING.md).

```bash
make deps       # npm install
make build      # bundle into vscode-yamd/dist/
make typecheck
make test
```

## What changed from 0.1

YAMD is no longer a separate language: there are no `.yamd` files, custom preview or editor, `.ydb` databases, document variables or DOCX export. Use Foam for wikilinks and the graph, and the companion SQLite and CSV extensions for editing data.

## Contributing

See [CONTRIBUTING.md](CONTRIBUTING.md) and the [Code of Conduct](CODE_OF_CONDUCT.md).

## License

YAMD is licensed under the [MIT License](LICENSE).
