# Contributing to YAMD

Thanks for your interest in YAMD. This document covers how the repository is organized, how to propose and make changes, and how to run the tests.

## Code of Conduct

This project follows a [Code of Conduct](CODE_OF_CONDUCT.md). By participating, you agree to abide by it.

## Repository layout

| Path | Contents |
| ---- | -------- |
| `yamd-1.2.0-spec.md` | The specification and decision log — the source of truth for widget syntax, callouts, references, Build and export (the 0.1 spec is archived in `docs/0.1/`) |
| `docs/0.1/` | The archived 0.1 specification and the Markdown analysis behind it |
| `vscode-yamd/` | The VS Code extension (TypeScript, strict mode, Node.js 20+) |
| `examples/` | A worked Markdown note for every feature, organized by topic (a test checks that they stay valid) |
| `openspec/` | Spec-driven change proposals: `changes/<name>/proposal.md`, `tasks.md`, and spec deltas |

See [vscode-yamd/README.md](vscode-yamd/README.md) for the extension's internal layout (`src/core/`, `src/extension/`, `src/workspace/`, `src/study/`, etc.).

## Development setup

From the repository root, the `Makefile` wraps the extension's npm scripts:

```bash
make deps        # npm install
make build        # bundle into dist/
make typecheck
make test          # parser, renderer, widgets, query, build, export, study and conformance tests
```

(Equivalently, run the same `npm run <script>` commands from inside `vscode-yamd/`. Run `make help` for the full list of targets, including `install` for installing the built extension into VS Code.)

To try the extension interactively, open `vscode-yamd/` in VS Code and press F5. This launches an Extension Development Host window with the repository root as the workspace, so you can open anything under `examples/`.

Before sending a change, run:

```bash
make typecheck test
```

`make package` also builds a `.vsix` and is a good final check (use `make package-fast` to skip the test suite, e.g. if the wall-clock perf benchmark is flaky under load).

## Making a change

1. **Format or spec changes** (new syntax, directives, diagnostics): start from `yamd-1.2.0-spec.md`. Most non-trivial changes go through an OpenSpec proposal first — see below.
2. **Extension-only changes** (bug fixes, performance, UI polish) that don't change the format can go straight to a pull request.
3. **Keep `src/core/` free of VS Code dependencies.** It's the pure parser/renderer/linter layer, shared by tests and the extension; anything that touches `vscode` APIs belongs in `src/extension/`, `src/workspace/` or `src/study/`.
4. **Diagnostics are documented.** Widget problems are `W###`, callouts `C###`, queries `Q###`. If you add a check, add its code to the spec (§22) and cover it in a test.
5. **Add tests.** Core logic is tested with `node:test` under `vscode-yamd/test/`; conformance against CommonMark/GFM is checked in `test/conformance.test.ts` against `fixtures/known-differences.json`.
6. **Add an example.** If the change is user-visible, add or update a file under `examples/` that demonstrates it, and link it from `examples/README.md`.

### Using OpenSpec for larger changes

This project uses [OpenSpec](openspec/) for spec-driven development. For a change large enough to need design discussion:

1. Create `openspec/changes/<short-name>/proposal.md` describing *why* and *what changes*.
2. Create `openspec/changes/<short-name>/tasks.md` breaking the work into checkable steps.
3. Implement the tasks, checking each one off (`- [x]`) as it's done and verified.
4. Once complete, the change can be archived (moved under `openspec/changes/archive/`).

Look at `openspec/changes/add-student-features/` or `openspec/changes/add-kanban-boards/` for examples of the expected shape and level of detail.

## Pull requests

- Keep PRs focused on one change; split unrelated fixes into separate PRs.
- Write commit messages that explain *why*, not just *what* (see `git log` for the house style — a short summary line, then bullet points for anything non-obvious).
- Make sure `npm run typecheck`, `npm test` and (if you touched the format) the examples all still parse cleanly before requesting review.
- Update `yamd-1.2.0-spec.md`, `vscode-yamd/README.md` and the relevant `examples/` files in the same PR as the code change — documentation and examples are not an afterthought here.

## Reporting bugs and requesting features

Open an issue with:
- For a bug: the Markdown note that triggers it, what you expected, and what happened instead (include a screenshot of the widget if relevant).
- For a feature request: the pain point it solves and, if you have one, a sketch of the syntax — check `yamd-1.2.0-spec.md`'s decision log first in case it's already covered.

## Questions

Open a discussion or issue — there's no separate chat channel yet.

## Code layout (vscode-yamd/src)

| Folder | What lives there |
|---|---|
| `core/markdown` | The Markdown engine: parser, adapter, micromark syntax, renderer, sanitizer, front matter. No `vscode` imports. |
| `core/widgets` | Fence scanner, widget linter, board edit logic (kanban, calendar, timeline, gallery) and the block-body edit mapping. |
| `core/query` | CSV/JSON/SQLite loading, the read-only SQL engine, result views and snapshots. |
| `core/build` | Callouts, references, markers, TOC, bibliography and the Build orchestrator. |
| `core/citations` | The BibTeX reader and citation styles. |
| `core/export` | Preparing a note for export, and the HTML/slide page wrappers. |
| `core/study`, `core/notes`, `core/templates` | Study logic (cards, SRS, deadlines), note summaries, template placeholders. |
| `extension/widgets`, `extension/query`, `extension/build`, `extension/companions`, `extension/shared` | The VS Code layer, one folder per feature. |
| `study` | The study panels, deadlines view and index. |
| `webview` | Scripts that run inside the widget panel. |

`core/**` never imports `vscode`, so every feature there is covered by `node:test` tests.

## Testing in a real VS Code

`make test` runs the unit tests (`core/**` never imports `vscode`). `make test-integration` starts VS Code's extension host with the extension from this checkout and a copy of `examples/`, then checks activation, commands, CodeLens, diagnostics and quick fixes, Build, Run Query, opening widgets, review commands, Go to Reference Target and the exports. It needs VS Code 1.145+ installed, opens a window briefly, and leaves its workspace copy in the system temp folder. It can't drag cards or click inside a widget panel; `docs/qa-checklist.md` lists what to try by hand.
