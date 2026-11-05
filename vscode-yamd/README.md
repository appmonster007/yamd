# YAMD Studio 1.2

Rich widgets for plain Markdown notes in VS Code. Notes stay ordinary `.md` files; YAMD adds boards, calendars, timelines, galleries and SQL query views as fenced blocks, callouts for study notes, citations, a generated table of contents and bibliography, HTML/slide export and study tools. Without the extension, every note still reads sensibly (a widget is just a code block).

Requires **VS Code 1.145** or later. Installing YAMD also installs [Foam](https://marketplace.visualstudio.com/items?itemName=foam.foam-vscode) (wikilinks, backlinks, graph, daily notes), the SQLite3 Editor, two CSV extensions (Edit CSV for a grid, Rainbow CSV for highlighting and RBQL queries) and Markdown All in One. Commands such as **YAMD: Open in CSV Editor** hand work to them and offer to install any that are missing.

## Widgets

A widget is a fenced block named for its type. Give it an `id` so you can open it by name:

````markdown
```kanban sprint-12
## Todo
- [ ] Write copy {due=2026-11-12}

## Done
- [x] Kickoff meeting
```
````

A CodeLens above the block opens it in a widget preview beside the note. The same actions are in the Command Palette (**YAMD: Open Kanban**, **Open Calendar**, **Open Timeline**, **Open Gallery**, **Open Query**): they open the block under the cursor, the only block of that type, or ask which. Edits there (drag a card, rename, add, tick a task) rewrite the block in the note, and undo works. Types: `kanban`, `calendar` (opens on the next month with an event, with buttons to move between months), `timeline` (with a month scale) and `gallery` (a list of `- ![caption](image)`, or `source="folder/"`). A `bare-word` after the type is the id; with several options use `id=…`.

### Queries

A ` ```sql ` block whose first line is a comment with `source=` is a read-only query over a CSV, JSON or SQLite file next to the note:

````markdown
```sql
-- id="open-bugs" source="bugs.csv" view="table"
SELECT id, title, status FROM bugs WHERE status != 'closed';
```
````

`view` is `table` (default), `board` (`group="status"`) or `chart` (`type="bar|line" x="owner" y="n"`). CSV and JSON load into a table named after the file. Only `SELECT` runs; use **YAMD: Open Query Source in SQL Client** for changes. **YAMD: Run Query** writes a Markdown snapshot (50 rows at most) under the block.

## Callouts, references and Build

Study notes use Obsidian-style callouts. A callout ends at the first line that doesn't start with `>`, so leave a blank line after it:

````markdown
> [!theorem] Pythagorean theorem ^thm-pyth
> For a right triangle, $a^2 + b^2 = c^2$.
````

Types: `definition`, `theorem`, `lemma`, `proof`, `example`, `question`, `remark`, `summary`, `derivation` (numbered per type), plus `note`, `tip`, `important`, `warning`, `caution`, `danger` and `card`.

Mark a figure, table or equation target with `^id` on its own line (`^fig-arch`, `^tbl-results`, `^eq-pyth`), and refer to it as `[@fig-arch]`. **YAMD: Build** turns the reference into `[Figure 1](#fig-arch)` and keeps the label current. It also fills sections between markers (`<!-- yamd:toc depth=3 -->`, `<!-- yamd:bibliography -->`) from the note's headings and the `.bib` file named in its front matter (`bibliography:`, `citation-style:` apa, ieee, chicago, harvard or mla). Build changes only reference labels and marker content, and a second run changes nothing. Turn on `yamd.build.onSave` to build on save.

Citations link to their reference-list entry by default (`[(Smith, 2020)](#ref-smith2020 "cite")`); turn that off with `yamd.build.linkCitations`.

**YAMD: Go to Reference Target** jumps from a reference, citation or image link to its target.

### Review marks

Suggest changes with `<ins>added</ins>` and `<del>removed</del>`, which render in any Markdown viewer. **YAMD: Accept Change at Cursor** and **Reject Change at Cursor** resolve one (or all in a selection); **Accept All Changes** and **Reject All Changes** resolve the whole note.

## Export

**YAMD: Export HTML / PDF / Slides** writes a standalone page next to the note, with callouts numbered, references and citations resolved and widgets rendered as static HTML. PDF opens the page in your browser to print. Slides start a new slide at a `---` rule or an H1/H2 heading. The prose of a note is read as plain Markdown, so a note exports the way VS Code and GitHub show it (a newline inside a paragraph is a space, and `[[page]]` links to `page.md`); tags and `{key=value}` attributes apply only inside widget blocks. Page breaks (`<!-- yamd:pagebreak -->`) and attributes (`<!-- yamd:attrs class=wide width=50% -->` above an element) apply in exports.

### Markers

Every comment YAMD reads is on a line of its own and starts with `yamd:`: regions such as `<!-- yamd:toc depth=3 -->` … `<!-- /yamd:toc -->` (also `bibliography` and `query:ID`), and one-line instructions (`pagebreak`, `attrs`). Any other comment is yours and is never touched. See [examples/01-writing/markers.md](../examples/01-writing/markers.md).

## Study tools

Flashcards are card callouts (`> [!card] Question`, answer in the body) reviewed with SM-2 spaced repetition (`.yamd/srs.json`). The YAMD sidebar lists deadlines (tasks with `{due=YYYY-MM-DD}`); the dashboard, study timer and **YAMD: New Study Note** (lecture, lab report, exam prep, reading note) are in the Command Palette.

## Audio notes

**YAMD: Record Audio and Add Link** records from your microphone in a panel beside the note, saves the file in an `audio` folder next to the note (`yamd.audio.folder`), and writes a link to it on its own line where your cursor was. If VS Code doesn't allow the microphone in the panel, the same recorder opens in your browser instead. See [examples/01-writing/audio.md](../examples/01-writing/audio.md).

## The YAMD sidebar

The YAMD icon in the activity bar has five views: **Widgets in This Note** (click to open one), **Callouts and References** (numbered theorems, definitions, figure, table and equation targets; click to jump), **Flashcards** (due, new and per-course counts, with a Start Review button), **Deadlines**, and **Study and Data Files** (course progress, notes you haven't touched, study time and the data files your queries use).

Backlinks, the note graph and tags come from Foam: **YAMD: Show Backlinks (Foam)**, **Show Note Graph (Foam)** and **Show Tags (Foam)** open them. [examples/06-linked-notes](../examples/06-linked-notes/) has notes to try them on.

## Settings

`yamd.audio.folder`, `yamd.build.onSave`, `yamd.build.linkCitations`, `yamd.study.newCardsPerDay`, `yamd.study.pomodoroMinutes`, `yamd.study.staleAfterDays`.

## What changed from 0.1

YAMD is no longer a separate language: no `.yamd` files, grammar, custom editor, whole-note preview, `.ydb` databases, document variables or DOCX export. Use Foam for wikilinks and the graph, and the companion SQLite/CSV extensions for editing data.
