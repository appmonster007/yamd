# YAMD for VS Code

Language support for YAMD, a plain-text markup format that keeps Markdown's simplicity and fixes its pain points. The format is defined in `yamd-spec.md` at the root of the YAMD repository.

YAMD is built on GitHub Flavored Markdown: existing Markdown renders as it does on GitHub, except that a newline is a line break and YAMD's own syntax (`==highlight==`, `x^{2}`, `{{ vars }}`, `[[links]]`, `#tags` and so on) is recognized. The parser passes 97.7% of the CommonMark spec examples; every remaining difference is listed in the spec's "Differences from GFM" section.

## Features

- **Syntax highlighting** for every YAMD construct, including front matter, directives, attributes, variables, math, comments and review markup. Fenced code blocks are highlighted in their own language.
- **Live preview** that updates as you type, follows the active `.yamd` editor, keeps its scroll position in sync with the editor and matches your color theme. Code blocks are syntax-highlighted with a copy button, and math renders with KaTeX (bundled, so it works offline).
- **Diagnostics** in the Problems panel using the codes from the spec, such as `Y702` for missing alt text and `Y801` for an undefined variable.
- **List continuation**: pressing Enter at the end of a list item starts the next one. On an empty item, it ends the list.
- **Formatting shortcuts** that toggle bold, italic, underline, strikethrough, highlight and inline code.
- **Snippets** for front matter, callouts, collapsible sections, columns, tables, code, math, figures and review markup.
- **Comment toggling** with `%% %%`.
- **Markdown migration**: convert a Markdown file so it renders in YAMD exactly as it did on GitHub.
- **Interactive preview** (trusted workspaces only): tick task checkboxes and edit kanban boards in the preview. Every change is written back to the source as one undoable edit.

## Linked notes

The extension indexes every `.yamd` file in the workspace (except `yamd.index.exclude` and the templates folder) and keeps the index fresh as you type.

- **Links and embeds**: `[[note]]`, `[[note#Heading]]`, `[[note#^block]]` resolve by path, file name or alias. `![[note]]` shows the note (or a section or block) in the preview. Ctrl/Cmd+click or Go to Definition follows a link; following a link to a missing note offers to create it.
- **Completion** for note names and aliases after `[[`, headings after `#` and block IDs after `#^` inside a link, and tags after `#`.
- **Renaming or moving a note** updates path-based links to it in the same undoable step. Links by name keep working without changes.
- **YAMD sidebar** (activity bar): **Backlinks** (linked and unlinked mentions; the link button turns a mention into `[[note]]`), **Tags** (nested tags with note counts) and **Properties** (edit front matter as typed fields).
- **Outline** and breadcrumbs show the note's headings.
- **Graph view**: "YAMD: Open Graph View" (whole workspace) and "YAMD: Open Local Graph" (the active note and the notes around it, with a link-step stepper). Notes are colored by folder or tag with a legend, sized by how many links they have, and hover shows a tooltip and highlights neighbors. Type in the search box to dim everything but matching notes (`#tag` searches tags, Enter frames the matches). Click a note to open it; drag one to pin it where you drop it, and double-click to release. Scroll or use the buttons to zoom, double-click the background (or press 0) to fit. The settings button controls labels, arrows, notes without links, notes that don't exist yet (dashed), and the layout forces, and your choices are remembered. It loads nothing from the network.
- **Daily notes and templates**: "YAMD: Open Today's Daily Note", "Previous Daily Note", "Next Daily Note" and "Insert Template". Templates can use `{{@date}}`, `{{@date:DD/MM/YYYY}}`, `{{@time}}`, `{{@title}}` and `{{@cursor}}`.
- **Quick Switcher** (Cmd+Alt+O / Ctrl+Alt+O): open a note by title, alias or path, or create one.

Ticking a checkbox inside an embed updates the embedded note.

## Kanban boards

Write a board as headings (columns) and list items (cards) inside `:::kanban`; see `examples/05-kanban/sprint-board.yamd`. In the preview:

| Action                        | How                                                     |
| ----------------------------- | ------------------------------------------------------- |
| Move a card                   | Drag it, or focus it and press Alt+Up/Down/Left/Right   |
| Add a card                    | Type in the box at the bottom of a column, press Enter  |
| Rename a card                 | Double-click its title, type, press Enter (Esc cancels) |
| Collapse a column             | Click the arrow next to its title (preview only)        |

Moving a card into a `{complete}` column ticks it. If the source changed since the preview rendered, the move is dropped and the preview refreshes. In untrusted workspaces, boards and checkboxes are read-only.

A database can be shown as a board too: `::db[roadmap]{type=board group=Stage}`. Dragging a card sets the grouped property; without a `sort`, it also reorders the rows. See `examples/05-kanban/roadmap-board.yamd`.

## Databases and queries

Databases are `.ydb` text files (YAML, one row per list item, git-friendly) or SQLite files, used by notes in the same folder or below. See `examples/04-databases/`.

- **Views**: `::db[tasks]{view=Open}` or `::db[tasks]{type=table|list|gallery|calendar|board columns="Title,Due" filter="Status != 'Done'" sort="-Due" group=Status}`. In the preview, click a column header to sort, type to search, click a cell to edit it, use **New** to add a row and × to delete one, and **Save view** to store the current sort in the database. `.ydb` edits are undoable in the editor; the first SQLite edit in a session asks for permission.
- **Queries**: ` ```query {db=tasks view=list} ` blocks and `:query[SELECT count(*) FROM tasks]{db=tasks}` inline. Without `db`, queries run over the notes in the folder (`notes`, `tags`, `links`, `tasks` tables), like Dataview. ` ```sql ` blocks never run.
- **Aliases**: map names to databases in the front matter (`databases: {crm: data/crm.sqlite#contacts}`), or use "YAMD: Add Database to Note". "YAMD: New Database" creates a `.ydb` file.
- **SQL Console** (YAMD sidebar): pick any database in the workspace (or Browse…), run SQL with Cmd+Enter / Ctrl+Enter, recall history with the Up arrow. Read-only is on by default; turning it off asks once per database before running writes.
- **Open in SQLite Viewer** (console, or right-click a SQLite file) opens the file in an installed SQLite extension, or offers a Marketplace search if none is installed.
- **Security**: queries run only in trusted workspaces, off the main thread, read-only, on an in-memory copy, with a time limit and a row limit. Databases outside the note's folder are refused. Writes log to the "YAMD Databases" output channel.

## Study features

Tools for coursework and academic writing. See `examples/07-study/` for a full guide and a complete worked lecture note.

- **Study-aid blocks**: `:::definition`, `:::theorem`, `:::lemma`, `:::proof`, `:::example`, `:::question`, `:::remark`, `:::summary`, `:::derivation` — numbered per kind, cross-referenced with `[@def:id]`, `[@thm:id]`, etc. "YAMD: Generate Cheat Sheet" gathers them from every note in a course into one new note.
- **Flashcards**: `:::card` (with a `---` separating question and answer), `::card[Q]{a="A"}` and `:cloze[hidden text]` deletions. "YAMD: Review Flashcards" runs SM-2 spaced-repetition review sessions; "YAMD: Toggle Quiz Mode" hides cloze answers in the preview until clicked. "YAMD: Prune Orphaned Card Data" cleans up `.yamd/srs.json` after cards are renamed or removed.
- **Deadlines and progress**: `course:` and `due:` front matter, `{due=…}` on tasks. "YAMD: Open Study Dashboard" shows an agenda (overdue/today/this week), per-course progress, stale topics and a study heatmap.
- **Study timer**: "YAMD: Start Study Timer" runs a Pomodoro-style focus timer in the status bar; finished sessions log to `.yamd/study-log.json` and, by default, to the daily note.
- **Citations**: BibTeX via `bibliography: refs.bib` front matter, `[@key]` and `[@key, p. 12]` in text, `::bibliography` for the reference list. Supports APA, MLA, Chicago, IEEE and Vancouver styles (`citation-style:`). "YAMD: Add Citation" looks up a DOI, arXiv ID or ISBN.
- **Export**: "YAMD: Export as HTML / PDF / Word (.docx) / Slides" — HTML includes a title page and table of contents; PDF opens the HTML for printing; slides split on level-1 headings.
- **Peer review**: "YAMD: Accept All Review Changes" and "Reject All Review Changes" resolve a note's `{++ ++}`, `{-- --}`, `{~~ ~>  ~~}` and `{>> <<}` review markup (see `yamd-spec.md` §7) in one step.
- **Templates and imports**: "YAMD: New Study Note…" (lecture notes, lab report, exam prep, reading note), "YAMD: New Reading List" (a kanban-style `.ydb`), "YAMD: Import Notes from Folder…" (Obsidian, Notion, HTML, CSV).
- **Math symbols**: "YAMD: Insert Math Symbol" — a searchable picker of common LaTeX symbols.

## Commands and shortcuts

| Command                         | macOS        | Windows / Linux |
| ------------------------------- | ------------ | --------------- |
| YAMD: Open Preview to the Side  | Cmd+K V      | Ctrl+K V        |
| YAMD: Open Preview              | Cmd+Shift+V  | Ctrl+Shift+V    |
| YAMD: Toggle Bold               | Cmd+B        | Ctrl+B          |
| YAMD: Toggle Italic             | Cmd+I        | Ctrl+I          |
| YAMD: Toggle Underline          | Cmd+U        | Ctrl+U          |
| YAMD: Toggle Strikethrough      | Alt+S        | Alt+S           |
| YAMD: Toggle Highlight          | Cmd+Shift+H  | Ctrl+Shift+H    |
| YAMD: Toggle Inline Code        | Cmd+`        | Ctrl+`          |
| YAMD: New Note…                 |              |                 |
| YAMD: New Timestamped Note      |              |                 |
| YAMD: Convert from Markdown     |              |                 |
| YAMD: Open Markdown as YAMD     |              |                 |
| YAMD: Review Flashcards         |              |                 |
| YAMD: Open Study Dashboard      |              |                 |
| YAMD: Start / Pause / Stop Study Timer |       |                 |
| YAMD: New Study Note…           |              |                 |
| YAMD: Generate Cheat Sheet      |              |                 |
| YAMD: Export as HTML / PDF / Word (.docx) / Slides |  |          |
| YAMD: Add Citation              |              |                 |
| YAMD: Insert Math Symbol        |              |                 |
| YAMD: Accept / Reject All Review Changes |     |                 |
| YAMD: Combine Notes…            |              |                 |
| YAMD: Import Notes from Folder… |              |                 |
| YAMD: Insert PDF Reference      |              |                 |
| YAMD: New Reading List          |              |                 |
| YAMD: Prune Orphaned Card Data  |              |                 |
| YAMD: Toggle Quiz Mode          |              |                 |

The shortcuts only apply in `.yamd` files.

**New Note…** asks for a name and creates `<name>.yamd` with `title`, `date` and `lang` in its front matter. **New Timestamped Note** skips the question and names the file after the current time (`2026-10-17-1430.yamd`; set the format with `yamd.newNote.timestampFormat`). Both are buttons at the top of the YAMD sidebar, appear when you right-click a folder in the Explorer (the note is created there), and New Note is also in File > New File…. Without a folder, notes go next to the active note.

**Convert from Markdown** rewrites the active file in one undoable edit: it joins hard-wrapped paragraph lines and backslash-escapes text that YAMD would read as its own syntax. **Open Markdown as YAMD** (also in the Explorer context menu for `.md` files) writes a converted `.yamd` copy next to the Markdown file and opens it; the `.md` file isn't changed.

## Snippets

Type a prefix and accept the suggestion:

`frontmatter`, `note`, `tip`, `warning`, `danger`, `details`, `columns`, `table`, `listtable`, `code`, `math`, `figure`, `toc`, `ins`, `del`, `sub`, `comment`

## Settings

| Setting                        | Default | Description                                               |
| ------------------------------ | ------- | --------------------------------------------------------- |
| `yamd.diagnostics.enabled`     | `true`  | Report diagnostics in the Problems panel                  |
| `yamd.diagnostics.ignore`      | `[]`    | Codes to hide, for example `["Y707"]`                     |
| `yamd.editor.listContinuation` | `true`  | Continue lists when pressing Enter at the end of an item  |
| `yamd.index.exclude`           | `[]`    | Globs for notes to leave out of the index                 |
| `yamd.dailyNotes.folder`       | `daily` | Folder for daily notes                                    |
| `yamd.dailyNotes.format`       | `YYYY-MM-DD` | Daily note file name format                          |
| `yamd.dailyNotes.template`     | `""`    | Template for new daily notes, e.g. `templates/daily.yamd` |
| `yamd.templates.folder`        | `templates` | Folder for "Insert Template"; not indexed             |
| `yamd.preview.maxSizeKB`       | `8192`  | Notes larger than this aren't previewed                   |
| `yamd.queries.timeout`         | `2`     | Seconds before a document query is stopped (Y952)         |
| `yamd.queries.maxRows`         | `500`   | Most rows a view or query shows                           |
| `yamd.databases.maxFileSize`   | `100`   | Megabytes; larger database files aren't loaded for previews |
| `yamd.sqlite.viewer`           | `""`    | Custom editor used by "Open in SQLite Viewer"             |
| `yamd.newNote.timestampFormat` | `YYYY-MM-DD-HHmm` | File name for "New Timestamped Note"            |
| `yamd.newNote.lang`            | `en`    | `lang` written into new notes                             |
| `yamd.study.newCardsPerDay`    | `20`    | New (unseen) flashcards shown per review session           |
| `yamd.study.pomodoroMinutes`   | `25`    | Default study-timer session length, in minutes             |
| `yamd.study.logToDailyNote`    | `true`  | Append a line to the daily note when a timer session ends  |
| `yamd.study.staleAfterDays`    | `14`    | Days without review before a topic is flagged as stale     |

## Diagnostics

| Code   | Severity | Meaning                                               |
| ------ | -------- | ----------------------------------------------------- |
| `Y101` | Warning  | Tab in indentation                                    |
| `Y102` | Error    | Front matter is not valid YAML                        |
| `Y201` | Info     | Redundant trailing backslash (a newline is a break)   |
| `Y210` | Info     | Paragraph looks hard-wrapped; quick fix joins it      |
| `Y212` | Info     | Changed bullet marker starts a new list               |
| `Y301` | Warning  | `##word` at the start of a line isn't a heading       |
| `Y401` | Warning  | Line without `>` continues the quote above (lazy)     |
| `Y501` | Error    | Unclosed code fence                                   |
| `Y601` | Warning  | Unknown directive                                     |
| `Y602` | Error    | Circular embed or include                             |
| `Y603` | Warning  | Content before the first column of a kanban board     |
| `Y604` | Info     | Kanban column over its `limit`                        |
| `Y605` | Warning  | Flashcard has no answer                               |
| `Y701` | Warning  | Broken link, embed, heading, block, image, reference or footnote |
| `Y702` | Error    | Image without alt text or `{decorative}`              |
| `Y703` | Error    | Table without a header row                            |
| `Y704` | Warning  | Skipped heading level                                 |
| `Y705` | Warning  | More than one H1                                      |
| `Y706` | Warning  | Non-descriptive link text such as "click here"        |
| `Y707` | Info     | Front matter doesn't set `lang`                       |
| `Y708` | Error    | Block ID used twice in one note                       |
| `Y709` | Warning  | Link name matches more than one note                  |
| `Y850` | Error    | Unknown database or alias                             |
| `Y851` | Error    | SQL error in a view or query                          |
| `Y852` | Error    | Invalid `.ydb` structure or property type             |
| `Y853` | Error/Warning | Value doesn't match its property                 |
| `Y854` | Error    | Duplicate row `id` in a `.ydb` file                   |
| `Y855` | Error    | Board grouped by a property that can't be grouped     |
| `Y950` | Error    | Query refused as unsafe                               |
| `Y951` | Error    | Database outside the note's folder                    |
| `Y952` | Warning  | Query stopped at the time limit                       |
| `Y801` | Error    | Undefined variable                                    |
| `Y901` | Warning  | URL scheme not allowed (for example `javascript:`)    |

Text inside code, math and comments is never checked.

## What the preview doesn't render yet

These features are shown as readable fallbacks:

- **Mermaid diagrams** are shown as code.
- **`::embed`** shows a link.
- **`:::html`** is shown as escaped source, because the preview never runs in trusted mode. Raw HTML outside it is sanitized with GitHub's allow-list.

## Large notes and workspaces

- **Large notes** (over about 30 KB) are parsed in chunks that are cached, so an edit re-parses only the few kilobytes around it instead of the whole file. Notes over 150 KB are parsed ahead of time in short slices, so opening one doesn't freeze the editor, and the preview waits a little longer to update as a note gets bigger. A note with unusual structure (for example definitions inside quotes or lists) is parsed whole, which is slower but gives the same result.
- **Large workspaces** are indexed in a worker thread, so thousands of notes don't stall typing. The index keeps the text of small notes only and reads larger ones when it needs them. Bursts of file changes, such as a `git checkout`, are gathered and loaded together.
- Notes over 2 MB aren't indexed, and notes over `yamd.preview.maxSizeKB` aren't previewed. The Problems panel shows at most 1,000 findings per note.

## Installing

Not on the Marketplace yet — install the built `.vsix` instead. From the repository root:

```bash
make install     # builds, tests, packages and installs the extension
```

See the [top-level README](../README.md#installing-the-extension) for prerequisites and what to do if `make` or the `code` CLI aren't available.

## Development

Requires Node.js 20 or later. From this directory (or use the equivalent `make` target from the repository root, e.g. `make test`):

```bash
npm install
npm run build       # generate the grammar and bundle into dist/
npm run typecheck
npm test            # parser, renderer, linter, grammar, editing, conformance and migration tests
npm run package     # type-check, test and build a .vsix
```

To try the extension, open this folder in VS Code and press F5. This opens a new window with the extension loaded and the repository root as the workspace, so you can open the files in `examples/`, starting with `examples/getting-started.yamd`.

To install the packaged extension by hand instead of `make install`:

```bash
code --install-extension vscode-yamd-0.1.0.vsix
```

### Layout

| Path                         | Contents                                                       |
| ---------------------------- | -------------------------------------------------------------- |
| `src/core/`                  | Parser (micromark + YAMD extensions in `micromark/`), renderer, sanitizer, linter and Markdown converter, with no VS Code dependency |
| `src/extension/`             | Activation, preview panel, diagnostics and commands            |
| `src/workspace/`             | Note index, link features, sidebar views, graph panel, daily notes |
| `src/graph/`                 | Script that runs inside the graph webview (d3-force on a canvas) |
| `src/core/db/`               | `.ydb` files, folder scope, the SQL engine (sql.js) and safety check, view rendering |
| `src/preview/`               | Script that runs inside the preview webview                    |
| `scripts/build-grammar.mjs`  | Generates `syntaxes/yamd.tmLanguage.json`                      |
| `media/preview.css`          | Preview styles                                                 |
| `test/`                      | `node:test` suites; `conformance.test.ts` runs the CommonMark and GFM spec examples against `fixtures/known-differences.json` |
