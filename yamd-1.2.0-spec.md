# YAMD 1.2.0 Specification

**Status:** complete (2026-11-05). Decisions D1–D69 and the defaults in §22 are accepted. Items marked **[UNVERIFIED]** depend on an assumption that has not been tested. Implementation plan: [yamd-1.2.0-plan.md](yamd-1.2.0-plan.md).
**Supersedes direction of:** `yamd-spec.md` (0.1, a separate `.yamd` language) and `yamd-studio-spec.md`.

---

## 1. Summary

YAMD 1.2.0 changes the model from **"YAMD is Markdown plus extra features" (its own language, file type, parser, preview and editor)** to **"Markdown plus YAMD"**:

- Notes are **plain `.md` files** (CommonMark/GFM). No new file type, no new language mode.
- YAMD is a **VS Code extension that adds features on top of ordinary Markdown**, using constructs that Markdown already has: fenced code blocks, blockquotes, links, task lists, tables, front matter, HTML comments.
- VS Code's **built-in Markdown editor and preview are used as they are**. The extension does not replace them.
- Interactive features (boards, tables, query views, study tools) live in **widget previews** opened from the note, which edit the `.md` file or its data file.
- Without the extension, every note must still read sensibly (graceful degradation).

## 2. Goals

1. A note is a normal Markdown file that works on GitHub, in any editor, and with Git.
2. Rich features (boards, calendar, timeline, gallery, query views, study blocks, citations, TOC) are added without a new language.
3. Interactive editing of those features happens in widgets, with edits written back to plain text.
4. Less code to maintain: reuse VS Code's Markdown editor, preview, outline, folding and link handling; reuse Foam for the note graph.
5. (Dropped) Migration of old `.yamd` notes: they are rewritten by hand (D35).

## 3. Non-goals

- A new file format or file extension.
- A custom whole-note live preview or custom whole-note editor (the earlier `yamd.editor` custom editor, lock mode and live-preview decorations are dropped).
- Rendering YAMD extras inside the built-in Markdown editor or preview.
- Supporting VS Code versions older than **1.145**.
- A WYSIWYG editor built inside a webview.

## 4. Decisions log

| # | Decision | Rationale |
|---|---|---|
| D1 | Files are plain `.md`. Drop `.yamd`, its grammar, linter and workspace index. | Markdown interop, less maintenance. |
| D2 | Use **Foam** for wikilinks, backlinks, graph, tags, daily notes. Keep only a small linter for widget blocks. | Foam already covers the workspace layer on plain `.md`. |
| D3 | VS Code **1.145+ only**. No older-version fallback. | The built-in Markdown Editor with block-editor extension points exists from here (verified on 1.145.0). |
| D4 | Widgets are **fenced code blocks** with an info string, e.g. ` ```kanban id=sprint-12 `. | Degrades to a code block everywhere; no new grammar. |
| D5 | Every widget block has a **unique `id`** within its note, so a specific one can be opened. Unnamed blocks get a positional label; a command writes an id into the fence. | Needed when a note has several widgets of one type. |
| D6 | In the built-in editor and preview, a widget stays a **normal code block**. The widget **preview opens on demand** (CodeLens / command) and edits the `.md` through it. | Documented APIs only; no dependence on unverified inline APIs. |
| D7 | The inline code-block editor API (`markdown.codeBlockEditors`) is an **optional later extra**, not the main path. | Message contract and third-party availability are unverified. |
| D8 | **Data file is the only source of truth** for data widgets. The note stores the path and view settings. | Avoids two sources of truth. |
| D9 | A command (Cmd+P) can **run a query and write a result snapshot** into the note between markers. | Lets notes carry a readable result without being the source of truth. |
| D10 | Auto-write is a **command, plus an opt-in on-save setting (default off)**. It touches only marker-delimited sections and is idempotent. | Predictable diffs; user control. |
| D11 | Callouts and study blocks use **Obsidian-style callouts**: `> [!type] Title ^id`. | Familiar; body stays normal editable Markdown. |
| D12 | The widget **design is fixed** and ships with the extension (not user-themable beyond the VS Code theme). | Removes iframe/asset complexity. |
| D13 | Template placeholders are filled **once at note creation**. (Document variables were dropped, D32.) | A filled-in placeholder can't be re-filled. |
| D14 | Cross-references: author writes `[@fig-x]`; Build converts it to `[Figure 2](#fig-x)` and refreshes the label on every later Build. | Real links that degrade well; numbering stays current. |
| D15 | Citations stay in standard Pandoc form `[@key]`; Build writes the bibliography from a `.bib` file between markers. | Pandoc/Zotero compatibility. |
| D16 | Study tooling is built as **separate widgets**, with patterns in plain notes. | Separable from the core. |
| D17 | Interaction in the built-in preview is **not supported**; it is read-only. | The built-in preview can't message the extension. |
| D18 | **One extension**, with features behind settings. It ships as (or with) an **extension pack** of companions: **Foam (hard dependency)**, a SQLite viewer/editor, a CSV editor/viewer, Markdown tooling. VS Code's built-in editor and preview are used as they are. | Reuse popular extensions instead of rebuilding their features. |
| D19 | Where a companion already does something, YAMD adds **alias commands** that redirect to it, rather than reimplementing it. Widgets still use YAMD's own bundled reader/writer (no dependency on companion APIs). | Companion APIs are unverified and may change. |
| D20 | **Drop the `.ydb` format with no migration.** | Overlaps CSV/JSON/SQLite; user decision. |
| D21 | Data sources: **CSV, JSON, SQLite.** | |
| D22 | Query blocks are **SQL only**. The block is a ` ```sql ` fence whose **first line is a SQL comment carrying attributes** (`id`, `source`, optional `view`). | Valid SQL everywhere; highlights as SQL on GitHub. |
| D23 | Widget **id syntax is attribute-based** (`id=name`). If a fence has only one option, a **bare name is taken as the id** (` ```kanban sprint-12 `). | Short for the common case; extensible. |
| D24 | **Query widgets are read-only.** | Avoids ambiguous edits on joins/aggregates. (A separate table editor was dropped in D31.) |
| D25 | **YAMD never runs write SQL.** Writes (bulk UPDATE/DELETE, scripts) are done in a **separate SQL companion extension**; YAMD offers an alias command to open it. | Safety; reuse. |
| D26 | **Daily notes and general templates come from Foam.** YAMD adds only **study note templates**. | Foam covers them. |
| D27 | Exports kept: **HTML, PDF, Slides.** DOCX is dropped. | User decision. |
| D28 | Study tools kept: **flashcards + review session, study dashboard, study timer, deadlines**, all in YAMD's own sidebar and panels (review and dashboard as panels, deadlines as a sidebar list, timer in the status bar with a menu). | User decision; reuses existing code. |
| D29 | Generated-section markers are `<!-- yamd:NAME -->` … `<!-- /yamd:NAME -->`. | Namespaced, explicit. |
| D30 | **No markdown-it plugin.** VS Code's built-in preview renders notes exactly as it normally does; widgets and callouts are not rendered there. | User decision. |
| D31 | **No YAMD table editor.** Data files are opened in companion CSV/SQLite editors via alias commands. YAMD provides only read-only query views. | Companions already provide it. |
| D32 | **Document variables are dropped.** Only one-time template placeholders remain. | User decision. |
| D33 | **All study callout types are numbered** per type within a note. | User decision. |
| D34 | Cross-reference targets (figures, tables, equations) are marked with a **block id `^id`** on its own line after the element, as for callouts. Prefixes `fig-`, `tbl-`, `eq-` (and callout types) decide the numbering group. | User decision. |
| D35 | **`.yamd` is dropped entirely, with no migration command and no alias.** Existing notes are rewritten by hand against this spec. | User decision. |
| D36 | A flashcard is a **card callout**: `> [!card] Question`, with the answer in the body. | Same syntax as every other callout. |
| D37 | **No hover provider.** The extension adds **commands that jump to a reference's target** (citation to its bibliography entry, cross-reference to its target, image reference opens the image in its own tab). | We reuse VS Code's Markdown editor and add no editor behavior beyond commands. |
| D38 | Query `view=` supports **table** (default), **board** and **chart**. `chart` is a view of a query, not a separate widget type. | User decision. |
| D39 | Authoring extras kept: **page breaks** (`<!-- yamd:pagebreak -->`), **attribute effects** (`<!-- yamd:attrs class=wide -->`) and **critic review markup**, all rendered only in exports and widget previews. | User decision. |
| D40 | The flashcard **review schedule is stored in a workspace file** (e.g. `.yamd/srs.json`), versioned with Git. | User decision. |
| D41 | `Run Query` writes a **Markdown table between markers, 50 rows maximum**, with a `last run` timestamp and a `+N more rows` line. The full result is viewed by running the same query in a companion SQL extension. | User decision. |
| D42 | Citation styles: **APA (author-year, default), IEEE (numeric), Chicago/Harvard**, chosen per note with a `citation-style:` front matter key. | User decision. |
| D43 | Slides export starts a new slide at a **`---` rule or an H1/H2 heading**. | User decision. |
| D44 | A gallery's images are written **either as a list of Markdown images (alt text is the caption) or as a folder via `source="img/"`**. | User decision. |
| D45 | An alias command whose companion extension is missing **offers to install it**, then runs once installed. | User decision. |
| D46 | Critic review uses **HTML**: `<ins>`, `<del>`, `<mark>` and HTML comments. | User decision; renders in any renderer. |
| D47 | The linter gives **Problems-panel diagnostics with quick fixes** (e.g. "Name this block"). | User decision. |
| D48 | Ids always use **`^id`**. A comment above an element, `<!-- yamd:attrs class=wide width=50% -->`, adds only extra attributes (classes, sizes) and applies to the next element; exports only. | One way to name things. |
| D49 | **No special links to widgets.** Widgets open from the CodeLens above the fence or the `YAMD: Open Widget` picker. | No clash with Foam; nothing to maintain. |
| D50 | When a data file changes, open **query widgets refresh automatically** (they are read-only). | Nothing to lose. |
| D51 | **No default keybindings.** Everything is available through the Command Palette and CodeLens. | No clashes; users can bind their own. |
| D52 | **PDF is produced by exporting HTML (with a print stylesheet) and letting the user print it from a browser.** No headless browser. | User decision; no browser automation. |
| D53 | Widgets appear in HTML, PDF and slide exports as **static rendered HTML** (boards as columns, queries as tables, charts as SVG). | User decision. |
| D54 | In an **untrusted workspace**, widgets are **read-only**: they can view, but no writes and no queries on files outside the workspace. | User decision. |
| D55 | A flashcard is identified by a **hash of its question text**. Editing the question resets that card's schedule. | User decision; no marker in the note. |
| D56 | Build turns citations into links when `yamd.build.linkCitations` is on (**the default**): `[@smith2020]` becomes `[(Smith & Lee, 2020)](#ref-smith2020 "cite")`, with a locator kept in the title (`"cite: p. 4"`). The key stays in the link target, so later Builds refresh the label (and IEEE numbers). A citation naming an unknown key is left as written. | User decision. |
| D57 | Review marks are HTML `<ins>` and `<del>`. Commands accept or reject the change at the cursor, in a selection, or in the whole note. No review panel. | User decision. |
| D58 | **No cloze deletions or reversible cards in 1.2.0.** Cards are question-and-answer callouts only. | User decision. |
| D59 | The comment above an element may set **any class and any `key=value` pair**; exports sanitize the result. | User decision. |
| D60 | **Both CSV extensions ship in the pack**: Edit CSV (grid editor) and Rainbow CSV (highlighting, alignment, RBQL). Aliases open either. | User decision. |
| D61 | `Run Query` is idempotent: when the result rows are unchanged, the earlier snapshot (and its `Last run` time) is kept. | Found while closing the open items. |
| D62 | **One convention for comment markers.** Everything YAMD reads from an HTML comment sits on a line of its own in the `yamd:` namespace: regions `<!-- yamd:NAME attrs -->` … `<!-- /yamd:NAME -->` (`toc`, `bibliography`, `query:ID`) and one-line instructions `<!-- yamd:NAME attrs -->` (`pagebreak`, `attrs`). Other comments are the author's and are never touched. | User decision, after inventorying nine marker forms. |
| D63 | Marker attributes use the `key=value` / `key="value"` grammar of widget fences; `yamd:attrs` takes `class=wide width=50%` (no `.class` shorthand, no ids). | User decision. |
| D64 | The older forms `<!-- pagebreak -->` and `<!-- {.wide} -->` are **not read**. They are ordinary comments. | User decision. |
| D65 | `%% comment %%` and CriticMarkup (`{++ ++}`, `{-- --}`, `{~~ ~> ~~}`, `{== ==}`, `{>> <<}`) are **removed from the engine**: comments are HTML comments, review marks are `<ins>`/`<del>`. | User decision. |
| D66 | **Exports read prose as plain Markdown (GFM).** YAMD-only syntax (`#tag`, `==mark==`, `++under++`, `x^2`, `H_{2}O`, `{{ var }}`, `^[note]`, `{.class}` and `:::name` typed by hand) is ordinary text there. The full syntax (tags, `{key=value}` attributes) applies **inside widget blocks only**, which are rendered on their own and placed in the page. | User decision. Found because the 0.1 engine rendered a plain note differently from VS Code and GitHub. |
| D67 | In exports (and in flashcard text) **a newline inside a paragraph is a space**, as in Markdown; end a line with two spaces or a backslash for a hard break. | User decision. |
| D68 | `[[page]]` and `[[page\|text]]` in an export link to the note's file next to it (`page.md`, with `#anchor` for `[[page#Heading]]`). `![[page]]` embeds are not supported. | User decision. |
| D69 | The engine is trimmed to what widget blocks and exports use: GFM, `#tags`, `{key=value}` attributes, wikilinks, math, footnotes and the board, study and callout containers. Removed from 0.1: variables, embeds, `::toc`/`::embed`/`::bibliography`, citations and cross-references in the engine (Build does both), inline footnotes, sup/sub, `==mark==`/`++ins++`, block ids on paragraphs, text directives and cloze, ref spans and figure/table/equation numbering, and the details/columns/figure/table/html containers. | Nothing in the 1.2 spec uses them. |

## 5. File format

### 5.1 Notes
- Extension `.md`. Markdown is CommonMark plus GFM (tables, task lists, strikethrough, autolinks).
- Front matter (YAML) is allowed for metadata (title, tags, bibliography path, variables).

### 5.2 Widget blocks
A widget is a fenced code block whose info string starts with the widget type, followed by `key=value` attributes:

````markdown
```kanban id=website-launch
## Todo
- [ ] Write copy {due=2026-11-12}
- [ ] Pick fonts

## Done
- [x] Kickoff meeting
```
````

Rules:
- The first word of the info string is the widget type (`kanban`, `calendar`, `timeline`, `gallery`, plus the ` ```sql ` query block). (D4)
- `id` is unique within the note. Duplicates produce a diagnostic. Ids are lowercase letters, digits and `-`, starting with a letter or digit; the linter reports anything else (W003).
- Info-string syntax: attributes are `key=value` (`key="value with spaces"`). **If the fence has exactly one option and it is a bare word, that word is the `id`**: ` ```kanban sprint-12 ` means ` ```kanban id=sprint-12 `. With two or more options, all must be `key=value`.
- Blocks without an `id` get a positional label (`kanban #2`). A command (`YAMD: Name Block`) writes an id.
- There are no special links to a widget (D49): open it from the CodeLens or the `YAMD: Open Widget` picker.
- In viewers without the extension, the block shows as a code block with readable text.

### 5.3 Widget body formats (draft)
- **kanban:** headings are columns; list/task items are cards. Optional `{due=…}` style attributes on a card line.
- **calendar:** task items with `due=YYYY-MM-DD`.
- **timeline:** task items with `start=` and `end=` (or `due=`) plus optional group headings.
- **gallery:** either a list of Markdown images (`- ![Caption](img/a.png)`; the alt text is the caption), or a folder: ` ```gallery id=trip source="img/" ` (D44).
- **query:** a ` ```sql ` fence. The **first line is a SQL comment with attributes**; the rest is plain SQL:

````markdown
```sql
-- id="open-bugs" source="bugs.csv" view="table"
SELECT id, title, status FROM bugs WHERE status != 'closed';
```
````

  - `source` names the data file (CSV, JSON or SQLite). CSV and JSON are loaded into an in-memory table named after the file; SQLite is queried directly, opened **read-only**.
  - `view` (optional) is `table` (default), `board` or `chart` (D38). `board` takes `group="column"`. `chart` takes `type="bar"` or `"line"`, `x="column"` and `y="column"` (numeric). A missing or wrong column shows a message in the widget (Q003) and a diagnostic (W007).
  - Query widgets are **read-only** (D24, D31). Only `SELECT` runs (§11).

Attribute grammar: `key=value` or `key="value with spaces"`, space-separated, in any order.

## 6. Callouts and study blocks

Syntax: Obsidian-style callouts.

````markdown
> [!theorem] Pythagorean theorem ^thm-pyth
> For a right triangle, $a^2 + b^2 = c^2$.
>
> A second paragraph still belongs to the callout.

This line is outside it.
````

- **End of block:** where the `>` prefix stops. A **blank line after the block is required**, otherwise a following line is absorbed by Markdown's lazy continuation. The linter flags a missing blank line.
- Two adjacent callouts need a blank line between them. Nesting uses `>>`. Fenced code inside a callout needs `>` on each line.
- `^id` after the title gives a reference id (used for `[@thm:…]`-style cross-references).
- Types (draft): `note`, `tip`, `warning`, `danger`, `definition`, `theorem`, `lemma`, `proof`, `example`, `question`, `remark`, `summary`, `derivation`, `card`. Study types (`definition`, `theorem`, `lemma`, `proof`, `example`, `question`, `remark`, `summary`, `derivation`) are **all numbered**, per type within a note (D33). `note`, `tip`, `warning`, `danger` and `card` are not.
- In viewers without the extension, an unknown type shows as an ordinary quote; GitHub renders its known types (NOTE, TIP, IMPORTANT, WARNING, CAUTION).

## 7. Inline tokens

| Token | Written as | Behavior |
|---|---|---|
| Template placeholders | `{{@title}}`, `{{@date}}`, `{{@course}}`, `{{@cursor}}` | Filled once when a note is created from a template; then removed. |
| Cross-references | `[@fig-x]` then `[Figure 2](#fig-x)` | First Build converts to a link; every Build refreshes the label from the key in the link. Targets are marked with `^id` block ids (D34), e.g. `^fig-arch`, `^tbl-results`, `^eq-pyth`, or are headings. |
| Citations | `[@smith2020]` | Kept as is. Bibliography built from the `.bib` file between markers. Style from front matter `citation-style:` (APA default, IEEE, Chicago/Harvard; D42). With `yamd.build.linkCitations` (default on) Build links each citation to its reference-list entry (D56). |
| Attribute effects, page breaks | `<!-- yamd:attrs class=wide width=50% -->`, `<!-- yamd:pagebreak -->` | Invisible in editors; applied in exports (D39, D48). Any class and `key=value` pair (D59). |
| Critic review markup | HTML `<ins>`, `<del>`, `<mark>` plus comments (D46) | Renders as HTML anywhere; shown in exports (D39). Accept/Reject commands at the cursor, in a selection and for the whole note (D57). |

Inline tokens are **not rendered in the built-in editor**. They show as readable text. The extension adds no hover; instead `YAMD: Go to Reference Target` jumps from a reference to its target (D37).

## 8. Generated regions

Sections the extension writes, delimited by marker comments:

````markdown
<!-- yamd:toc -->
- [Intro](#intro)
<!-- /yamd:toc -->
````

- Generated: **TOC**, **bibliography**, cross-reference labels, **query result snapshots** (with a `last run` timestamp). Marker syntax is fixed by D29; The TOC marker takes `depth=N` (default 3).
- Rules: the extension edits **only inside markers**; the operation is **idempotent** (a second run changes nothing); edits go through the editor so **undo works**; the user can always delete the markers.
- Triggers: `YAMD: Build` command; opt-in `yamd.build.onSave` setting (default off).

### Marker convention (D62–D65)

| Kind | Form | Names |
|---|---|---|
| Region | `<!-- yamd:NAME attrs -->` … `<!-- /yamd:NAME -->` | `toc` (`depth=N`), `bibliography`, `query:ID` |
| Instruction | `<!-- yamd:NAME attrs -->` | `pagebreak`; `attrs` (`class=wide width=50%`, applied to the next element in exports) |
| The author's own | `<!-- anything else -->` | never read or changed |

Markers inside fenced code are examples and are ignored. The linter reports an unknown `yamd:` name (M001), a region that is never closed or closed without opening (M002), and a `yamd:attrs` pair it cannot use, such as `id=` or a `.class` shorthand (M003). Outside comments, each remaining syntax has one job: fences for widgets, `-- id="…" source="…"` as the first line of a `sql` block (a SQL comment, since it sits inside the code), `> [!type] Title ^id` for callouts, `^id` on its own line for targets, and `{due=…}` for a task's attributes.

## 9. Commands (Command Palette)

No default keybindings (D51).

| Command | Purpose |
|---|---|
| `YAMD: Open Widget` | Pick a widget block in the note and open its preview (also the CodeLens above each block). |
| `YAMD: Name Block` | Write an `id` into a widget block. |
| `YAMD: Insert Widget` | Insert a template for a widget type with a free id. |
| `YAMD: Run Query (Write Snapshot)` | Run a `sql` block and write its result under it between markers. |
| `YAMD: Build (Refresh Generated Sections)` | Refresh reference links, citation links, the TOC and the bibliography. |
| `YAMD: Insert Table of Contents` / `Insert Bibliography` | Insert the marker pair at the cursor. |
| `YAMD: Go to Reference Target` | From a cross-reference, citation or image link, jump to the target or open the image. |
| `YAMD: Accept / Reject Change at Cursor` | Resolve the `<ins>`/`<del>` under the cursor, or all in a selection. |
| `YAMD: Accept / Reject All Changes` | Resolve every change in the note. |
| `YAMD: Export HTML` / `Export PDF` / `Export Slides` | Standalone page, a page to print, a slide deck. |
| `YAMD: New Study Note`, `Review Cards`, `Open Study Dashboard`, `Start / Pause / Stop Study Timer`, `Prune Card Schedules` | Study tools. |
| `YAMD: Open Query Source in SQL Client`, `Open in SQLite Editor`, `Open in CSV Editor`, `Query CSV with RBQL`, `Open Daily Note` | Aliases that hand work to companion extensions. |

## 10. Editor integration (VS Code 1.145+)

- **Editing:** VS Code's built-in Markdown editing. Optional: the built-in **Markdown Editor** custom editor (`vscode.markdown.editor`, WYSIWYG, with a lock toggle) is used by the user if they choose; YAMD does not depend on it.
- **Preview:** the built-in Markdown preview. YAMD widgets show as code blocks there. YAMD does **not** add a markdown-it plugin (D30).
- **CodeLens:** above each widget block: `Open <type>: <id>` and type-specific actions (e.g. `Add card`). Can be turned off with `editor.codeLens`; all actions also exist as commands.
- **Widget preview:** an extension-owned webview/panel beside the note, showing one widget with a fixed design. It edits the note's block text or the data file.
- **Inline block editor (optional, later):** see §17 for what is known and unknown.

## 11. Data widgets

- Data lives in a file: **CSV, JSON or SQLite** (D21). `.ydb` is dropped with no migration (D20). The note stores only the path and view settings.
- **Query widgets** (` ```sql ` blocks) are **read-only**. Only `SELECT` runs. SQLite files are opened read-only (so writes are impossible regardless of the SQL text); CSV/JSON are loaded into an in-memory copy, so the file cannot be damaged.
- **Editing data files** is done in companion CSV/SQLite editors, opened through alias commands (D31). YAMD ships no table editor.
- **Writes by SQL** (bulk UPDATE/DELETE, scripts) are done in a **companion SQL extension**; YAMD provides an alias command (e.g. `YAMD: Open in SQL Client`) (D25).
- External changes to the data file refresh open query widgets automatically (D50).
- `Run Query` writes a **snapshot** into the note between markers: a Markdown table of at most 50 rows with a `last run` timestamp and a `+N more rows` line (D41). It is never the source of truth. For the full result, run the same query in a companion SQL extension (alias command).
- Workspace Trust: in an untrusted workspace widgets are read-only; writes and reads of files outside the workspace are blocked (D54).

## 12. Workspace layer and companions

- **Foam is a hard dependency** (included in the extension pack, D18). It provides wikilinks, backlinks, graph, tags, daily notes and general templates on plain `.md` (D26).
- The extension pack also includes a **SQLite viewer/editor**, a **CSV editor/viewer** and **Markdown tooling**. Candidates checked on the marketplace on 2026-11-05:

| Role | Candidate (id) | Licence | Notes |
|---|---|---|---|
| Wikilinks, graph, daily notes, templates | `foam.foam-vscode` 0.47.1 | MIT | Updated 2026-11-04; requires VS Code ^1.110; commands include `foam-vscode.open-daily-note`, `create-note`, `show-graph`. |
| SQLite viewer/editor (recommended) | `yy0931.vscode-sqlite3-editor` | GPL-3.0 | Editing and SQL execution (`sqlite3-editor.openPanel`, `execute`, `executescript`); open a file with `vscode.openWith(uri, 'sqlite3-editor.editor')`. |
| SQLite viewer (alternative) | `qwtel.sqlite-viewer` | Freemium (PRO licence keys) | 3.7M installs, but some features sit behind a paid tier; not suitable as a required pack member. |
| CSV grid editor | `janisdd.vscode-edit-csv` | MIT | Grid editor; command `edit-csv.edit`. |
| CSV highlighting and queries | `mechatroner.rainbow-csv` | MIT | 25M installs; column highlighting, alignment, RBQL queries (`rainbow-csv.RBQL`). Both CSV extensions ship in the pack (decided 2026-11-05). |
| SQL client for writes | `mtxr.sqltools` | MIT | Needs a separate SQLite driver extension; the SQLite3 Editor above can also run arbitrary SQL. |
| Markdown tooling | `yzhang.markdown-all-in-one` | MIT | 14.9M installs, last update 2025-03. |

  **Chosen:** Foam, SQLite3 Editor, Edit CSV, Rainbow CSV and Markdown All in One (MIT).
- **Alias commands** redirect to companion features (open in SQLite viewer, open CSV in the CSV editor, run SQL in the SQL client, Foam daily note, etc.). Missing companions: the command offers to install the extension and then runs (D45). Aliases: Open Query Source in SQL Client, Open in SQLite Editor, Open in CSV Editor, Query CSV with RBQL, Open Daily Note.
- YAMD keeps a **small linter** for widget fences, query headers and callouts only (duplicate ids, unknown widget types, missing `source`, missing blank line after a callout), reported in the Problems panel with quick fixes (D47). Codes: W001–W007 (widgets), C001–C002 (callouts), Q001–Q004 (queries), M001–M003 (markers).

## 13. Study tooling

Built as widgets and plain-note patterns inside the one extension, behind settings (D18, D28).

- **Flashcards:** a card callout: `> [!card] Question`, with the answer in the body (D36). A `^id` is optional; without one the card is identified by a hash of its question (D55).

````markdown
> [!card] What is the time complexity of binary search? ^card-bsearch
> $O(\log n)$ — each comparison halves the search space.
````

  Cloze deletions and reversible cards are not in 1.2.0 (D58).
- **Review session:** a widget panel (spaced repetition, SM-2 as today). Schedule stored in a workspace file, e.g. `.yamd/srs.json` (D40). The card key is a hash of the question text (D55). The file is `.yamd/srs.json`, keyed by card id.
- **Study note templates:** the only templates YAMD itself provides (lecture notes, lab report, exam prep, reading note) (D26). Filled once at creation (D13).
- **Dashboard** (panel), **deadlines** (sidebar list), **study timer** (status bar and menu): kept (D28).
- **Bibliography:** `.bib` plus Build (see §7).

## 14. Export

- Exports: **HTML, PDF, Slides** (D27). **DOCX is dropped.**
- HTML export resolves numbered references, citations, callouts and widgets at export time. PDF is produced by printing the HTML export from a browser (D52); widgets are rendered as static HTML (D53). Slides start a new slide at a `---` rule or an H1/H2 heading (D43).

**Dialect (D66–D68).** An export reads the note's prose as plain Markdown, so a note exports the way VS Code's preview and GitHub show it. Widget blocks are rendered separately with the full syntax and inserted at their position, as are query results and `^id` anchors. Cards in the review panel follow the same rule.

## 15. Migration from 0.1

None. `.yamd` is dropped (D35). Existing notes are rewritten by hand to this spec; `.ydb` files and `::db` blocks are not carried over (D20).

## 16. Graceful degradation

| Feature | Without the extension |
|---|---|
| Widget fence | Code block with readable text |
| Callout | Quote (GitHub styles known types) |
| Generated region | Normal Markdown content; markers invisible |
| Cross-reference | A normal link |
| Citation | Literal `[@key]` text |
| Variable | The last built value |

## 17. Technical findings (VS Code 1.145.0, inspected locally)

**Verified** by reading the installed built-in Markdown extension:
- It contributes two custom editors for `.md`: **Markdown Preview** (`vscode.markdown.preview.editor`) and **Markdown Editor** (`vscode.markdown.editor`, WYSIWYG-style with lock), both opt-in.
- It supports `markdown.markdownItPlugins`, `markdown.previewStyles`, `markdown.previewScripts`.
- It defines **code-block editor** contributions, `markdown.codeBlockEditors` (fields `id`, `language`, `entrypoint`, `contentType` of `text` or `json`) and `markdown.codeBlockEditorProviders`, hosted in a **sandboxed iframe** with host-transport messaging.

**[UNVERIFIED]** (must be tested before relying on them):
- The iframe/host **message contract** for block editors.
- Whether **third-party marketplace extensions** may use these contribution points.
- How block-editor edits interact with **undo and save**.
- **Stability** of these APIs.
- Whether the built-in Markdown Editor honors **markdown-it plugins** (it appears to have its own parser).
- Whether `command:` links work in the built-in preview.

## 18. Risks and blockers

1. The inline block-editor API is unverified (mitigated by D6/D7).
2. Auto-writing the note can cause diff noise and conflicts (mitigated by markers, idempotence, opt-in on-save).
3. Data widgets touch files outside the note (trust, conflicts, sync).
4. Callouts require a blank line to end; users will forget (linter diagnostic).
5. Features with inline syntax can't render in the editor.
6. Foam is a separate project and may change.
7. Migration of existing notes may be lossy for rarely used syntax.

## 19. Not supported in 1.2.0

- Rendering inline tokens, `:::` blocks, attribute effects, critic markup or numbered references inside the built-in Markdown editor/preview.
- A `.yamd` file type or migration command, custom grammar, language mode, whole-note custom preview, in-tab editor toggle, preview lock mode, live-preview decorations.
- Interaction in the built-in preview.
- VS Code older than 1.145.
- Document variables, a YAMD table editor, markdown-it rendering in the built-in preview, DOCX export, the `.ydb` format and database formulas (dropped). Daily notes and general templates (provided by Foam). Writing SQL from YAMD (use a SQL companion extension).

## 20. As built

| Area | Where |
|---|---|
| Markdown engine (parser, micromark syntax, renderer, sanitizer) | `src/core/markdown/` (kept from 0.1; used behind widget panels and exports through `compat.ts` and `export/prepare.ts`) |
| Widgets: fence scanner, linter, board edit logic | `src/core/widgets/` |
| Queries | `src/core/query/` (sql.js, read-only) |
| Callouts, references, Build, review marks, citations | `src/core/build/`, `src/core/citations/` |
| Export | `src/core/export/` and `src/extension/build/exportCommands.ts` |
| Study tools | `src/core/study/`, `src/study/` (a slim `StudyIndex` replaced the workspace index) |
| VS Code layer | `src/extension/{widgets,query,build,companions,shared}/` |
| Widget panel scripts | `src/webview/` |

Removed from 0.1: the `.yamd` language, custom editor and preview, lock mode, live preview, the workspace index and graph, `.ydb` and database views, DOCX and importers, document variables.

## 21. Build order (done)

1. Fence scanner, ids, linter. 2. CodeLens and widget panel (kanban). 3. Calendar, timeline, gallery. 4. Queries and snapshots. 5. Callouts, references, Build. 6. Study tools. 7. Export. 8. Companions and aliases. 9. Removal of the 0.1 code. 10. QA (manual checks in VS Code still to do).

## 22. Defaults adopted for remaining details (change on request)

| Area | Default |
|---|---|
| Widget id characters | Lowercase letters, digits and `-`; unique per note; case-sensitive. |
| Fence attribute grammar | `key=value` or `key="value with spaces"`, space-separated, any order. In a ` ```sql ` header the same grammar follows `-- `. |
| Widget types | `kanban`, `calendar`, `timeline`, `gallery`, and the ` ```sql ` query block. |
| Board view | `view="board" group="status"`. |
| Chart view | `view="chart" type="bar\|line" x="month" y="total"`. |
| Generated-region options | TOC accepts `depth=2` in the opening marker. |
| Citation links | On by default; `yamd.build.linkCitations` turns them off (D56). |
| Supported attribute effects | Any class and `key=value` pair, applied in exports only (D59). |
| Critic review | Accept/Reject commands for `<ins>`/`<del>` at the cursor, in a selection and for the whole note; no review panel (D57). |
| Review file | `.yamd/srs.json`, keyed by card-question hash. |
| Cloze, reversible cards | Not in 1.2.0 (D58). |
| Parser | Keep micromark, reduced to scanning fences, callouts and inline tokens. |
| Companion extensions | Foam, SQLite3 Editor, Edit CSV, Rainbow CSV, Markdown All in One (D60). |
| Alias commands | Open Query Source in SQL Client, Open in SQLite Editor, Open in CSV Editor, Query CSV with RBQL, Open Daily Note. |
| Diagnostic codes | W001–W007 widgets, C001–C002 callouts, Q001–Q004 queries, M001–M003 markers. |
| Command list | Open Widget, Name Block, Insert Widget, Run Query, Build, Go to Reference Target, Export HTML, Export Slides, New Study Note, Start Review, Open Dashboard, Study Timer, Open in … (aliases). |

## 23. Open questions

None. Items that still need checking are **[UNVERIFIED]** assumptions in §17 (the inline block-editor API, which YAMD does not use) and a manual pass in VS Code (plan, Phase 10).
