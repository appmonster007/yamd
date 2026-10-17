# Spec Delta

## MODIFIED Requirements

### Requirement: Line breaks
Each newline inside a paragraph SHALL render as a line break, and a blank line SHALL end the paragraph. A line ending in two or more spaces or a `\` SHALL also render as a line break, as in GFM, with the same result as a plain newline.

#### Scenario: Newline inside a paragraph
- **WHEN** the input is `Roses are red` followed by a newline and `Violets are blue`
- **THEN** one paragraph is rendered with a line break between the two lines

#### Scenario: Markdown hard breaks
- **WHEN** a line ends with two spaces or a `\`
- **THEN** the output is the same as with a plain newline, and no backslash is shown

### Requirement: Headings
`#` to `######` followed by a space or the end of the line SHALL create a heading, with any closing `#` sequence removed. A line of text followed by a line of `=` or `-` SHALL create a level 1 or level 2 heading. Each heading SHALL get an `id` from its explicit `{#id}` attribute or, if absent, from the slug algorithm in the spec, with `-2`, `-3` suffixes for duplicates.

#### Scenario: Hashtag is not a heading
- **WHEN** a line is `#hashtags are text`
- **THEN** it renders as paragraph text

#### Scenario: Setext heading
- **WHEN** the line `Overview` is followed by `--------`
- **THEN** it renders as an `h2` with the id `overview`

#### Scenario: Closing hashes
- **WHEN** a line is `## Install ##`
- **THEN** it renders as an `h2` with the text `Install`

#### Scenario: Generated and explicit IDs
- **WHEN** the input has `## Getting Started`, then `## Getting Started` again, then `## Install {#setup}`
- **THEN** the headings get the ids `getting-started`, `getting-started-2` and `setup`

### Requirement: Lists
Changing the bullet marker (`-`, `*`, `+`) SHALL start a new list, as in GFM, and indentation SHALL only nest. Ordered lists SHALL start at the first item's number, or at `{start=N}` when given. A list that interrupts a paragraph MUST start at 1. Items SHALL be numbered sequentially, and numbering SHALL continue across content indented under an item. Nesting and continuation follow GFM's list item rules.

#### Scenario: Changed bullet marker
- **WHEN** two items use `-` and the next two use `*`
- **THEN** they render as two separate lists

#### Scenario: Nesting by indentation
- **WHEN** an item `- Fruit` is followed by `  - Apples`
- **THEN** `Apples` is in a list nested inside the `Fruit` item

#### Scenario: Start number
- **WHEN** a block starts with `3. Third`
- **THEN** it renders as an ordered list starting at 3

#### Scenario: Number inside a paragraph
- **WHEN** a paragraph line is followed by `2024. Great year`
- **THEN** that line stays part of the paragraph

#### Scenario: Code block inside a numbered item
- **WHEN** item `1.` contains an indented fenced code block and is followed by `2.`
- **THEN** both items are in one ordered list, numbered 1 and 2

#### Scenario: Task items
- **WHEN** an item starts with `[ ]` or `[x]`
- **THEN** it renders with an unchecked or checked, disabled checkbox

### Requirement: Inline formatting
The renderer SHALL support `*` and `_` emphasis and strong emphasis with CommonMark's delimiter rules, `~~` and `~` strikethrough, and YAMD's `++` underline and `==` highlight using the same delimiter rules. Superscript SHALL be `^{...}` and subscript `_{...}`, directly after a non-space character. `^` followed by digits (with an optional leading `-`) SHALL be a superscript without braces.

#### Scenario: Emphasis family
- **WHEN** the input is `*i* _i_ **b** __b__ ++u++ ~~s~~ ~s~ ==h==`
- **THEN** it renders as italic, italic, bold, bold, underline, strikethrough, strikethrough and highlight

#### Scenario: Superscript and subscript
- **WHEN** the input is `x^{2} e^{-i\pi} H_{2}O x_{i+1} 10^6 2^-3`
- **THEN** `2`, `-i\pi`, `6` and `-3` render as superscript, and `2` and `i+1` as subscript

#### Scenario: Subscript needs braces
- **WHEN** the input is `var_1 and file_2024.txt`
- **THEN** no subscript is applied

#### Scenario: Not after a space
- **WHEN** the input is `a _{b}_ and see ^{note}`
- **THEN** `{b}` is emphasized as in GFM and `^{note}` stays literal

#### Scenario: Spaced markers stay literal
- **WHEN** the input is `2 * 3 * 4` or `C++ and C++`
- **THEN** no emphasis is applied

#### Scenario: Underscores inside words stay literal
- **WHEN** the input is `snake_case_name`
- **THEN** the underscores render as text

### Requirement: Safe output
Raw HTML SHALL render after sanitizing with GitHub's allow-list, and HTML comments SHALL be removed. Only `http`, `https`, `mailto`, `tel`, relative and `data:image/*` (images only) URLs SHALL be emitted. Attribute values MUST be escaped.

#### Scenario: Script is removed
- **WHEN** the input is `<script>alert(1)</script>`
- **THEN** the output contains no script element

#### Scenario: Allowed HTML renders
- **WHEN** the input is `<kbd>Ctrl</kbd> and <br>`
- **THEN** the output contains a `kbd` element and a line break

#### Scenario: Unsafe URL scheme
- **WHEN** the input is `[x](javascript:alert(1))`
- **THEN** the link is rendered without a `javascript:` `href`

#### Scenario: Raw HTML directive
- **WHEN** the input contains a `:::html` container
- **THEN** its contents are rendered as escaped text, because the preview is never in trusted mode

### Requirement: Tables
The renderer SHALL render GFM pipe tables, with or without leading and trailing pipes, with a header row, column alignment and `colspan` attributes, plus `:::table` list tables. Pipes inside code spans and escaped pipes MUST NOT split cells.

#### Scenario: Pipe inside code
- **WHEN** a cell contains `` `a|b` ``
- **THEN** the table keeps the same number of columns and the cell shows `a|b` as code

#### Scenario: Without outer pipes
- **WHEN** the rows are `a | b`, `--|--` and `1 | 2`
- **THEN** a two-column table renders

#### Scenario: Table caption
- **WHEN** a pipe table has an attribute line `{caption="Pricing" #tbl:p}` above it
- **THEN** it renders with id `tbl:p` and the caption `Table 1: Pricing`
