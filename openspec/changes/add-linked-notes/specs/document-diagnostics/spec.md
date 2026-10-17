# Spec Delta

## MODIFIED Requirements

### Requirement: Syntax diagnostics
The extension SHALL report tabs in indentation (Y101), a trailing backslash (Y201), two to six `#` followed directly by a word at the start of a line (Y301), a non-blank line without `>` directly after a quote line (Y401), an unclosed code fence (Y501) and an unknown directive name (Y601). A single `#` followed by a word is a tag and MUST NOT produce Y301.

#### Scenario: Missing space after multiple hashes
- **WHEN** a line starts with `##Title`
- **THEN** warning Y301 asks whether a heading was intended

#### Scenario: Tag at line start
- **WHEN** a line starts with `#Title`
- **THEN** no Y301 is reported, because `#Title` is a tag

#### Scenario: Unclosed fence
- **WHEN** a code fence has no closing fence
- **THEN** error Y501 is reported on the opening fence

#### Scenario: Vendor directive
- **WHEN** a document uses `:::x-acme-chart`
- **THEN** warning Y601 is reported, naming the directive

## ADDED Requirements

### Requirement: Embed and block reference diagnostics
The extension SHALL report Y701 for embeds and block references whose note, heading or block ID does not exist, Y602 for embeds or includes that form a cycle, Y708 for a block ID used twice in one note, and Y709 for a link name that matches more than one note.

#### Scenario: Missing block
- **WHEN** a note links `[[ideas#^pricing]]` and `ideas.yamd` has no block `^pricing`
- **THEN** warning Y701 is reported on the link

#### Scenario: Circular embed
- **WHEN** `a.yamd` embeds `![[b]]` and `b.yamd` embeds `![[a]]`
- **THEN** error Y602 is reported on the embed in each note

#### Scenario: Duplicate block ID
- **WHEN** two paragraphs in one note end with ` ^intro`
- **THEN** error Y708 is reported on the second one

#### Scenario: Ambiguous link
- **WHEN** `[[notes]]` matches `a/notes.yamd` and `b/notes.yamd`
- **THEN** warning Y709 lists both paths
