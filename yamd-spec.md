# YAMD Specification

**Version:** 0.1 (draft)
**File extension:** `.yamd`
**Media type:** `text/yamd`

YAMD is a plain-text markup format. It keeps what makes Markdown easy (readable source, minimal syntax, familiar markers) and fixes the problems listed in [markdown-pain-points.md](markdown-pain-points.md).

**YAMD is built on GitHub Flavored Markdown (GFM).** A GFM document is parsed exactly as GFM parses it, and YAMD adds its own syntax on top. [Differences from GFM](#13-differences-from-gfm) lists every case where the same text renders differently, with the fix for each.

---

## 0. Design principles

1. **One spec, no flavors.** There is exactly one grammar. Features beyond the core are added only through one generic directive syntax, which renders predictably even when a tool doesn't understand it.
2. **What you see is what you get.** Pressing Enter starts a new line. Whitespace you can't see never changes the output.
3. **GFM is the baseline.** Where GFM defines a behavior, YAMD keeps it, so existing Markdown keeps working. YAMD changes GFM only where a pain point can't be fixed otherwise (line breaks), and adds syntax only where GFM has none.
4. **No silent failures.** Every input renders, and anything suspicious also produces a diagnostic with a code and a line number.
5. **One canonical style.** `yamd fmt` produces one style with no options, which ends style debates and noisy diffs.
6. **Secure by default.** Raw HTML is sanitized with GitHub's allow-list, URL schemes are allow-listed, and embeds are explicit.
7. **Easy stays easy.** The advanced features are opt-in. A beginner needs only section 1.

---

## 1. At a glance

````yamd
---
yamd: 0.1
title: Release Notes
author: Ada
vars:
  version: 2.4.0
---

# Release {{version}}

Pressing Enter
starts a new line. A blank line starts a new paragraph.

**bold**, *italic*, ++underline++, ~~strike~~, ==highlight==, `code`
H_{2}O, x^{2} and x^2

- Bullet item
  - Nested item
- [x] Done task

1. First
2. Second

> A quote

[A link](https://example.com) and a bare link https://example.com
![Architecture diagram](img/arch.png){width=600 align=center}

| Name | Value |
| ---- | ----: |
| a    |     1 |

:::note
This is a callout.
:::

%% This comment is never rendered %%
````

---

## 2. Document basics

- **Encoding:** UTF-8 only. A byte-order mark is ignored.
- **Line endings:** LF. CRLF is accepted and normalized, and `yamd fmt` writes LF.
- **Tabs:** tabs in indentation work as in GFM (a tab stop every 4 columns) but produce warning `Y101`, because they make nesting hard to see. `yamd fmt` converts them to spaces. Tabs inside text are kept.
- **Trailing whitespace:** two trailing spaces still make a line break, as in GFM, but they are never needed: a newline is already a break.
- **Final newline:** `yamd fmt` ensures exactly one.

### 2.1 Front matter

- It is optional. If present, it must start on line 1 with `---` and end with `---`.
- **The content is YAML only.** TOML and JSON front matter are not supported.
- Reserved keys:

| Key            | Purpose                                                   |
| -------------- | --------------------------------------------------------- |
| `yamd`         | Spec version the document targets, e.g. `0.1`             |
| `title`        | Document title; acts as the H1 if the body has none       |
| `author`       | String or list                                            |
| `date`         | ISO 8601 date                                             |
| `lang`         | BCP 47 language tag, e.g. `en-US` (used for accessibility) |
| `vars`         | Map of variables, see [Variables](#58-variables)          |
| `bibliography` | Path to a BibTeX or CSL-JSON file for citations           |
| `toc`          | `true` to insert a table of contents after the title      |

You can add other keys freely. Renderers must ignore keys they don't recognize.

---

## 3. Block elements

### 3.1 Paragraphs and line breaks

- **A single newline is a line break.** What you type is what renders. This is the one place where YAMD reads GFM text differently.
- **A blank line ends a paragraph.**
- GFM's hard breaks (two trailing spaces or a trailing `\`) still work, but they're redundant. A trailing `\` produces information `Y201`, which suggests removing it.
- A paragraph that looks hard-wrapped (3 or more lines, each 60+ characters, not ending in sentence punctuation) produces information `Y210`, with a quick fix that joins the lines.

```yamd
Roses are red
Violets are blue

New paragraph.
```

Don't hard-wrap prose. Use your editor's soft wrap instead. `yamd fmt` never reflows text.

### 3.2 Headings

- ATX headings: 1 to 6 `#` characters, a space, then the text. Closing `#` sequences are removed, as in GFM.
- Setext headings (text underlined with `===` or `---`) work as in GFM. `yamd fmt` rewrites them as ATX headings.
- `#word` with no space is a **tag** (see [Tags](#410-tags)). `##word` is plain text and produces warning `Y301`, which says "did you mean a heading?".
- You can add an explicit ID: `## Install {#install}`.

### 3.3 Lists

Lists follow GFM.

**Bullets**
- `-`, `*` and `+` all work. **Changing the marker with no blank line in between nests one level deeper**, under the last item of the list above — a second way to nest, alongside indentation (see **Nesting** below). This diverges from GFM, where a marker change always starts a new list at the same level; add a blank line before the new marker to get that instead. YAMD reports information `Y212` wherever a marker change nests a list, as a reminder of what happened. `yamd fmt` keeps each list's marker.

**Ordered**
- Use `1.` or `1)`. The list starts at the first item's number, and the following items are numbered in order whatever is written. `yamd fmt` rewrites the numbers to match.
- Only a list that starts at `1` can interrupt a paragraph, so `2024. Great year` on a line inside a paragraph stays text. Escape the period (`2024\. Great year`) to keep it as text anywhere.
- `{start=5}` on the line above a list also sets the start number.

**Nesting**
- An item's content (including nested lists) must be indented to at least the column where the item's text starts: 2 spaces after `- `, 3 after `1. `. This is GFM's rule; `yamd fmt` normalizes nesting to that column.
- Changing the bullet marker with no blank line in between nests the new list one level under the previous item instead of indenting it — handy for content (like alternating dialogue) that doesn't want extra indentation. Only unordered-to-unordered switches work this way; ordered lists and marker changes after a blank line are unaffected. Switching through a third marker (e.g. `-` then `+` then `*`, each adjacent) nests one level deeper each time.

**Continuity**
- A bullet list, or an ordered list starting at 1, may start directly after a paragraph line with no blank line.
- Blank lines between items make the list *loose* (each item's text is wrapped in a paragraph), as in GFM.
- Code blocks, quotes, tables and paragraphs indented under an item belong to that item, and numbering continues after them.

**Tasks**
- `- [ ]` is an open task and `- [x]` is a done one. This works in ordered lists too.

### 3.4 Blockquotes

- Lines start with `>`. Nest quotes with `> >`.
- As in GFM, a paragraph line without `>` directly after a quote line continues the quote (*lazy continuation*). YAMD reports warning `Y401` on such lines, because they're easy to misread; add `>` or a blank line to make the intent clear.

### 3.5 Code blocks

- Fenced code blocks are the recommended form. Indented code blocks (4 spaces) work as in GFM; `yamd fmt` rewrites them as fences.
- The fence is 3 or more backticks or tildes. The closing fence uses the same character and is at least as long as the opening one.
- The info string is the language followed by optional attributes:

````yamd
```python {title="app.py" lines=10-20 highlight=12}
print("hi")
```
````

- An unclosed fence runs to the end of the enclosing block (as in GFM) and produces error `Y501`.

### 3.6 Thematic break

- `---`, `***` or `___` alone on a line. Directly under a paragraph line, `---` makes that line a setext heading instead (GFM); add a blank line before it to get a break.

### 3.7 Tables

**Pipe tables** are for simple data:

```yamd
{caption="Pricing" #tbl:pricing}
| Plan  | Price | Notes          |
| :---- | ----: | :------------: |
| Basic |    $5 | `a\|b` is fine |
```

- Tables follow GFM: outer pipes are optional (`yamd fmt` adds them), and a header row and a separator row are required. Rows with too many or too few cells are cut or padded to the header's width.
- A table without the separator row isn't a table; YAMD reports error `Y703` because headers are needed for accessibility.
- Aligning the columns in the source is optional, and `yamd fmt` aligns them.
- Use `\|` for a literal pipe, including inside inline code (GFM splits cells before reading code spans).
- Merge cells with an attribute at the end of the cell: `| Total {colspan=2} |`.

**List tables** are for complex content such as multi-line cells, lists in cells, or merged cells:

```yamd
:::table {header=1 caption="Features"}
- - Feature
  - Details
- - Export
  - Supports:
    - PDF
    - Word
- - Sync {colspan=2}
:::
```

Each top-level item is a row, and each nested item is a cell. A cell can hold any block content.

### 3.8 Math

- Inline: `$E = mc^2$`. The opening `$` must be followed by a non-space and the closing `$` must be preceded by a non-space and not followed by a digit. So `$5 and $10` stays plain text.
- Block:

```yamd
$$ {#eq:energy}
E = mc^2
$$
```

- Math is rendered as LaTeX math (as in KaTeX and MathJax).

### 3.9 Diagrams

- ` ```mermaid ` is a standard diagram block. Renderers that don't support diagrams show it as a code block.

### 3.10 Directives

Directives are the **only** extension mechanism. They come in three forms:

| Form      | Syntax                                 | Example                    |
| --------- | -------------------------------------- | -------------------------- |
| Container | `:::name {attrs}` … `:::`              | callouts, columns, details |
| Leaf      | `::name[label]{attrs}` (one line)      | `::toc`, `::pagebreak`     |
| Inline    | `:name[content]{attrs}`                | `:kbd[Ctrl+C]`             |

- To nest containers, use more colons on the outer one (`::::` wraps `:::`).
- **Unknown directives degrade gracefully.** A container renders its contents as normal blocks, and a leaf or inline directive renders its label as text. Both also produce diagnostic `Y601`.
- Vendor-specific directives must be prefixed with `x-`, for example `:::x-acme-chart`, so they can never collide with future standard ones.

See [Standard directives](#6-standard-directives) for the built-in set.

---

## 4. Inline elements

### 4.1 Emphasis

| Syntax                    | Result        | Source |
| ------------------------- | ------------- | ------ |
| `*text*` or `_text_`      | italic        | GFM    |
| `**text**` or `__text__`  | bold          | GFM    |
| `***text***`              | bold italic   | GFM    |
| `~~text~~` or `~text~`    | strikethrough | GFM    |
| `++text++`                | underline     | YAMD   |
| `==text==`                | highlight     | YAMD   |

Emphasis follows GFM's rules: `*` works inside words (`un*believ*able`) but `_` doesn't, so `snake_case_name` stays literal. `++` and `==` use the same rules as `~~`, so `C++ and C++` and `a == b` stay plain text.

**Subscript and superscript** use LaTeX's notation and attach to the character before them:

| Syntax                 | Result                 |
| ---------------------- | ---------------------- |
| `H_{2}O`               | H with subscript 2, O  |
| `x^{2}`, `e^{i\pi}`    | superscript            |
| `x^2`, `10^-3`         | superscript (digits, with an optional `-`, need no braces) |

A `_` or `^` after a space stays literal (`a _{b}`), and the braces can contain other inline markup.

### 4.2 Code spans

- `` `code` ``. To include a backtick, wrap the span in a longer run of backticks: ``` `` a`b `` ```. A single leading and trailing space inside the delimiters is stripped.
- Nothing inside a code span is interpreted, including pipes, `$` and `{{`.

### 4.3 Links

- Inline: `[text](url "optional title")`
- Reference: `[text][id]` with `[id]: url` defined anywhere in the document
- **Bare URLs** (`https://`, `http://`, `www.` and email addresses) autolink, as in GFM. To show a URL without a link, put it in a code span.
- Angle-bracket autolinks `<https://…>` are still accepted.
- Internal links:
  - `[text](guide.yamd#install)` links by path.
  - `[[guide]]`, `[[guide#Install]]`, `[[guide#^block]]` and `[[guide|label]]` are wiki-style links. A target resolves in this order: a path relative to the current note, a path from the project root, a note whose **file name** matches anywhere in the project, then a note whose `aliases` front matter contains it. Name and alias matching ignore case. When a name matches several notes, the shortest path wins and the linter reports `Y709`.
  - `[[#install]]` links to a section of the same document.
- The linter checks that every internal link target exists (`Y701`).

### 4.4 Images

```yamd
![Alt text](path/to/img.png "Title"){width=400 align=center}
```

- Supported size and alignment attributes are `width`, `height` and `align=left|center|right`.
- **Alt text is required** (`Y702` error). For purely decorative images, use `{decorative}` with empty alt text.
- An image alone in its paragraph that has a `caption` attribute becomes a numbered **figure**:

```yamd
![System overview](arch.png){caption="High-level architecture" #fig:arch}
```

### 4.5 Spans and attributes

Use `[text]{attrs}` to style any run of text:

```yamd
[Warning]{color=red} [small print]{.muted} [centered]{align=center}
```

### 4.6 Footnotes

- Reference: `[^id]`. Definition: `[^id]: text`. Indent the lines that follow a definition to give it more paragraphs.
- Inline footnote: `^[text of the note]`.
- Footnotes are numbered in order of first reference, whatever their IDs.

### 4.7 Cross-references and citations

- Give any element a label: `{#fig:…}`, `{#tbl:…}`, `{#eq:…}`, `{#sec:…}`.
- Reference it with `[@fig:arch]`, which renders as "Figure 2" with a link.
- Any other `[@key]` is a **citation** looked up in the `bibliography` file. Several citations go in one bracket: `[@smith2020; @lee2021, p. 4]`.

### 4.8 Variables

- `{{ name }}` inserts a value from `vars` in the front matter, and dotted paths (`{{ product.name }}`) are supported.
- Built-ins are `{{ title }}`, `{{ author }}` and `{{ date }}`.
- An undefined variable renders literally and produces error `Y801`. Escape a literal brace pair as `\{{`.

### 4.9 Comments

- `%% text %%` works inline. A line starting with `%%` starts a block comment that runs to a line ending with `%%`.
- Comments are **removed at parse time** and never reach the output, including the HTML source. HTML `<!-- -->` comments are also removed by the sanitizer (see [Security](#9-security)).

### 4.10 Tags

- `#word` after a space, `(` or the start of a line is a tag, as in Obsidian: `#project/alpha`, `#2026-review`. A tag must contain a non-digit, so `#1` stays text.
- Tags render as labels and can be searched across files. Nest tags with `/`: `#project/web` is also under `#project`.
- A `tags` list in the front matter adds tags too: `tags: [planning, project/web]`.

### 4.11 Embeds and block IDs

- `![[note]]` shows another note in place, `![[note#Heading]]` the section under that heading (up to the next heading of the same or higher level), and `![[note#^id]]` one block. `![[image.png]]{width=300}` embeds an image.
- Embedded content renders with the embedded note's own front matter (so its variables resolve) and links back to it. Embeds nest at most 5 levels; an embed that would include a note already being embedded shows a placeholder instead, and the linter reports `Y602`.
- A paragraph or list item whose last line ends with a space and `^id` (letters, digits, `-`) gets that **block ID**. The `^id` isn't shown; it becomes the element's `id`. A block ID must be unique in its note (`Y708`).
- Missing notes, headings and blocks in links and embeds produce `Y701`.

### 4.12 Aliases and template placeholders

- `aliases: [Q3 Plan, Roadmap 2026]` in the front matter lets `[[Q3 Plan]]` link to the note.
- In templates, `{{@date}}`, `{{@date:DD/MM/YYYY}}`, `{{@time}}` and `{{@title}}` are replaced when the template is inserted, and `{{@cursor}}` marks where the cursor goes. Formats use the tokens `YYYY`, `MM`, `DD`, `HH` and `mm`. Placeholders aren't variables: outside a template insertion they stay as written, with no `Y801`.

---

## 5. Attributes

Attributes give any element an ID, classes and key/value settings using one syntax:

```text
{#id .class1 .class2 key=value key2="value with spaces" flag}
```

| Where       | Placement                                                         |
| ----------- | ----------------------------------------------------------------- |
| Block       | On its own line **directly above** the block                      |
| Heading     | At the end of the heading line: `## Title {#id}`                  |
| Inline      | **Directly after** the element, with no space: `![a](b){width=50}` |
| Code fence  | After the language: ` ```js {title="x.js"} `                      |
| Directive   | After the name: `:::note {title="Heads up"}`                      |
| Table cell  | At the end of the cell content                                    |

Renderers must ignore keys they don't recognize. They must never render attribute text as visible content.

---

## 6. Standard directives

| Directive                            | Purpose                                                       |
| ------------------------------------ | ------------------------------------------------------------- |
| `:::note`, `:::tip`, `:::warning`, `:::danger` | Callouts; optional `{title="…"}`                    |
| `:::details {summary="…"}`           | Collapsible section                                           |
| `:::columns` with `:::column` inside | Multi-column layout; columns stack on narrow screens          |
| `:::figure {caption="…" #fig:x}`     | Figure wrapping any content, not only images                  |
| `:::table`                           | List table, see [Tables](#37-tables)                          |
| `:::html`                            | Raw HTML; rendered **only** in trusted mode, see [Security](#9-security) |
| `:::kanban {title="…"}`              | Kanban board, see [Kanban boards](#61-kanban-boards)          |
| `::db[ref]{…}`                       | Database view, see [Databases and queries](#62-databases-and-queries) |
| `:query[SQL]{db=…}`                  | Inline query result                                           |
| `::toc{depth=3}`                     | Table of contents                                             |
| `::include[path.yamd]`               | Transclude another file; `{section=install}` includes one section |
| `::pagebreak`                        | Page break in print or PDF output                             |
| `::embed[https://…]{width=640}`      | Video or social embed from the renderer's allow-list          |
| `::bibliography`                     | Where the reference list renders (it goes at the end by default) |
| `:kbd[Ctrl+S]`                       | Keyboard key                                                  |
| `:abbr[HTML]{title="HyperText Markup Language"}` | Abbreviation                                     |

Includes are resolved like wikilinks (§4.3). Circular includes are an error (`Y602`).

### 6.1 Kanban boards

A board is ordinary YAMD inside `:::kanban`, so it reads well as text and degrades to headings and task lists:

```yamd
:::kanban {title="Sprint 12"}
## Todo {limit=3}

- [ ] Fix login on Safari #bug {due=2026-10-10 owner=ada}
  Users get logged out after the redirect.

## Done {complete}

- [x] Set up CI
:::
```

- Each heading inside the board starts a **column**; each top-level list item under it is a **card**. The card's first line is its title, and its indented lines are its body.
- Column attributes: `{limit=N}` sets a work-in-progress limit, shown as `count/N` and highlighted when exceeded; `{complete}` marks a column whose cards are done.
- Card metadata: `#tags` show as chips, `{due=YYYY-MM-DD}` shows a date badge (red when overdue and not done), and `{owner=name}` shows the owner. A ticked checkbox means done.
- Content before the first column heading isn't shown on the board (warning `Y603`). A column over its limit gets information `Y604`.
- Board headings are columns, not document sections: they are left out of the table of contents and the outline, and aren't checked by `Y704` and `Y705`.
- Editors may let users drag cards. A move rewrites the card's lines (title and body) at the new place, ticking the card when it enters a `{complete}` column and unticking it when it leaves one.
- A database can also be shown as a board: `::db[tasks]{type=board group=Status}` (§6.2). The group property must be a select, status, person or checkbox (`Y855` otherwise).

### 6.2 Databases and queries

**Database files.** A `.ydb` file is YAML: `yamdb: 0.1`, an optional `name`, `properties` (name → type, or `{type, options, database, expression}`), optional `views`, and `rows` (each with a unique `id`). SQLite files (`.sqlite`, `.sqlite3`, `.db`) are databases too; each table is referenced as `file#table`, with property types from a `_yamd_meta` table (`key` = table name, `value` = JSON `{properties, views}`) or inferred from the column types.

Property types: `title`, `text`, `number`, `select`, `multi_select`, `status`, `date`, `checkbox`, `url`, `email`, `person`, `relation` (rows of another database), `formula` (an SQL expression over the row) and `created_time`/`updated_time` (set automatically).

**Scope.** A note can only use databases in its own folder or a subfolder. Parent paths, absolute paths and symlinks that lead outside are refused (`Y951`). The `databases:` front matter key gives them aliases:

```yamd
---
databases:
  tasks: data/tasks.ydb
  crm: data/crm.sqlite#contacts
---
```

**Views.** `::db[ref]{view type filter sort group columns limit date cover}` shows a database as a `table`, `list`, `gallery`, `calendar` or `board`. `view` names a saved view; the other attributes override it. `sort` lists properties, with `-` for descending; selects sort in option order.

**Queries.** A ` ```query {db=ref view=table|list|value} ` block runs read-only SQL and shows the result; `:query[SQL]{db=ref}` shows the first cell inline. A `.ydb` database is a table named after its file; `multi_select` and `relation` values are JSON arrays, checkboxes 0 or 1, dates ISO text. Without `db`, a query runs over the notes in the note's folder and below: `notes` (path, title, folder, created, modified, `properties` JSON and one column per front matter key), `tags` (path, tag), `links` (source, target) and `tasks` (path, line, text, done). ` ```sql ` blocks are only code and never run.

**Security.** Queries run only in trusted workspaces. Document SQL must be one read-only statement (`Y950`); `ATTACH`, `DETACH`, `PRAGMA`, `VACUUM` and file functions are refused, and queries run on an in-memory copy. Queries stop after a time limit (`Y952`) and show at most a row limit. Results are always escaped text. Edits from a preview are structured operations with bound parameters, never SQL from the document.

---

### 6.3 Study-aid blocks

A set of container directives for academic writing. They are numbered per kind within a note, can carry an optional `{title="…"}` and an `{#id}` for cross-referencing (§6.3.1), and are gathered by the VS Code extension for cheat-sheet generation.

| Container       | Renders as  | Numbered |
| --------------- | ----------- | -------- |
| `:::definition` | Definition  | yes      |
| `:::theorem`    | Theorem     | yes      |
| `:::lemma`      | Lemma       | yes      |
| `:::proof`      | Proof       | no       |
| `:::example`    | Example     | yes      |
| `:::question`   | Question    | yes      |
| `:::remark`     | Remark      | no       |
| `:::summary`    | Summary     | no       |
| `:::derivation` | Derivation  | no       |

```yamd
:::theorem {title="Pythagorean theorem" #thm:pythagoras}
For a right triangle with legs $a$, $b$ and hypotenuse $c$: $a^2 + b^2 = c^2$.
:::

:::proof
Drop a perpendicular from the right angle…
:::
```

#### 6.3.1 Cross-references

`[@id]` or `[@prefix:key]` creates a numbered cross-reference to any block or figure with that ID. Recognised prefixes are `fig`, `tbl`, `eq`, `sec`, `def`, `thm`, `lem`, `ex`, `q`, `rem`. Keys not matching a known prefix are treated as citation keys (§6.5.2).

---

### 6.4 Flashcards and spaced repetition

YAMD has three ways to mark content as a flashcard. The VS Code extension collects them and schedules reviews using the SM-2 algorithm; the schedule is stored in `.yamd/srs.json`.

**Container card** — a block with a `---` separator between the question and the answer:

```yamd
:::card
What is the time complexity of binary search?
---
$O(\log n)$ — each comparison halves the search space.
:::
```

**Leaf card** — a one-line Q&A, useful for vocabulary or definitions:

```yamd
::card[What does "idempotent" mean?]{a="Applying the operation more than once has the same effect as once."}
```

**Cloze deletion** — hide a word or phrase inline. Each `:cloze[…]` in a paragraph becomes one card; cards in the same paragraph share a `{n=…}` group so they are shown independently:

```yamd
The :cloze[mitochondrion] is the :cloze[powerhouse] of the cell.

The derivative of $\sin x$ is :cloze[$\cos x$]{n=1}.
```

- A card with no answer produces diagnostic `Y605`.
- Each card has a stable ID: the explicit `{#id}`, or a hash of its text. Renaming a card (changing the text) produces a new ID and a new scheduling entry.
- **Quiz mode** hides cloze answers in the preview so a note doubles as a self-test. The VS Code command `YAMD: Toggle Quiz Mode` switches it on and off.
- **Review** (`YAMD: Review Flashcards`) shows due cards one at a time. Each is graded *Again*, *Hard*, *Good* or *Easy*; the SM-2 algorithm schedules the next date. `yamd.study.newCardsPerDay` limits how many unseen cards appear per session.
- `YAMD: Prune Orphaned Card Data` removes scheduling data for cards that no longer exist in any note.

---

### 6.5 Courses, deadlines and progress

Notes name a course with `course: CS101` in their front matter. Tasks and kanban cards name due dates with `{due=YYYY-MM-DD}`. The VS Code dashboard (`YAMD: Open Study Dashboard`) shows an agenda, per-course progress bars, stale topics, a study-log heatmap and the review queue.

#### 6.5.1 Agenda and deadlines

A note's own `due:` front matter key marks the whole note as a submission. Task items anywhere in a note can carry `{due=…}` to mark individual deliverables. The dashboard groups them into *overdue*, *today*, *this week*, *later* and *done*.

#### 6.5.2 Progress

Checked tasks count towards completion. A note not opened or not marked `reviewed: YYYY-MM-DD` in front matter for `yamd.study.staleAfterDays` days (default 14) is flagged as stale.

---

### 6.6 Study timer

`YAMD: Start Study Timer` starts a focus session (default 25 minutes, configurable via `yamd.study.pomodoroMinutes`). A status-bar item counts down; clicking it shows a menu to pause, resume, finish or cancel. When the session ends at least one minute of focused time is logged. Optionally (`yamd.study.logToDailyNote: true`, default on) a line is appended to today's daily note under a **Study log** heading.

---

### 6.7 Citations

YAMD uses BibTeX. The `bibliography:` front matter key names a `.bib` file relative to the note or the workspace root. Citations use the key from that file:

```yamd
---
bibliography: refs.bib
citation-style: apa   # apa (default) | mla | chicago | ieee | vancouver
---

[@turing1950] argues that a machine passes the test when…

Inline note: [@dijkstra1968, p. 12].
```

- Supported locators: `p.`, `pp.`, `ch.`, `sec.`, `fig.`, `eq.`, `no.`, `vol.`, `ed.`, `trans.`; add before the comma after the key.
- `::bibliography` (or a leaf with no label `::bibliography`) places the reference list; otherwise it appears at the end of the document.
- `YAMD: Add Citation` looks up a DOI, arXiv ID or ISBN and appends the BibTeX entry to the note's `.bib` file. Lookup requires network access; the command falls back to a paste-box when offline.

---

### 6.8 Peer review summary

The review-markup operators (§7) are plain text; the VS Code extension adds two commands:

- `YAMD: Accept All Review Changes` — applies all insertions and deletions, removes markup.
- `YAMD: Reject All Review Changes` — reverts to the original text, removes markup.

The review panel (`YAMD: Review Flashcards` shares the panel) also shows a diff of pending changes for a quick pass.

---

### 6.9 Export

**HTML** (`YAMD: Export as HTML`) — a self-contained HTML file with a title page (when `title:` is set), a linked table of contents, and a print stylesheet. KaTeX math and syntax-highlighted code are inlined.

**PDF** (`YAMD: Export as PDF`) — the same HTML is opened in the system browser. Use File → Print → Save as PDF for the final file.

**Word (.docx)** (`YAMD: Export as Word (.docx)`) — a minimal OOXML package with headings, paragraphs, bold/italic/code/links, tables and task lists.

**Slides** (`YAMD: Export as Slides (HTML)`) — each level-1 heading (or a `---` thematic break) starts a new slide. The output is a single HTML file with a keyboard-navigable presentation.

---

### 6.10 Note templates

`YAMD: New Study Note…` shows a template picker with four built-in templates: **Lecture notes**, **Lab report**, **Exam prep** and **Reading note**. Each template has placeholders `{{@date}}`, `{{@title}}`, `{{@course}}` and `{{@cursor}}` (where the cursor should land).

---

### 6.11 Importing from other tools

`YAMD: Import Notes from Folder…` converts a folder of notes to YAMD in a chosen destination:

| Source             | Converted from                            |
| ------------------ | ----------------------------------------- |
| Obsidian vault     | Markdown with `[[links]]`, callouts, tags |
| Notion export      | Markdown with Notion-style callouts       |
| HTML files         | Headings, paragraphs, lists, code, links  |

CSV files can be turned into `.ydb` databases with the column types inferred from the first ten rows.

---

### 6.12 Reading list

`YAMD: New Reading List` creates a `reading-list.ydb` database with columns for Title, Author, Course, Status (*To read* / *Reading* / *Done*), Pages and Due. It opens in the preview as a kanban board grouped by Status.

---

### 6.13 Math symbols

`YAMD: Insert Math Symbol` opens a searchable picker of common LaTeX symbols (Greek letters, operators, arrows, set notation, logic, calculus) and inserts the selected symbol as inline math.

---

### 6.14 Diagnostics added by student features

| Code  | Severity | Meaning                                         |
| ----- | -------- | ----------------------------------------------- |
| `Y605` | warning | Flashcard has no answer (§6.4)                  |

---

## 7. Review markup (tracked changes)

YAMD has built-in syntax for suggestions and review comments, based on CriticMarkup:

| Syntax                    | Meaning                         |
| ------------------------- | ------------------------------- |
| `{++added++}`             | Insertion                       |
| `{--removed--}`           | Deletion                        |
| `{~~old~>new~~}`          | Substitution                    |
| `{==text==}{>>note<<}`    | Comment attached to text        |
| `{>>note<<}`              | Standalone review comment       |

Renderers offer three modes: **show changes** (the default in editors), **accept all** (the default in published output) and **reject all**. `yamd accept` and `yamd reject` apply the changes to the source.

Use `%% %%` comments for author notes and review markup for reviewer discussion.

---

## 8. Escaping

- A backslash before any ASCII punctuation character makes that character literal: `\*`, `\#`, `\[`, `\|`, `\{`, `\$`, `\:`, `\%`.
- A backslash before anything else is a literal backslash.
- Escape YAMD-only syntax to keep it as text: `\==`, `\++`, `\{{`, `\[[`, `\#tag`, `\^`, `\%%`. "Convert from Markdown" adds these escapes automatically.

---

## 9. Security

- **Raw HTML is sanitized** with GitHub's allow-list (the tags and attributes GitHub keeps when rendering Markdown). `<details>`, `<kbd>`, `<sub>` and `<b>` work; `<script>`, `<style>`, `<iframe>` and their content are removed, as are event handlers, `style` attributes and comments. `id` and `name` values get a `user-content-` prefix so they can't clash with the page. `a < b` is always safe.
- HTML outside the allow-list renders only inside `:::html`, and only when the renderer runs in **trusted mode**, which is off by default. Even then, renderers must remove scripts and event handlers.
- **The allowed URL schemes** are `http`, `https`, `mailto`, `tel` and relative paths. Everything else, including `javascript:` and `data:` (except `data:image/*` in images), is dropped and produces diagnostic `Y901`.
- `::embed` only renders hosts on the renderer's allow-list. Anything else renders as a plain link.

---

## 10. Links, anchors and paths

**Heading IDs** are generated by one fixed algorithm:
1. Take the heading's plain text, without markup.
2. Lowercase it, using Unicode-aware rules.
3. Keep Unicode letters, digits, `-` and `_`. Turn spaces into `-` and drop everything else.
4. Collapse repeated `-` and trim `-` from both ends.
5. If the ID is already used, append `-2`, `-3` and so on.

**Stable links:** an explicit `{#id}` always wins. Running `yamd fmt --pin-ids` writes the generated IDs into the source, so renaming a heading later doesn't break the links to it.

**Paths:** relative paths resolve from the file that contains them. Paths starting with `/` resolve from the project root, which is the nearest folder containing `yamd.yaml`, or the repository root. `yamd check` reports missing files, images and anchors (`Y701`).

**Moving files:** `yamd mv old.yamd new.yamd` moves a file and rewrites every link and include that points to it.

---

## 11. Accessibility rules

These rules are enforced by `yamd check`:

| Code   | Rule                                                              | Severity |
| ------ | ----------------------------------------------------------------- | -------- |
| `Y702` | Images need alt text or `{decorative}`                            | error    |
| `Y703` | Tables need a header row                                          | error    |
| `Y704` | Heading levels must not skip (H2 then H4)                         | warning  |
| `Y705` | Only one H1 per document (or use `title` in the front matter)     | warning  |
| `Y706` | Link text like "click here" or "link" isn't descriptive           | warning  |
| `Y707` | Front matter should set `lang`                                    | info     |

---

## 12. Tooling and conformance

### 12.1 Diagnostics

- A parser must accept **any** input and always produce output.
- Every recovered or suspicious construct also produces a diagnostic with a code, a severity, a line, a column and a suggested fix.
- Editors show diagnostics inline, and `yamd check` exits non-zero on errors so it can run in CI.

| Code   | Severity | Meaning                                                          |
| ------ | -------- | ---------------------------------------------------------------- |
| `Y101` | warning  | Tab in indentation (§2)                                          |
| `Y102` | error    | Front matter isn't valid YAML (§2.1)                             |
| `Y201` | info     | Redundant trailing `\` (§3.1)                                    |
| `Y210` | info     | Paragraph looks hard-wrapped (§3.1)                              |
| `Y212` | info     | Changed bullet marker nests a new list one level deeper (§3.3)   |
| `Y301` | warning  | `##word` without a space (§3.2)                                  |
| `Y401` | warning  | Lazy blockquote continuation (§3.4)                              |
| `Y501` | error    | Unclosed code fence (§3.5)                                       |
| `Y601` | warning  | Unknown directive (§3.10)                                        |
| `Y602` | error    | Circular embed or include (§4.11, §6)                            |
| `Y603` | warning  | Content before the first column of a kanban board (§6.1)         |
| `Y604` | info     | Kanban column over its `limit` (§6.1)                            |
| `Y605` | warning  | Flashcard has no answer (§6.4)                                   |
| `Y701` | warning  | Missing link, image, anchor, reference or footnote target (§10)  |
| `Y702`–`Y707` | see §11 | Accessibility                                              |
| `Y708` | error    | Block ID used twice in one note (§4.11)                          |
| `Y709` | warning  | Link name matches more than one note (§4.3)                      |
| `Y801` | error    | Undefined variable (§4.8)                                        |
| `Y850` | error    | Unknown database or alias (§6.2)                                 |
| `Y851` | error    | SQL error in a view or query (§6.2)                              |
| `Y852` | error    | Invalid `.ydb` structure or property type (§6.2)                 |
| `Y853` | error/warning | Value doesn't match its property (warning for an unknown option) |
| `Y854` | error    | Duplicate row `id` (§6.2)                                        |
| `Y855` | error    | Board grouped by a property that can't be grouped (§6.1)         |
| `Y901` | warning  | URL scheme not allowed (§9)                                      |
| `Y950` | error    | Query refused as unsafe (§6.2)                                   |
| `Y951` | error    | Database outside the note's folder (§6.2)                        |
| `Y952` | warning  | Query stopped at the time limit (§6.2)                           |

### 12.2 Reference tools

| Command        | Purpose                                                       |
| -------------- | ------------------------------------------------------------- |
| `yamd fmt`     | Canonical formatter with no style options                     |
| `yamd check`   | Lint the syntax, links, includes, variables and accessibility |
| `yamd render`  | Output HTML, PDF, DOCX or plain text                          |
| `yamd convert` | Convert Markdown to YAMD (join hard-wrapped lines, escape YAMD-only syntax), or DOCX to YAMD, and YAMD back to Markdown |
| `yamd mv`      | Move a file and update its references                         |
| `yamd accept` / `yamd reject` | Apply or discard review markup                 |

`yamd fmt` guarantees the following:
- ATX headings and fenced code blocks; ordered lists renumbered.
- Nesting indentation that matches the parent's content column.
- Aligned table pipes.
- No trailing whitespace and exactly one final newline.
- **It never reflows paragraphs**, so diffs only show lines that really changed.

### 12.3 Conformance levels

There are only two levels, and both are defined in this one document:

- **Core:** sections 2–5 and 8–10, except for math, diagrams, citations, cross-references and review markup. Directives degrade as described in section 3.10.
- **Full:** everything in this spec.

A Core renderer that meets a Full feature must show its source text as plain text or a code block. It must never drop content silently.

---

## 13. Differences from GFM

YAMD passes the CommonMark 0.31.2 and GFM spec examples except for the cases below. Each is deliberate.

| GFM text                         | GFM renders                  | YAMD renders                   | To get GFM's result in YAMD      |
| -------------------------------- | ---------------------------- | ------------------------------ | -------------------------------- |
| `one`⏎`two`                      | `one two` (one line)         | two lines                      | Join the lines (`Y210` quick fix) |
| `#tag`                           | text                         | a tag                          | `\#tag`                          |
| `a ==b==`, `a ++b++`             | text                         | highlight, underline           | `\==b==`, `\++b++`               |
| `x^2`, `x^{2}`, `H_{2}O`         | text                         | superscript, subscript         | `x\^2`, `H\_{2}O`                |
| `{{ name }}`                     | text                         | a variable                     | `\{{ name }}`                    |
| `[[page]]`, `![[page]]`          | text                         | a wikilink, an embed           | `\[[page]]`                      |
| `[@key]`, `^[note]`              | text                         | a citation, an inline footnote | `\[@key]`, `\^[note]`            |
| `%% note %%`                     | text                         | removed (a comment)            | `\%% note %%`                    |
| `{.class}` after an element or on its own line | text           | attributes                     | `\{.class}`                      |
| `:::name`, `::name`, `:name[x]`  | text                         | a directive                    | `\:::name`                       |
| `text ^id` at the end of a paragraph | text                     | a block ID                     | `text \^id`                      |
| `---` on line 1                  | a thematic break             | front matter                   | Start with a blank line          |
| `$x$`                            | text                         | math                           | `\$x$` (GitHub also renders math) |
| Links with schemes outside `http`, `https`, `mailto`, `tel` | a link | text (`Y901`)            | Use an allowed scheme            |
| `- a`⏎`+ b` (no blank line, different marker)    | two lists                    | `b` nested under `a` (`Y212`)  | Add a blank line before `+ b`    |

"YAMD: Convert from Markdown" and "YAMD: Open Markdown as YAMD" apply every fix in the last column automatically.

---

## 14. How each pain point is addressed

| Pain point                                        | YAMD fix                                                   |
| ------------------------------------------------- | ---------------------------------------------------------- |
| Many incompatible flavors                         | One spec, two conformance levels, `x-` vendor namespace (§0, §12.3) |
| Extensions aren't portable                        | One directive syntax with graceful fallback (§3.10)        |
| Invisible trailing-space line breaks              | A newline is a break, so they're never needed (§3.1)       |
| A single newline is ignored                       | Enter starts a new line (§3.1)                             |
| Nested list indentation (2 vs 4 spaces, tabs)     | GFM's content-column rule, tabs flagged, formatter normalizes (§3.3, §2) |
| Mixed markers split lists unexpectedly            | A marker change nests one level deeper instead of splitting, with info `Y212` (§3.3) |
| `2024. Great year` becomes a list                 | Only lists starting at 1 interrupt paragraphs; escape `\.` (§3.3) |
| A list needs a blank line before it               | Not required (§3.3)                                        |
| Code blocks break list numbering                  | Content indented under the item stays in it (§3.3)         |
| Intraword `_` and `*` surprises                   | GFM's rules: `_` never works inside words (§4.1)           |
| `#Title` behaves inconsistently                   | Always a tag; `##Title` gets a diagnostic (§3.2)           |
| Too much escaping                                 | Fewer special characters; one escape rule (§8)             |
| Literal backticks in code                         | Variable-length delimiters (§4.2)                          |
| Painful tables, no multi-line cells or merges     | Formatter alignment, list tables, `colspan` (§3.7)         |
| Pipes inside code break tables                    | `\|` works inside code too (§3.7)                          |
| No underline, color, alignment or sizing          | `++`, span attributes, image attributes (§4.1, §4.5)       |
| No captions, figures or numbering                 | `caption` attribute and cross-references (§4.4, §4.7)      |
| No collapsible sections, columns or callouts      | Standard directives (§6)                                   |
| No page breaks                                    | `::pagebreak` (§6)                                         |
| No comments that stay out of the output           | `%% %%` removed at parse time (§4.9)                       |
| No variables or templating                        | `{{ vars }}` (§4.8)                                        |
| Inconsistent footnotes, no citations              | Standard footnotes and citations (§4.6, §4.7)              |
| No tracked changes                                | Review markup (§7)                                         |
| No table of contents                              | `::toc` or `toc: true` (§6, §2.1)                          |
| Large docs, no includes                           | `::include` (§6)                                           |
| Front matter isn't standard                       | YAML only, with reserved keys (§2.1)                       |
| Heading anchors differ across renderers           | One defined slug algorithm (§10)                           |
| Renamed headings break links                      | Explicit IDs and `--pin-ids` (§10)                         |
| Moved files break links and images                | `yamd check` and `yamd mv` (§10)                           |
| Silent failures                                   | Diagnostics with codes and fixes (§12.1)                   |
| Inconsistent lint and style rules                 | Formatter with no options (§12.2)                          |
| Reflowed paragraphs create noisy diffs            | No hard wrapping; formatter never reflows (§3.1, §12.2)    |
| Lossy conversion to and from Word, HTML and Markdown | `yamd convert` and `yamd render` (§12.2)                |
| `$` prices are parsed as math                     | Strict `$` delimiter rule (§3.8)                           |
| Diagrams need plugins                             | Standard mermaid block (§3.9)                              |
| Embeds use non-standard syntax                    | `::embed` with an allow-list (§6)                          |
| XSS through raw HTML                              | GitHub's sanitizer allow-list is part of the spec (§9)     |
| Platforms sanitize differently                    | Sanitization and URL allow-list are part of the spec (§9)  |
| Missing alt text, table headers, skipped headings | Accessibility lint rules (§11)                             |
| Plugin syntax causes lock-in (wikilinks, admonitions) | Wikilinks and callouts are standard (§4.3, §6)         |
| No way to reuse a paragraph or section elsewhere  | Embeds and block IDs (§4.11)                               |
| No tags or note aliases                           | `#tags`, front matter `tags` and `aliases` (§4.10, §4.12)  |

### Not solved by the spec alone

These depend on editors and platforms, not on the format:
- **Real-time collaboration** without Git needs an editor built on top of YAMD.
- **Mobile typing:** the core syntax uses the same characters as Markdown, so it is no worse, but a good mobile editor still needs a formatting toolbar.
- **Pasting rich text** cleanly depends on editors implementing HTML-to-YAMD conversion through `yamd convert`.
- **Paragraph-level diffs:** because a newline is now a line break, you can't put one sentence per line. Use word-level diffs (`git diff --word-diff`) for review.
