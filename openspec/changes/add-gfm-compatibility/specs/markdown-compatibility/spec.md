# Spec Delta

## Purpose

Makes GitHub Flavored Markdown the base of YAMD, so existing Markdown renders in YAMD as it does on GitHub, apart from a short, documented list of deliberate differences.

## ADDED Requirements

### Requirement: Conformance test suites
The renderer SHALL be tested against every example in the CommonMark 0.31.2 test suite and the GFM extension test suite. An example SHALL pass when YAMD's HTML matches the expected HTML after normalization, which ignores YAMD-only attributes (`data-line`, heading `id`s and YAMD classes), self-closing tag style and whitespace between tags.

#### Scenario: Suite run
- **WHEN** the conformance tests run
- **THEN** each example either passes or is listed in the known-differences file

### Requirement: Conformance rendering mode
The conformance suites SHALL render examples with soft breaks output as newlines and raw HTML unsanitized, so they test parsing. YAMD's line breaks and sanitizing SHALL be covered by their own tests.

#### Scenario: Soft break in an example
- **WHEN** an example contains a paragraph with a soft line break
- **THEN** it is compared with the newline GFM outputs, not YAMD's `<br>`

### Requirement: Known differences are listed and justified
Every failing conformance example SHALL be listed in a checked-in known-differences file with one of these reasons: `newline-is-break`, `yamd-syntax`, `sanitized-html` (including URLs outside YAMD's scheme allow-list) or `gfm-extension` (a CommonMark example that GFM's extensions render differently). The test SHALL fail when an unlisted example fails, and also when a listed example starts passing, so the list stays accurate.

#### Scenario: Regression
- **WHEN** a parser change makes an unlisted CommonMark example fail
- **THEN** the conformance test fails, naming the example number and section

#### Scenario: Fixed difference
- **WHEN** a listed example starts passing
- **THEN** the test fails and asks for it to be removed from the list

### Requirement: Coverage target
At least 90% of CommonMark examples and 90% of GFM extension examples SHALL pass. Outside the `newline-is-break` and `yamd-syntax` reasons, no more than 10 examples in total MAY be listed.

#### Scenario: Pass rate
- **WHEN** the conformance tests run
- **THEN** the test output reports the pass rate per suite, and fails if either is below 90%

### Requirement: GFM block behavior
YAMD SHALL match GFM for setext headings, indented code blocks, HTML blocks, lazy continuation lines, list items starting at any number, tables without outer pipes, closing `#` sequences on headings, tabs in indentation, and link reference definitions.

#### Scenario: Setext heading
- **WHEN** a line `Title` is followed by `=====`
- **THEN** it renders as an `h1`

#### Scenario: Indented code
- **WHEN** a blank line is followed by lines indented 4 spaces, outside a list
- **THEN** they render as a code block

#### Scenario: List starting at 3
- **WHEN** a block starts with `3. Third` followed by `4. Fourth`
- **THEN** it renders as an ordered list with `start="3"`

#### Scenario: Only 1 interrupts a paragraph
- **WHEN** a paragraph line is followed by `2024. Great year`
- **THEN** that line stays part of the paragraph

#### Scenario: Table without outer pipes
- **WHEN** the input is `a | b`, then `--|--`, then `1 | 2`
- **THEN** it renders as a table with header cells a and b

### Requirement: GFM inline behavior
YAMD SHALL match GFM for `*` and `_` emphasis (with CommonMark's delimiter rules), `~~` and `~` strikethrough, code spans, links, images, autolinks (including `www.` and email addresses), entity and numeric character references, backslash escapes, hard line breaks, and footnotes.

#### Scenario: Underscore emphasis
- **WHEN** the input is `_italic_ and __bold__ but snake_case_name`
- **THEN** `italic` is emphasized, `bold` is strong, and `snake_case_name` stays plain text

#### Scenario: Single-tilde strikethrough
- **WHEN** the input is `~old~ and ~~older~~`
- **THEN** both are struck through

#### Scenario: Entities
- **WHEN** the input is `&copy; 2026 &mdash; &#8212;`
- **THEN** it renders as `© 2026 — —`

#### Scenario: Extended autolinks
- **WHEN** the input is `visit www.example.com or mail hi@example.com`
- **THEN** both become links

### Requirement: Sanitized HTML
Raw HTML blocks and inline HTML SHALL render after sanitizing with GitHub's allow-list of tags, attributes and URL schemes. HTML comments SHALL NOT appear in the output.

#### Scenario: Allowed HTML
- **WHEN** the input contains `<details><summary>More</summary>Hidden</details>` and `<img src="a.png" width="100">`
- **THEN** both render as HTML elements

#### Scenario: Disallowed HTML
- **WHEN** the input contains `<script>alert(1)</script>`, `<img src=x onerror="alert(1)">` and `<a href="javascript:alert(1)">x</a>`
- **THEN** no script element, event handler attribute or `javascript:` URL appears in the output

#### Scenario: HTML comment
- **WHEN** the input contains `<!-- hidden -->`
- **THEN** the output doesn't contain `hidden`

### Requirement: Documented differences
`yamd-spec.md` SHALL have a "Differences from GFM" section listing each intentional difference, with a before-and-after example and its migration fix.

#### Scenario: Reading the differences
- **WHEN** a user reads the "Differences from GFM" section
- **THEN** it lists newline handling and YAMD-only syntax, each with how to keep the GFM result
