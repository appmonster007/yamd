# Markdown Rules

## Headings
- `# H1` through `###### H6`; a space after `#` is required
- Setext: `===` under text for H1, `---` for H2

## Emphasis
- `*italic*` or `_italic_`
- `**bold**` or `__bold__`
- `***bold italic***`
- `~~strikethrough~~` (GFM)

## Paragraphs and line breaks
- A blank line separates paragraphs.
- A line break is two trailing spaces or a `\` at the end of the line.

## Lists
- Unordered: `-`, `*` or `+`
- Ordered: `1.` (the actual numbers don't matter)
- Indent 2-4 spaces to nest.
- Task list (GFM): `- [ ]` or `- [x]`

## Links and images
- Link: `[text](url "title")`
- Reference link: `[text][id]`, with `[id]: url` defined elsewhere
- Autolink: `<https://example.com>`
- Image: `![alt](url "title")`

## Blockquotes
- `> quote`; nest with `>>`.

## Code
- Inline: `` `code` ``
- Fenced block: ```` ```lang ```` ... ```` ``` ````
- Indented block: 4 spaces or 1 tab

## Horizontal rule
- `---`, `***` or `___` on their own line

## Tables (GFM)

```
| A | B |
|---|:-:|
| 1 | 2 |
```

- `:--` left-aligns, `:-:` centers and `--:` right-aligns.

## Escaping
- Use a backslash before special characters: `\* \_ \# \` \[ \]`.

## Other extensions (flavor-dependent)
- Footnotes: `[^1]` with `[^1]: note`
- Definition lists
- Heading IDs: `{#id}`
- Highlight: `==text==`
- Sub/superscript: `H~2~O`, `X^2^`
- Emoji: `:smile:`
- Raw HTML is allowed inline.
- Math: `$...$` and `$$...$$`
- Mermaid diagrams in a fenced block

## Best practices
- Leave a blank line around headings, lists, code blocks and tables.
- Use one H1 per document.
- Don't skip heading levels.
- Use consistent list markers and indentation.
- Put no trailing spaces except for deliberate line breaks.
- End the file with a newline.
