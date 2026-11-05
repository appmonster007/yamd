# YAMD 1.2.0 Implementation Plan

Spec: [yamd-1.2.0-spec.md](yamd-1.2.0-spec.md) (decisions D1–D55, defaults §22). This plan turns it into phases with tasks, files, tests and exit gates. Effort is relative (S/M/L), not calendar time.

## Approach

1. **Branch:** work on `yamd-1.2` off `main`. The 0.1 extension keeps working until the new features reach parity; removal of old code is the **last** phase, not the first.
2. **Same package, in place:** `vscode-yamd/` is evolved, not restarted, so reusable code stays in git history and tests keep running. `package.json` is rewritten at the end (Phase 9).
3. **Pure core, thin VS Code layer:** every feature is built as vscode-free TypeScript in `src/core/` (parse, edit, render, build) with `node:test` tests, and wired to VS Code in `src/extension/`. This is how the board edit code already works.
4. **Gates:** after Phases 1–2 and again after Phase 4, stop and check the experience in VS Code before continuing.
5. **VS Code floor:** `engines.vscode` = `^1.145.0` (D3). No code written for older versions.

## Module map (target layout)

```
src/core/
  fences.ts          fence scanner, info-string and ```sql header parser, ids
  widgets/           kanban.ts calendar.ts timeline.ts gallery.ts   (parse body -> model, edit ops)
  query/             sql engine (sql.js), loaders (csv/json/sqlite), views (table/board/chart), snapshot writer
  callouts.ts        callout scanner, numbering, ^id
  refs.ts            cross-reference and citation resolution
  build/             marker engine (idempotent), toc.ts, bibliography.ts, refLabels.ts
  study/             cards (from callouts), srs (SM-2), deadlines, templates, bibtex
  export/            html.ts (full-note renderer), slides.ts, print.css
  lint.ts            widget / query / callout diagnostics (+ fixes)
src/extension/
  extension.ts       activation, command registration
  codeLens.ts        CodeLens above widget fences
  widgetPanel.ts     one webview panel class for all widgets
  widgetCommands.ts  Open Widget, Name Block, Insert Widget
  queryCommands.ts   Run Query, Open in SQL Client
  buildCommands.ts   Build, on-save setting, Go to Reference Target
  diagnostics.ts     Problems panel + quick fixes
  aliases.ts         companion alias commands with install prompt
  study/             review panel, dashboard, deadlines view, timer, new study note
src/webview/         widget UI bundles (kanban, calendar, timeline, gallery, query), fixed design
media/               widget.css, print.css
```

## Phase 0: Preparation (S)

- [ ] Create branch `yamd-1.2`; commit the two spec files.
- [ ] Verification spike (half a day), results recorded in spec §17:
  - [ ] CodeLens above a fenced block in a plain `.md` file, with a click opening a webview panel beside the note.
  - [ ] Confirm CodeLens and the panel behave with VS Code's built-in Markdown editor and with Foam installed.
  - [ ] Choose and verify companion extensions by marketplace id (SQLite viewer, CSV editor, Markdown tooling, SQL client): installed-count, last update, licence, command ids we can invoke.
  - [ ] Check that `extensionPack` + `extensionDependencies` can require Foam.
- [ ] Decide extension id/name for 1.2.0 (keep `appmonster007.vscode-yamd-ext` for upgrade continuity unless told otherwise).
- **Exit:** CodeLens plus panel proven; companion list fixed.

## Phase 1: Fence foundation (M)

Tasks
- [ ] `core/fences.ts`: scan a document for fenced blocks (backtick and tilde, any length, nesting inside callouts/lists), return `{type, attrs, id, startLine, bodyStart, bodyEnd, endLine}`.
- [ ] Info-string parser (D4, D23): `key=value`, quoted values, single bare word becomes `id`.
- [ ] ` ```sql ` header parser (D22): first-line comment `-- id="…" source="…" view="…"`.
- [ ] Id rules (§22): lowercase letters, digits, `-`; unique per note; positional label `kanban #2` when absent.
- [ ] `core/lint.ts` (new, small): duplicate ids, unknown widget type, missing `source`, bad attribute syntax.
- [ ] `extension/codeLens.ts`: `Open <type>: <id>` above each widget fence (refresh on edit).
- [ ] `extension/diagnostics.ts`: Problems-panel diagnostics + quick fix "Name this block" (D47).
- [ ] Commands: `YAMD: Open Widget` (picker over blocks in the note), `YAMD: Name Block`, `YAMD: Insert Widget`.
- [ ] Keep `editor.codeLens` respected; no keybindings (D51).

Tests (`test/fences.test.ts`, `test/infoString.test.ts`, `test/lint.test.ts`)
- fences inside lists/quotes, unclosed fences, tilde fences, duplicate ids, bare-word id, quoted values, sql header variants.

**Exit:** open a `.md` with three widget fences: CodeLens shows correct labels, duplicates are flagged, "Name this block" writes an id.

## Phase 2: Widget panel and kanban (L)  — **Gate 1**

Tasks
- [ ] `extension/widgetPanel.ts`: one panel class keyed by (document, block id); reveals if already open; follows edits to the block; disposes when the block disappears; shows an "id changed/removed" message.
- [ ] `core/widgets/kanban.ts`: parse the fence body into the existing board model by wrapping `parse(body)` blocks as a synthetic container so `buildBoard`, `moveCard`, `addCard`, `renameCard`, `toggleTask` are reused unchanged.
- [ ] `withBlock(source, fence, fn)` helper: runs a body-relative edit and offsets it by the fence's body start line (so edit modules need no changes).
- [ ] Reuse `core/boardEdit.ts` (`computeBoardEdit`) for the message protocol; add `blockId` to the message.
- [ ] Webview bundle `src/webview/kanban.ts` from today's `src/preview/kanban.ts` + `shared.ts`; `media/widget.css` from the board sections of `preview.css` (fixed design, D12).
- [ ] Edits apply through `WorkspaceEdit` on the note (undo works) and auto-save as today.
- [ ] Workspace Trust: read-only when untrusted (D54).

Tests: body-offset edit tests over fences at different positions; stale-hash refusal; embedded in list.

**Gate 1 (manual):** open a kanban from CodeLens, drag a card, rename, add; the note updates, undo works, close/reopen keeps state; two kanban blocks open separately. Decide here whether to continue with the CodeLens + panel approach or revisit.

## Phase 3: Calendar, timeline, gallery (M)

- [ ] `core/widgets/calendar.ts`, `timeline.ts`, `gallery.ts` using the existing `calendarEdit`, `timelineEdit`, `galleryEdit` through `withBlock`.
- [ ] Gallery body: list of Markdown images, or `source="img/"` folder (D44); images resolved via `asWebviewUri` with the panel's resource roots.
- [ ] Webview modules from `src/preview/calendar.ts`, `timeline.ts`, `gallery.ts`.
- [ ] Insert Widget templates for each type.

Tests: existing edit tests kept; new folder-source gallery listing test; calendar/timeline attribute parsing inside fences.

**Exit:** all four board types open, edit and round-trip.

## Phase 4: SQL query widget (L)  — **Gate 2**

- [ ] `core/query/engine.ts`: sql.js wrapper (reuse `core/db/engine.ts` pieces, drop `.ydb` code).
- [ ] Loaders: CSV (RFC 4180, header row), JSON (array of objects), SQLite (open **read-only**) (D21, D25).
- [ ] CSV/JSON loaded into an in-memory table named after the file.
- [ ] Result views: table, board (`group=`), chart (`type`, `x`, `y`) rendered by a fixed design (D38); charts as SVG (reuse `core/db/views.ts` chart code where it fits).
- [ ] `extension/widgetPanel.ts`: query panel; file watcher refreshes automatically (D50); restricted-mode behavior (D54): no queries on files outside the workspace.
- [ ] `YAMD: Run Query`: writes the Markdown table snapshot between `<!-- yamd:query:ID -->` markers, 50 rows, `last run`, `+N more rows` (D41).
- [ ] Safety: SQLite opened read-only; the SQL text is also rejected if it contains non-SELECT statements (belt and braces); single-statement only.
- [ ] `YAMD: Open in SQL Client` alias (full results and writes happen there, D25).

Tests: loaders (quoting, types), read-only enforcement, snapshot formatting and row limit, idempotent re-run, board/chart view models.

**Gate 2 (manual):** `bugs.csv` plus a `sql` block renders as table/board/chart, refreshes when the file changes, snapshot writes and re-runs without diff noise.

## Phase 5: Callouts, references and Build (L)

- [ ] `core/callouts.ts`: scan `> [!type] Title ^id` blocks, end at first non-`>` line, per-type numbering for study types (D33), ids.
- [ ] `core/refs.ts`: `^id` targets for fig/tbl/eq, `[@key]` references, citations vs cross-references by prefix.
- [ ] `core/build/markers.ts`: generic marker engine for `<!-- yamd:NAME … -->` … `<!-- /yamd:NAME -->`; only edits inside markers; idempotent; returns a minimal edit set.
- [ ] TOC generator (`depth=` option, §22).
- [ ] Cross-reference converter: `[@fig-x]` becomes `[Figure 2](#fig-x)`; later runs refresh the label from the link target (D14).
- [ ] Bibliography from `.bib` (reuse `core/study/bibtex.ts`): APA, IEEE, Chicago/Harvard via front matter `citation-style:` (D42).
- [ ] `YAMD: Build` command; `yamd.build.onSave` setting (default off); applies through `WorkspaceEdit` so undo works.
- [ ] `YAMD: Go to Reference Target`: cross-reference, citation to bibliography entry, image link opens the image in its own tab (D37).
- [ ] Linter additions: missing blank line after a callout, unknown callout type, unresolved reference, duplicate `^id`.

Tests: callout boundaries (lazy continuation), numbering across types, marker idempotence (run twice, no change), cross-reference round-trip, bibliography styles against fixtures, TOC depth.

**Exit:** a sample note with callouts, figure/table/equation targets, citations and a `.bib` builds to a stable result; second Build produces no diff.

## Phase 6: Study tools (M)

- [ ] Cards from `> [!card] Question` callouts, keyed by hash of the question (D55).
- [ ] Reuse SM-2 (`core/study/review.ts`, `cards.ts`); store the schedule in `.yamd/srs.json`.
- [ ] Panels and views: review session, dashboard, deadlines (sidebar tree), timer (status bar + menu) in one `YAMD` view container (D28); reuse `src/study/*` with the parsing swapped from the old AST to the callout/task scanners.
- [ ] Study note templates (lecture, lab report, exam prep, reading note) rewritten to the new syntax; filled once at creation (D13, D26).
- [ ] Deadlines read `due=` from task items.

Tests: card extraction, hash identity (edited answer keeps schedule, edited question resets), SRS scheduling (existing tests adapted), template fill.

**Exit:** create a study note, review its cards, see deadlines and dashboard.

## Phase 7: Export (M)

- [ ] `core/export/html.ts`: full-note renderer: Markdown + GFM, callouts styled and numbered, resolved references and citations, bibliography, widgets as static HTML (reuse `renderBoards.ts` and query views), critic markup (D46), attribute effects and page breaks (D48, D39).
- [ ] `media/print.css` for printing; `YAMD: Export HTML` opens the result for the user to print to PDF (D52).
- [ ] Slides: split at `---` and H1/H2 (D43); a minimal reveal-style template with a print stylesheet.
- [ ] Sanitization: reuse `core/sanitize.ts` for raw HTML.

Tests: golden-file HTML for fixtures (callouts, citations, widgets), slide splitting rules, sanitizer cases.

**Exit:** a sample note exports to HTML and slides that print correctly.

## Phase 8: Companions and aliases (S)

- [ ] `package.json`: `extensionPack` (Foam, SQLite viewer, CSV editor, Markdown tooling) and `extensionDependencies` for Foam (D18).
- [ ] `extension/aliases.ts`: `Open in SQLite Viewer`, `Open in CSV Editor`, `Open in SQL Client`, `Open Daily Note` (Foam); each offers to install a missing companion, then runs (D45).
- [ ] Settings: `yamd.*` toggles to hide feature areas (D18).

Tests: alias resolution logic is unit-tested with a stubbed extension registry; install prompts checked manually.

## Phase 9: Removal and cleanup (M)

Only after Phases 1–8 pass their exits.

Remove:
- `src/extension/preview.ts`, `previewLinks.ts`, `livePreview.ts`, `src/core/livePreview.ts`, the `yamd.editor` custom editor, the lock mode, `webviewShell` pieces only used by the old preview.
- The language contribution: `languages`, `grammars`, `.yamd`/`.ymd` associations, `syntaxes/`, `scripts/build-grammar.mjs`, `language-configuration`, snippets for `.yamd`.
- Old parser path: `core/parser.ts`, `adapter.ts`, `micromark/*`, `chunking.ts`, and `render.ts` once no longer referenced (keep only what Phase 5 and 7 reuse).
- Workspace layer: `src/workspace/*`, `core/note*.ts`, `core/embeds.ts`, `graph/`, `sidebar/properties`, `console`.
- `.ydb`: `core/db/ydb.ts`, `jobs.ts`, formulas, `databaseWizard`, `dbFeatures`, `databases.ts`, `dbWorker.ts`.
- DOCX writer and zip (`core/study/docx.ts`, `zip.ts`), importers not kept, `migration.ts`.
- Old commands/menus/keybindings/configuration in `package.json`; rewrite `contributes` for 1.2.0.

Update: README, `CONTRIBUTING.md`, examples converted to `.md` by hand using the new spec (D35), spec status, version to `1.2.0`, `engines.vscode` to `^1.145.0`.

Tests: remove obsolete tests with their modules; `npm test` and typecheck green.

## Phase 10: QA and release (M)

- [ ] Manual test checklist: each widget type, two widgets of one type, duplicate ids, restricted mode, read-only file, large CSV, file changes while open, Build twice, on-save Build, export, review flow, alias commands with companions missing.
- [ ] Performance check: note with 20 widget fences; 50k-row CSV query (row cap and timing).
- [ ] Package: `vsce package`, install locally, run the checklist from the installed extension.
- [ ] Changelog and release notes documenting dropped features (`.yamd`, `.ydb`, DOCX, variables, custom preview).

## Dependency order

```
P0 -> P1 -> P2 -> P3
              \-> P4 -> P5 -> P6
                         \-> P7
P8 (any time after P1)   P9 after P1–P8   P10 last
```

## Risks and mitigations

| Risk | Mitigation |
|---|---|
| CodeLens + panel flow feels clumsy in practice | Gate 1 after kanban; fallback ideas: inline block editor API spike (`[UNVERIFIED]`, spec §17) or a side tree view. |
| Edit offsets wrong inside fences nested in lists/quotes | `withBlock` helper tested with nesting; stale-hash refusal remains the safety net. |
| Auto-write diff noise | Marker engine is idempotent with tests; on-save is off by default. |
| SQL safety | Read-only SQLite open plus statement check plus in-memory copies for CSV/JSON. |
| Companion extensions change or disappear | Aliases degrade to an install prompt; widgets never depend on their APIs. |
| Large deletion (Phase 9) loses something still wanted | Done last, on the branch; old code remains in git history. |
| Citation style correctness | Fixtures per style; small, explicit style definitions. |

## Definition of done for 1.2.0

- All spec decisions D1–D55 implemented or explicitly deferred in the changelog.
- `npm run typecheck` and `npm test` pass; new modules have unit tests.
- The installed extension passes the Phase 10 checklist on VS Code 1.145+.
- A plain `.md` note using every feature still reads sensibly without the extension (spec §16).
