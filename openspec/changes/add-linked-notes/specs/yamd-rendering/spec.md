# Spec Delta

## ADDED Requirements

### Requirement: Tags
`#` followed by letters, digits, `_`, `-` and `/` SHALL be a tag when it is at the start of a line or follows whitespace or `(`, and contains at least one character that is not a digit. Tags SHALL render as tag chips. `#` followed by a space at the start of a line stays a heading.

#### Scenario: Tags in text
- **WHEN** the text is `Planning #project/web and issue #42`
- **THEN** `#project/web` renders as a tag and `#42` stays plain text

#### Scenario: Tag at the start of a line
- **WHEN** a line is `#urgent fix the build`
- **THEN** it renders as a paragraph starting with the tag `urgent`

#### Scenario: Tags in URLs and code
- **WHEN** the text contains `https://x.dev/#intro` or `` `#notatag` ``
- **THEN** no tag is rendered

### Requirement: Block anchors
A block ID at the end of a paragraph or list item SHALL be removed from the visible text and become the element's `id`.

#### Scenario: Block ID
- **WHEN** a paragraph is `Price is $10. ^pricing`
- **THEN** it renders as `<p id="^pricing">Price is $10.</p>` with the source line attribute

### Requirement: Resolved embeds and includes
When the renderer is given a resolver, `![[...]]` and `::include[...]` SHALL render the target content in place, with variables resolved against the embedded note's front matter, inside an element linking back to the source note. Without a resolver, they SHALL render as links.

#### Scenario: Embedded section
- **WHEN** a note contains `![[guide#Install]]` and the resolver returns that section
- **THEN** the section's HTML is shown inside an embed element whose title links to `guide.yamd#install`

#### Scenario: Missing target
- **WHEN** the embed target does not exist
- **THEN** a placeholder saying the note was not found is shown in its place

### Requirement: Embed limits
Embeds SHALL nest at most 5 levels deep, and an embed that would include a note already being embedded higher up SHALL render as a placeholder instead of recursing.

#### Scenario: Circular embed
- **WHEN** `a.yamd` embeds `![[b]]` and `b.yamd` embeds `![[a]]`
- **THEN** rendering `a.yamd` shows `b.yamd` once, with a "circular embed" placeholder in place of the inner `![[a]]`
