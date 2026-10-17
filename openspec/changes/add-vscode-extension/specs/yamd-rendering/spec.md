# Spec Delta

## Purpose

Converts YAMD source into safe HTML that follows `yamd-spec.md`, so every tool that displays a YAMD document shows the same result.

## ADDED Requirements

### Requirement: Total rendering
The renderer SHALL produce HTML for any input text, including malformed input, without throwing.

#### Scenario: Unclosed constructs
- **WHEN** the input contains an unclosed code fence, an unclosed `:::` container and an unclosed `**`
- **THEN** HTML is produced, the fence and container end at the end of their enclosing block, and the `**` is shown as literal text

### Requirement: Line breaks
Each newline inside a paragraph SHALL render as a line break, and a blank line SHALL end the paragraph. Trailing whitespace SHALL have no effect.

#### Scenario: Newline inside a paragraph
- **WHEN** the input is `Roses are red` followed by a newline and `Violets are blue`
- **THEN** one paragraph is rendered with a line break between the two lines

#### Scenario: Trailing spaces are ignored
- **WHEN** a line ends with two spaces
- **THEN** the output is the same as without the spaces

### Requirement: Headings
Only `#` to `######` followed by a space SHALL create a heading. Each heading SHALL get an `id` from its explicit `{#id}` attribute or, if absent, from the slug algorithm in the spec, with `-2`, `-3` suffixes for duplicates.

#### Scenario: Hashtag is not a heading
- **WHEN** a line is `#hashtags are text`
- **THEN** it renders as paragraph text

#### Scenario: Generated and explicit IDs
- **WHEN** the input has `## Getting Started`, then `## Getting Started` again, then `## Install {#setup}`
- **THEN** the headings get the ids `getting-started`, `getting-started-2` and `setup`

### Requirement: Lists
Bullet markers `-`, `*` and `+` SHALL be equivalent and never split a list. Ordered lists SHALL start only at `1` unless `{start=N}` is given, SHALL number items sequentially, and SHALL continue numbering across content indented under an item.

#### Scenario: Mixed bullet markers
- **WHEN** consecutive items use `-`, `*` and `+`
- **THEN** they render as one list

#### Scenario: Number at the start of a line
- **WHEN** a line is `2024. Great year` with no `{start}` attribute
- **THEN** it renders as paragraph text

#### Scenario: Code block inside a numbered item
- **WHEN** item `1.` contains an indented fenced code block and is followed by `2.`
- **THEN** both items are in one ordered list, numbered 1 and 2

#### Scenario: Relative nesting
- **WHEN** a child item is indented by 2 spaces and its own child by 6 spaces
- **THEN** they render as three nesting levels

#### Scenario: Task items
- **WHEN** an item starts with `[ ]` or `[x]`
- **THEN** it renders with an unchecked or checked, disabled checkbox

### Requirement: Inline formatting
The renderer SHALL support the emphasis family in the spec (`*`, `**`, `***`, `++`, `~~`, `==`, `~`, `^`). An opening marker MUST be followed by a non-space and a closing marker MUST be preceded by a non-space. `_` SHALL have no meaning.

#### Scenario: Emphasis family
- **WHEN** the input is `*i* **b** ++u++ ~~s~~ ==h== H~2~O x^2^`
- **THEN** it renders as italic, bold, underline, strikethrough, highlight, subscript and superscript

#### Scenario: Spaced markers stay literal
- **WHEN** the input is `2 * 3 * 4` or `C++ and C++`
- **THEN** no emphasis is applied

#### Scenario: Underscores stay literal
- **WHEN** the input is `snake_case and __init__`
- **THEN** the underscores render as text

### Requirement: Links and images
The renderer SHALL support inline links, reference links, angle-bracket autolinks, bare `http`, `https` and `mailto` URLs, wikilinks and images with attributes. Images with a `caption` attribute SHALL render as numbered figures.

#### Scenario: Bare URL
- **WHEN** the text contains `https://example.com`
- **THEN** it renders as a link

#### Scenario: Wikilink
- **WHEN** the text contains `[[guide#Install|setup]]`
- **THEN** it renders as a link with the text `setup` pointing to `guide.yamd#install`

#### Scenario: Image with attributes
- **WHEN** the input is `![Diagram](a.png){width=300 align=center caption="Overview" #fig:a}`
- **THEN** it renders as a figure with id `fig:a`, an image 300 pixels wide, centered, and the caption `Figure 1: Overview`

### Requirement: Safe output
Raw HTML in the source SHALL render as escaped text, and only `http`, `https`, `mailto`, `tel`, relative and `data:image/*` (images only) URLs SHALL be emitted. Attribute values MUST be escaped.

#### Scenario: HTML is literal
- **WHEN** the input is `<script>alert(1)</script>`
- **THEN** the output contains the escaped text and no script element

#### Scenario: Unsafe URL scheme
- **WHEN** the input is `[x](javascript:alert(1))`
- **THEN** the link is rendered as plain text `x` without an `href`

#### Scenario: Raw HTML directive
- **WHEN** the input contains a `:::html` container
- **THEN** its contents are rendered as escaped text, because the preview is never in trusted mode

### Requirement: Tables
The renderer SHALL render pipe tables with a header row, column alignment and `colspan` attributes, and `:::table` list tables. Pipes inside code spans and escaped pipes MUST NOT split cells.

#### Scenario: Pipe inside code
- **WHEN** a cell contains `` `a|b` ``
- **THEN** the table keeps the same number of columns and the cell shows `a|b` as code

#### Scenario: Table caption
- **WHEN** a pipe table has an attribute line `{caption="Pricing" #tbl:p}` above it
- **THEN** it renders with id `tbl:p` and the caption `Table 1: Pricing`

### Requirement: Directives
The renderer SHALL render the standard directives listed in the spec. Unknown container directives SHALL render their contents as normal blocks, and unknown leaf and inline directives SHALL render their label as text.

#### Scenario: Callout
- **WHEN** the input contains `:::warning {title="Careful"}` with a body
- **THEN** it renders as a warning callout with the title `Careful`

#### Scenario: Unknown directive
- **WHEN** the input contains `:::x-acme-chart` with a paragraph inside
- **THEN** the paragraph is rendered

#### Scenario: Table of contents
- **WHEN** the input contains `::toc{depth=2}`
- **THEN** a nested list of links to all level 1 and 2 headings is rendered at that point

### Requirement: Front matter and variables
YAML front matter SHALL be parsed and not rendered. `{{ name }}` SHALL be replaced with the matching `vars` value or built-in (`title`, `author`, `date`), supporting dotted paths. Undefined variables SHALL render literally.

#### Scenario: Variable substitution
- **WHEN** the front matter has `vars: {support: {email: a@b.c}}` and the text has `{{ support.email }}`
- **THEN** the output shows `a@b.c`

#### Scenario: Undefined variable
- **WHEN** the text has `{{ missing }}`
- **THEN** the output shows `{{ missing }}`

### Requirement: Comments and review markup
`%% %%` comments SHALL be removed from the output entirely. Review markup SHALL render in show-changes mode, with insertions, deletions, substitutions, highlights and review comments visually distinct.

#### Scenario: Comment removed
- **WHEN** the input contains `%% secret note %%`
- **THEN** the output HTML does not contain `secret note`

#### Scenario: Substitution
- **WHEN** the input contains `{~~old~>new~~}`
- **THEN** `old` is shown as deleted and `new` as inserted

### Requirement: Footnotes and cross-references
Footnotes SHALL be numbered by order of first reference and listed at the end. `[@fig:…]`, `[@tbl:…]`, `[@eq:…]` and `[@sec:…]` SHALL render as links labeled with the target's type and number.

#### Scenario: Footnote numbering
- **WHEN** `[^b]` is referenced before `[^a]`
- **THEN** `[^b]` is numbered 1 and `[^a]` is numbered 2

#### Scenario: Cross-reference
- **WHEN** the second captioned figure has id `fig:arch` and the text has `[@fig:arch]`
- **THEN** it renders as a link to `#fig:arch` with the text `Figure 2`

### Requirement: Fallbacks for unsupported Full-level features
Math, Mermaid blocks, citations, `::embed` and `::include` SHALL render as readable fallbacks and never be dropped.

#### Scenario: Math fallback
- **WHEN** the input contains `$E = mc^2$` or a `$$` block
- **THEN** the source is shown in a math-styled monospace element

#### Scenario: Citation fallback
- **WHEN** the input contains `[@lamport1978]`
- **THEN** it renders as the text `[lamport1978]` styled as a citation

#### Scenario: Include fallback
- **WHEN** the input contains `::include[changelog.yamd]`
- **THEN** a placeholder naming `changelog.yamd` is rendered
