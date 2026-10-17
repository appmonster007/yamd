# Proposal

## Why

People will bring existing Markdown into YAMD by renaming `.md` files or pasting content. Today that breaks a lot: `_italic_`, HTML (`<details>`, `<br>`, `<img width>`), indented code, `===` headings, tables without outer pipes, `&copy;` entities and lists starting at 3 all render differently. YAMD should treat GitHub Flavored Markdown (GFM) as its base, so almost every Markdown file renders as it does on GitHub. YAMD should only differ in a short, documented list of deliberate changes, and each one should come with a one-click fix.

## What Changes

- **GFM becomes the baseline.** YAMD = GFM + YAMD extensions, apart from the intentional differences below. Conformance is measured against the official CommonMark 0.31.2 and GFM test suites. Every failing example must be on a checked-in list of known differences, each with its reason.
- **GFM behaviors adopted** (each **BREAKING** relative to the current YAMD spec):
  - `_italic_` and `__bold__`, with CommonMark's emphasis rules. Underscores inside words, as in `snake_case`, stay literal.
  - Setext headings (`===` and `---` under a line of text).
  - Indented code blocks (4 spaces after a blank line, outside lists).
  - Ordered lists can start at any number. Only a list starting at `1` can interrupt a paragraph.
  - Lazy continuation lines in quotes and list items.
  - Tables without leading or trailing pipes.
  - Trailing two spaces and trailing `\` make a hard line break.
  - `~text~` is strikethrough, like `~~text~~`.
  - Changing the bullet marker (`-`, `*`, `+`) starts a new list. This is the way to write two lists back to back, since indentation always nests. Information diagnostic Y212 points out marker changes in case they are accidental.
  - HTML entities such as `&copy;` and `&#8212;`.
  - Closing `#` sequences on headings.
  - Tabs as indentation.
  - Extended autolinks (`www.example.com` and bare email addresses).
  - Raw HTML renders, sanitized with GitHub's allow-list. `<!-- comments -->` are hidden. Scripts, event handlers and unsafe URLs are still removed.
- **Differences YAMD keeps on purpose:**
  - A single newline inside a paragraph is a line break, not a soft wrap.
  - YAMD-only syntax: `==mark==`, `++ins++`, `x^{sup}` and `H_{sub}O` (with the shortcut `x^2` for digits), `{attributes}`, `{{variables}}`, `%% comments %%`, `$math$`, `:::directives`, `[[wikilinks]]`, `[@citations]`, review markup, `#tags` and `^block-ids`. Text that happens to look like these renders differently from GFM, and a backslash escapes it.
- **Migration help:**
  - Diagnostic Y210 (a paragraph looks hard-wrapped) with a quick fix.
  - The command "YAMD: Convert from Markdown" applies every fix and escapes accidental YAMD syntax, so a converted file renders as it did on GitHub.
  - "YAMD: Open Markdown as YAMD" does the same for a `.md` file, into a new `.yamd` file.
- **BREAKING** for existing YAMD files: subscript and superscript change from `H~2~O` and `x^2^` to LaTeX-style `H_{2}O` and `x^{2}`. Braces show exactly what is raised or lowered, match the notation used in math, and don't collide with GFM.
- **Diagnostic changes:** Y212 (a changed bullet marker starts a new list) is added. Y101 (tabs) becomes a warning. Y201 (trailing backslash) becomes information, because it's now a valid but redundant hard break.

## Capabilities

### New Capabilities
- `markdown-compatibility`: the GFM baseline, the conformance test suites, the list of known differences, and GFM behaviors YAMD must match.
- `markdown-migration`: the migration diagnostics, quick fixes and conversion commands.

### Modified Capabilities
- `yamd-rendering`: line breaks, headings, lists, inline formatting, safe output and tables change to match GFM.
- `document-diagnostics`: severities of Y101 and Y201 change, and Y210 and Y212 are added.

## Impact

- `yamd-spec.md`:
  - Rewrite §0 (principle 1 becomes "GFM plus extensions").
  - Revise §3 and §4 for the adopted behaviors.
  - Change §9 (HTML is sanitized rather than shown as text).
  - Replace §13 with "Differences from GFM".
  - Update §14 (several pain points are now addressed by warnings instead of syntax changes).
- `vscode-yamd/src/core`: the parser is rebuilt on `micromark` and `mdast` (see design.md), with YAMD extensions written as micromark extensions. The renderer and linter move to the `mdast` tree. Existing tests are updated where GFM behavior was adopted.
- New dependencies (bundled, no network): `micromark`, `mdast-util-from-markdown`, the GFM, directive, math and frontmatter extensions, `mdast-util-to-hast`, `hast-util-raw`, `hast-util-sanitize` and `hast-util-to-html`. New dev dependency `commonmark-spec`.
- `examples/`: `01-basics` and `02-documents/security.yamd` are updated, and a new `06-markdown/` folder shows Markdown that works unchanged, plus the known differences.
- **Ordering**: this lands before `add-linked-notes`, `add-databases` and `add-kanban-boards`. Their parsing work is then built as micromark extensions on the new core. Their task lists don't change shape, but their parsing tasks will target the new extension API.
