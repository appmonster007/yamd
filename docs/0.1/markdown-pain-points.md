# Markdown: Rules and Pain Points

## Part 1: Syntax Rules

### Headings
- `# H1` through `###### H6`; a space after `#` is required
- Setext: `===` under text for H1, `---` for H2

### Emphasis
- `*italic*` or `_italic_`
- `**bold**` or `__bold__`
- `***bold italic***`
- `~~strikethrough~~` (GFM)

### Paragraphs and line breaks
- A blank line separates paragraphs.
- A line break is two trailing spaces or a `\` at the end of the line.

### Lists
- Unordered: `-`, `*` or `+`
- Ordered: `1.` (the actual numbers don't matter)
- Indent 2-4 spaces to nest.
- Task list (GFM): `- [ ]` or `- [x]`

### Links and images
- Link: `[text](url "title")`
- Reference link: `[text][id]`, with `[id]: url` defined elsewhere
- Autolink: `<https://example.com>`
- Image: `![alt](url "title")`

### Blockquotes
- `> quote`; nest with `>>`.

### Code
- Inline: `` `code` ``
- Fenced block: ```` ```lang ```` ... ```` ``` ````
- Indented block: 4 spaces or 1 tab

### Horizontal rule
- `---`, `***` or `___` on their own line

### Tables (GFM)

```
| A | B |
|---|:-:|
| 1 | 2 |
```

- `:--` left-aligns, `:-:` centers and `--:` right-aligns.

### Escaping
- Use a backslash before special characters: `\* \_ \# \` \[ \]`.

### Other extensions (flavor-dependent)
- Footnotes: `[^1]` with `[^1]: note`
- Definition lists
- Heading IDs: `{#id}`
- Highlight: `==text==`
- Sub/superscript: `H~2~O`, `X^2^`
- Emoji: `:smile:`
- Raw HTML is allowed inline.
- Math: `$...$` and `$$...$$`
- Mermaid diagrams in a fenced block

### Best practices
- Leave a blank line around headings, lists, code blocks and tables.
- Use one H1 per document.
- Don't skip heading levels.
- Use consistent list markers and indentation.
- Put no trailing spaces except for deliberate line breaks.
- End the file with a newline.

---

## Part 2: Pain Points

### Fragmentation
- There is no single spec. CommonMark, GFM, MultiMarkdown, Pandoc and others differ, so the same file renders differently across tools.
- Extensions such as tables, footnotes, math and task lists aren't portable.

### Ambiguous or fragile syntax
- Nested lists and mixed indentation (2 vs 4 spaces, tabs) break unpredictably.
- Special characters (`*`, `_`, `#`, `|`) need escaping.
- Underscores inside words and `*` in text trigger accidental formatting.
- Code fences inside lists or blockquotes are finicky.
- Showing a literal backtick in a code span needs extra backticks.
- Lists interrupted by code blocks or paragraphs restart numbering or break the list.
- A list needs a blank line before it in some renderers, but not in others.
- Headings without a space (`#Title`) fail in CommonMark but work elsewhere.
- Two adjacent lists with different markers merge or split unpredictably.
- Emphasis rules are complex (`**bold**text`, intraword `_`), so results surprise people.
- Line-start numbers like `2024. Great year` accidentally become lists.
- Autolinking varies: some renderers link bare URLs and others don't.
- Hard-wrapped text renders fine, but editing it later reflows poorly.

### Trailing-space line breaks
- **Invisible.** You can't see the trailing spaces in most editors.
- **Stripped automatically.** Editors, formatters, linters and git hooks remove them, and the line break disappears.
- **Easy to get wrong.** One space does nothing, and three or more is inconsistent.
- **Copy and paste loses it.** Chat apps, emails and web forms often trim whitespace.
- **Noisy diffs.** Whitespace-only changes are hard to review.
- **Counterintuitive.** Users expect Enter to make a new line, but a single newline is treated as a space.
- **Inconsistent across renderers.** GitHub comments and some chat tools treat a single newline as a break, while CommonMark does not.
- Workarounds: a trailing `\` (not supported everywhere), `<br>` (HTML clutter), or a blank line (extra spacing).

### Tables
- They are painful to write and edit by hand.
- Wide tables become unreadable in source form.
- Cells can't hold multi-line content, merged cells or lists.
- Alignment of the pipes is hard to maintain.
- Merge conflicts in tables are painful.

### Limited expressiveness
- There is no native support for colors, fonts, page layout, columns, captions, cross-references, a table of contents, or citations.
- Image sizing and alignment need HTML.
- Underline, highlight, centering and collapsible sections (`<details>` is HTML) are missing from most flavors.
- No page breaks or print control.
- There is no standard way to add comments that don't render. `<!-- -->` is HTML, and `[//]: #` is a hack.
- No variables, reuse or templating.
- Images have no captions, no sizing and no figure numbering.
- Footnotes and citations aren't standardized.
- No comments or tracked changes, so collaboration and review are weak.

### Editing and tooling
- Raw syntax is hard for non-technical users, and WYSIWYG editors often reformat the source.
- Round-tripping to and from Word, Google Docs or HTML is lossy.
- Linting and formatting rules are inconsistent between teams.
- Live preview differs from the final render (GitHub, VS Code, Obsidian, docs sites).
- Spell-check and grammar tools often choke on syntax characters.
- Searching or replacing across files can corrupt formatting.
- Pasting rich text (from the web or Word) gives messy or unpredictable Markdown.
- Large files are slow to render and hard to navigate.

### Structure and metadata
- There is no standard for metadata. YAML front matter is a convention, not part of the spec, and TOML or JSON variants exist.
- Heading IDs and anchor links vary by renderer.
- Heading anchors are auto-generated, so editing a heading breaks every link to it.
- Renaming files silently breaks internal links.
- Large documents have no includes or transclusion.
- There is no built-in diagram or chart support (Mermaid is an add-on).

### Version control and collaboration
- Reflowed paragraphs create noisy diffs, so teams argue about one sentence per line.
- Images and attachments live outside the file and break links when moved.
- Collaboration needs Git skills, and there is no real-time editing without a layer on top.

### Ecosystem
- Too many choices of parser, editor and flavor.
- Plugins and extensions add non-standard syntax, which creates lock-in (Obsidian wikilinks, MDX, Docusaurus admonitions).
- Docs-as-code needs extra tooling for search, navigation and versioning.
- Embedded content (video, iframes, social posts) relies on non-standard syntax.

### User experience
- A learning curve for non-developers, who can't tell what's broken when formatting fails.
- Silent failures: invalid syntax just renders as plain text, with no error.
- Mobile editing is awkward because many symbols are hard to type.

### Security and portability
- Raw HTML allows XSS if the output isn't sanitized.
- Sanitization differs across platforms: some strip HTML, some allow it.
- Relative links and image paths break when files move.

### Accessibility
- Alt text is often forgotten.
- Tables lack semantic headers in some renderers.
- Heading levels are often misused for styling.
