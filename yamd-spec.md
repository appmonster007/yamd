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
| `vars`         | Map of variables, see [Variables](#48-variables)          |
| `bibliography` | Path to a BibTeX or CSL-JSON file for citations           |
| `citation-style` | Citation output style: `apa` (default), `mla`, `chicago`, `ieee` or `vancouver` (§4.7) |
| `toc`          | `true` to insert a table of contents after the title      |
| `tags`         | List of tags, e.g. `[planning, project/web]` (§4.10)      |
| `aliases`      | List of alternate names a wikilink can match (§4.12)      |
| `databases`    | Map of alias → `.ydb`/SQLite path (§6.2)                  |

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
- `-`, `*` and `+` all work, as in GFM: changing the marker always starts a new list at the same level, blank line or not. `yamd fmt` keeps each list's marker.

**Ordered**
- Use `1.` or `1)`. The list starts at the first item's number, and the following items are numbered in order whatever is written. `yamd fmt` rewrites the numbers to match.
- Only a list that starts at `1` can interrupt a paragraph, so `2024. Great year` on a line inside a paragraph stays text. Escape the period (`2024\. Great year`) to keep it as text anywhere.
- `{start=5}` on the line above a list also sets the start number.

**Nesting**
- An item's content (including nested lists) must be indented to at least the column where the item's text starts: 2 spaces after `- `, 3 after `1. `. This is GFM's rule; `yamd fmt` normalizes nesting to that column. Indentation is the only way to nest a list — there's no second, marker-based way, so a nesting level is always visible in the source.

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
- **A container's name is optional.** `::: {attrs} ... :::` groups several blocks under one set of attributes with no semantic meaning of its own — the generic way to apply, say, `.warning` to more than one paragraph at once (§5). It's the same container form as `:::note`, just nameless.
- **A leaf directive's `[label]` is optional**, the same way: it's left out when the directive has no content of its own to take, as in `::toc{depth=3}`, `::pagebreak` and `::bibliography`.

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
  - `[[guide]]`, `[[guide#Install]]`, `[[guide#^block]]` and `[[guide|label]]` are wiki-style links. **Core** resolution is two steps: a path relative to the current note, then a path from the project root — matched as a path *suffix*, so `[[advanced/guide]]` matches `docs/advanced/guide.yamd`. A target that doesn't resolve this way is unresolved (`Y701`). A match against more than one note is **not** auto-resolved — it's reported as error `Y709`, with a suggested fix of adding enough trailing path segments to be unique. Resolution never silently guesses, so adding an unrelated note elsewhere in the project can never silently repoint an existing link.
  - Project-wide resolution by bare **file name** or by a note's `aliases` front matter (ignoring case) is a YAMD Studio capability, built on top of the two steps above when neither matches — see [yamd-studio-spec.md](yamd-studio-spec.md). It requires an index of the whole project, which a renderer handling one file in isolation doesn't have.
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

A span's `ref=target-id` attribute marks it as a reference to another labeled element in the document — a word pointing at its definition, a correction pointing at the phrase it fixes — anywhere a plain link isn't the right fit (the target is mid-paragraph or in another document section, not something you'd normally link to by title). Mark the target the same explicit way the source is marked: with `{#id}` (§5) — a labeled span, a block's own `{#id}` (directly above it or starting its first line), a heading's trailing `{#id}`, or a cross-reference label (`{#fig:…}`, §4.7) — so both ends of the reference use the same bracketed-attribute syntax, the way `[text]{ref=id}` marks the source. A block's `^id` (§4.11) also resolves as a target, kept with its `^`, since it's already a valid anchor everywhere else — but prefer `{#id}` for anything you're labeling specifically to be a `ref=` target: it keeps both ends marked the same way, instead of a bracket on one end and a bare caret on the other:

```yamd
[mitosis]{ref=def-mitosis} is how a cell divides. Mix that with other
processes and [mitosis is the process of nuclear
division]{#def-mitosis}, one step in a longer paragraph.
```

A span with `ref=` renders as a real link to `#target-id` (`<a href="#target-id">`, the same as a cross-reference), so it's clickable and jumps to its target in any renderer. A `target-id` that doesn't resolve to any element in the document produces `Y701` (§12.1), same as any other missing anchor.

YAMD Studio adds editor-only affordances on top of `ref=` — color-coding each target and showing its line/column on hover — described in [yamd-studio-spec.md](yamd-studio-spec.md); none of that changes what gets rendered.

### 4.6 Footnotes

- Reference: `[^id]`. Definition: `[^id]: text`. Indent the lines that follow a definition to give it more paragraphs.
- Inline footnote: `^[text of the note]`.
- Footnotes are numbered in order of first reference, whatever their IDs.

### 4.7 Cross-references and citations

- Give any element a label: `{#fig:…}`, `{#tbl:…}`, `{#eq:…}`, `{#sec:…}`.
- Reference it with `[@fig:arch]`, which renders as "Figure 2" with a link. Recognised prefixes are `fig`, `tbl`, `eq`, `sec`, plus `def`, `thm`, `lem`, `ex`, `q`, `rem` for the study-aid blocks in [yamd-studio-spec.md](yamd-studio-spec.md).
- Any other `[@key]` is a **citation** looked up in the file named by the `bibliography` front matter key (§2.1), in BibTeX or CSL-JSON. Several citations go in one bracket: `[@smith2020; @lee2021, p. 4]`.
- A `citation-style` front matter key picks the output style: `apa` (default), `mla`, `chicago`, `ieee` or `vancouver`.
- Supported locators, added before the comma after the key: `p.`, `pp.`, `ch.`, `sec.`, `fig.`, `eq.`, `no.`, `vol.`, `ed.`, `trans.` — e.g. `[@dijkstra1968, p. 12]`.
- `::bibliography` (or a bare `::bibliography` leaf) places the reference list; otherwise it appears at the end of the document.

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

- `![[note]]` shows another note in place, `![[note#Heading]]` the section under that heading (up to the next heading of the same or higher level), and `![[note#^id]]` one block. `![[image.png]]{width=300}` embeds an image. An embed's note target resolves exactly the same way a wikilink does — Core by relative/root path only, Studio adding project-wide filename/alias search on top (§4.3) — since an embed is a wikilink that renders its target in place rather than linking to it.
- Embedded content renders with the embedded note's own front matter (so its variables resolve) and links back to it. Embeds nest at most 5 levels; an embed that would include a note already being embedded shows a placeholder instead, and the linter reports `Y602`.
- A paragraph or list item whose last line ends with a space and `^id` (letters, digits, `-`) gets that **block ID**. The `^id` isn't shown; it becomes the element's `id`. A block ID must be unique in its note (`Y708`).
- Missing notes, headings and blocks in links and embeds produce `Y701`.

### 4.12 Aliases and template placeholders

- `aliases: [Q3 Plan, Roadmap 2026]` in the front matter lets `[[Q3 Plan]]` link to the note.
- In templates, `{{@date}}`, `{{@date:DD/MM/YYYY}}`, `{{@time}}` and `{{@title}}` are replaced when the template is inserted, and `{{@cursor}}` marks where the cursor goes. Formats use the tokens `YYYY`, `MM`, `DD`, `HH` and `mm`.
- Placeholders aren't variables — they're a one-time substitution done by the template-insertion action, not a value resolved every time the document renders. A `{{@...}}` placeholder found anywhere outside that action (typed directly, or left over in a note opened without going through template insertion) stays as written and produces information `Y802`, with a quick fix to run template insertion or remove it. This is why it gets a diagnostic where an undefined variable gets `Y801`: both report when `{{...}}` text didn't resolve the way it looked like it should.

---

## 5. Attributes

Attributes give any element an ID, classes and key/value settings using one syntax:

```text
{#id .class1 .class2 key=value key2="value with spaces" flag}
```

**Placement — one default, one exception.** Attach attributes right after the
element's own opening token, on the same line: a heading's text, an inline
span's closing `]`/`)`, a code fence's language tag, a directive's name, or a
table cell's content:

````yamd
## Title {#id}
![a](b){width=50}
```python {title="x.js"}
:::note {title="Heads up"}
Total {colspan=2}
````

The one exception is a plain block (paragraph, list) with no opening token to
attach after — it gets a line of its own instead: directly above it, or at the
very start of its own first line:

```yamd
{.warning}
This paragraph is flagged.

{.warning} Or inline, right at the start of the same line.
```

**Choosing scope.** Attributes apply to exactly what you select:

| Scope           | Syntax                               | Example                                |
| --------------- | ------------------------------------- | --------------------------------------- |
| A few words      | `[text]{attrs}` (or `==text==` for highlighting) | `[save your work]{.warning}` |
| One block        | attrs on the line above, or starting its first line | `{.warning}`⏎`This paragraph is flagged.` |
| Several blocks   | anonymous container, `::: {attrs} ... :::` (§3.10) | `::: {.warning}`⏎`Para one.`⏎⏎`Para two.`⏎`:::` |

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
| `:::kanban {title="…"}`              | Kanban board, see [Visual shorthands](#61-visual-shorthands)  |
| `:::calendar {title="…"}`            | Calendar, see [Visual shorthands](#61-visual-shorthands)      |
| `:::timeline {title="…"}`            | Timeline, see [Visual shorthands](#61-visual-shorthands)      |
| `:::gallery {title="…"}`             | Gallery, see [Visual shorthands](#61-visual-shorthands)       |
| `::db[ref]{…}`                       | Database view, see [Databases and queries](#62-databases-and-queries) |
| `:query[SQL]{db=…}`                  | Inline query result                                           |
| `::toc{depth=3}`                     | Table of contents                                             |
| `::pagebreak`                        | Page break in print or PDF output                             |
| `::embed[https://…]{width=640}`      | Video or social embed from the renderer's allow-list          |
| `::bibliography`                     | Where the reference list renders (it goes at the end by default) |
| `:kbd[Ctrl+S]`                       | Keyboard key                                                  |
| `:abbr[HTML]{title="HyperText Markup Language"}` | Abbreviation                                     |

To transclude another file or one of its sections, use an embed (`![[note]]`, `![[note#Heading]]`, `![[note#^id]]`, §4.11) — there is no separate include directive.

### 6.1 Visual shorthands

Four directives — `:::kanban`, `:::calendar`, `:::timeline` and `:::gallery` — are each **sugar for an implicit, single-use database rendered as a view** (§6.2.1): they exist only so their view can be written and read as plain prose, degrading to headings, lists and images, not as separate features with their own rules. Each one's rows and view-level rules (`Y855`, `Y856`) are exactly the ones its view has in general; only the markup-specific parse issues (a card with nowhere to go) are particular to the shorthand.

Two views deliberately have **no** shorthand: a **chart** aggregates existing rows rather than holding content of its own — there's no "plain prose" a chart could degrade to, since nobody writes a chart out row-by-row — and **table**/**list** already have a native plain-prose form, pipe tables and list tables (§3.7), so a third one would be redundant rather than a convenience.

#### 6.1.1 Kanban boards

```yamd
:::kanban {title="Sprint 12"}
## Todo {limit=3}

- [ ] Fix login on Safari #bug {due=2026-10-10 owner=ada}
  Users get logged out after the redirect.

## Done {complete}

- [x] Set up CI
:::
```

means: each heading starts a **column**, and is a value of an implicit `Status` property (a `status`); each top-level list item under it is a **card**, one row of the implicit database, with the card's first line as its `title` and its indented lines as a `text` body property. `#tags` becomes a `multi_select` property, `{due=YYYY-MM-DD}` a `date` property, `{owner=name}` a `person` property, and the checkbox a `checkbox` property — then the whole thing is grouped by `Status` and shown as a board, exactly as `::db[tasks]{type=board group=Status}` already does for a real `.ydb` file (§6.2.1). This implicit database has no backing `.ydb` file and no alias: it can't be referenced by another `::db[...]` or by a query (§6.2) — it exists only to render the one `:::kanban` block it's written in. The same is true of `:::calendar`, `:::timeline` and `:::gallery` below.

- `{limit=N}` / `count/N`, and `{complete}` marking a column done, are the board view's per-column display settings — the same ones `::db[...]{type=board}` honors for any database.
- A column over its `{limit=N}` produces information `Y604`, and the board's grouping rules (and `Y855`) are exactly the ones a board view has in general (§6.2.1) — both apply uniformly, whether the board came from `:::kanban` markup or a `::db[...]{type=board}` view of a `.ydb` file.
- Content before the first column heading isn't shown on the board (warning `Y603`) — this one stays markup-specific, since it's a parse-time issue only the prose form can have.
- Board headings are columns, not document sections: they are left out of the table of contents and the outline, and aren't checked by `Y704` and `Y705`.
- Editors may let users drag cards. A move rewrites the card's lines (title and body) at the new place, ticking the card when it enters a `{complete}` column and unticking it when it leaves one.

#### 6.1.2 Calendar

```yamd
:::calendar {title="October"}
- [ ] Submit grant report {due=2026-10-10}
- [ ] Team sync {due=2026-10-14 owner=ada}
:::
```

Each top-level list item is a card, exactly as in a kanban board — first line as `title`, indented lines as `text`, `#tags` as `multi_select`, `{owner=name}` as `person`, checkbox as `checkbox` — but there are no column headings, because a calendar groups by date rather than by a named column. `{due=YYYY-MM-DD}` is required and becomes the `date` property the card is placed on; a card with no `{due=…}` isn't shown and produces warning `Y606`. This desugars to `::db[...]{type=calendar date=Due}`.

#### 6.1.3 Timeline

```yamd
:::timeline {title="Q4 Roadmap"}
## Ada
- [ ] Ship billing API {start=2026-10-01 due=2026-10-15}

## Bob
- [ ] Migrate auth {start=2026-10-05 due=2026-11-01}
:::
```

A calendar stretched into a bar, the same way the `timeline` view is a stretched `calendar` view (§6.2.1): cards work as in `:::calendar`, but `{start=YYYY-MM-DD}` becomes the `date` property and `{due=YYYY-MM-DD}` the `date-end` property — a card with no `{start=…}` isn't shown and produces warning `Y606`; a card with no `{due=…}` renders as a single point, same as the view's own rule for an omitted `date-end`. Headings are optional here: when present, each is a value of an implicit `Owner` property and lays out one row per heading, the same role `group` plays for a `.ydb` file; with no headings, every card shares one track. This desugars to `::db[...]{type=timeline date=Start date-end=Due group=Owner}`.

#### 6.1.4 Gallery

```yamd
:::gallery {title="Trip photos"}
![Golden Gate Bridge](ggb.jpg)
Shot at sunset from Battery Spencer. #landscape

![Yosemite Falls](yosemite.jpg)
Peak flow in spring. #landscape
:::
```

Each image starts a card; the image is the `cover` property (§6.2.1), and the paragraph(s) following it, up to the next image or the end of the container, are its `text` body. `#tags` becomes `multi_select`, same as the other shorthands. This desugars to `::db[...]{type=gallery cover=Cover}`. A renderer that doesn't know `gallery` still shows the images and their captions in order, which already reads as a gallery even without the directive.

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

#### 6.2.1 Views

`::db[ref]{view type filter sort group columns limit date date-end cover shape x y aggregate}` shows a database as a `table` (a plain grid), `list`, `gallery`, `calendar`, `board`, `timeline` or `chart`. `view` names a saved view; the other attributes override it. `sort` lists properties, with `-` for descending; selects sort in option order. An attribute that isn't meaningful for the chosen `type` (e.g. `shape` on a `table` view) is ignored and produces information `Y856`.

- **Board** groups rows by `group` (must be `select`, `status`, `person` or `checkbox`, `Y855` otherwise) — see [Visual shorthands](#61-visual-shorthands) for the markup shorthand.
- **Gallery** shows each row as a card image named by `cover` (must be a `url` property or an embedded image reference, `Y855` otherwise).
- **Calendar** places each row on the date named by `date` (must be a `date` property, `Y855` otherwise).
- **Timeline** is a calendar stretched into a bar: `date` and `date-end` name the start and end `date` properties (`Y855` if either isn't one); a row with no `date-end` renders as a single point. `group` (same as board) lays out one row per group instead of one shared track.
- **Chart** aggregates rows instead of listing them: `x` names the category property rows are bucketed by, `aggregate` is `count` (default), `sum`, `avg`, `min` or `max` applied to the property named by `y` (required unless `aggregate=count`; wrong property type for the chosen aggregate is `Y855`), and `shape` picks how it's drawn — `bar` (default), `line` or `pie`.

```yamd
::db[tasks]{type=timeline date=start date-end=due group=owner}

::db[tasks]{type=chart x=Status aggregate=count shape=pie}
```

**Queries.** A ` ```query {db=ref view=table|list|value} ` block runs read-only SQL and shows the result; `:query[SQL]{db=ref}` shows the first cell inline. A `.ydb` database is a table named after its file; `multi_select` and `relation` values are JSON arrays, checkboxes 0 or 1, dates ISO text. Without `db`, a query runs over the notes in the note's folder and below: `notes` (path, title, folder, created, modified, `properties` JSON and one column per front matter key), `tags` (path, tag), `links` (source, target) and `tasks` (path, line, text, done). ` ```sql ` blocks are only code and never run.

**Security.** Queries run only in trusted workspaces. Document SQL must be one read-only statement (`Y950`); `ATTACH`, `DETACH`, `PRAGMA`, `VACUUM` and file functions are refused, and queries run on an in-memory copy. Queries stop after a time limit (`Y952`) and show at most a row limit. Results are always escaped text. Edits from a preview are structured operations with bound parameters, never SQL from the document.

---

### 6.3 Study-aid blocks and flashcards

Container directives for academic writing (`:::definition`, `:::theorem`, `:::lemma`, `:::proof`, `:::example`, `:::question`, `:::remark`, `:::summary`, `:::derivation`), flashcard markup (`:::card`, `:cloze[...]`), and the scheduling, dashboards and commands built on top of them are specific to the YAMD Studio extension, not the format. See [yamd-studio-spec.md](yamd-studio-spec.md).

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

**Moving files:** `yamd mv old.yamd new.yamd` moves a file and rewrites every link and embed that points to it.

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
| `Y301` | warning  | `##word` without a space (§3.2)                                  |
| `Y401` | warning  | Lazy blockquote continuation (§3.4)                              |
| `Y501` | error    | Unclosed code fence (§3.5)                                       |
| `Y601` | warning  | Unknown directive (§3.10)                                        |
| `Y602` | error    | Circular embed (§4.11)                                           |
| `Y603` | warning  | Content before the first column of a kanban board (§6.1.1)       |
| `Y604` | info     | A board column over its `limit`, from `:::kanban` or `::db` (§6.1.1, §6.2.1) |
| `Y606` | warning  | Calendar/timeline card has no date and isn't shown (§6.1.2, §6.1.3) |
| `Y701` | warning  | Missing link, image, anchor, reference, footnote or `ref=` target (§10, §4.5)  |
| `Y702`–`Y707` | see §11 | Accessibility                                              |
| `Y708` | error    | Block ID used twice in one note (§4.11)                          |
| `Y709` | error    | Link name matches more than one note; not auto-resolved (§4.3)  |
| `Y801` | error    | Undefined variable (§4.8)                                        |
| `Y802` | info     | Template placeholder used outside a template insertion (§4.12)  |
| `Y850` | error    | Unknown database or alias (§6.2)                                 |
| `Y851` | error    | SQL error in a view or query (§6.2)                              |
| `Y852` | error    | Invalid `.ydb` structure or property type (§6.2)                 |
| `Y853` | error/warning | Value doesn't match its property (warning for an unknown option) |
| `Y854` | error    | Duplicate row `id` (§6.2)                                        |
| `Y855` | error    | A view attribute (`group`, `date`, `date-end`, `cover`, `x`, `y`) names a property of the wrong type for that view, in any database view (§6.1.1 board, §6.2.1) |
| `Y856` | info     | View attribute not meaningful for the view's `type`, ignored (§6.2.1)            |
| `Y901` | warning  | URL scheme not allowed (§9)                                      |
| `Y950` | error    | Query refused as unsafe (§6.2)                                   |
| `Y951` | error    | Database outside the note's folder (§6.2)                        |
| `Y952` | warning  | Query stopped at the time limit (§6.2)                           |

### 12.2 Reference tools

| Command        | Purpose                                                       |
| -------------- | ------------------------------------------------------------- |
| `yamd fmt`     | Canonical formatter with no style options                     |
| `yamd check`   | Lint the syntax, links, embeds, variables and accessibility   |
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

- **Core:** sections 2–5 and 8–10, except for math, diagrams, citations and cross-references. Directives degrade as described in section 3.10.
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
| Large docs, no includes                           | Embeds transclude a whole note or one section (§4.11)      |
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
