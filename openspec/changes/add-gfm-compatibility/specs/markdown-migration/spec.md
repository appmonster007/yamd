# Spec Delta

## Purpose

Makes moving Markdown into YAMD safe, by pointing out every place where YAMD would render it differently and fixing it in one click.

## ADDED Requirements

### Requirement: Hard-wrapped paragraph diagnostic
The extension SHALL report Y210 (information) on paragraphs that look hard-wrapped: at least 3 lines, where every line but the last is at least 60 characters long and ends without sentence-ending punctuation. A quick fix SHALL join the lines with spaces.

#### Scenario: Wrapped paragraph
- **WHEN** a paragraph has four lines of about 72 characters, each ending mid-sentence
- **THEN** Y210 is reported, saying each line will render on its own line, and "Join wrapped lines" makes the paragraph one line

#### Scenario: Intentional lines
- **WHEN** a paragraph is a short poem with lines under 40 characters
- **THEN** Y210 is not reported

### Requirement: Convert from Markdown
The command "YAMD: Convert from Markdown" SHALL rewrite the active document so it renders as GFM did. It SHALL join hard-wrapped paragraphs and backslash-escape text that YAMD would read as its own syntax. The whole rewrite SHALL be one undoable edit.

#### Scenario: Escaping accidental syntax
- **WHEN** a converted document contains `a == b`, `{{ not a var }}`, `100%% sure`, `x^2` and `[[not a link]]`
- **THEN** each one is escaped where needed, so it renders as the same text it showed on GitHub

#### Scenario: Round trip
- **WHEN** a GFM file is converted and both versions are rendered
- **THEN** the YAMD rendering of the converted file matches the GFM rendering of the original, apart from YAMD's own attributes

### Requirement: Open Markdown as YAMD
The command "YAMD: Open Markdown as YAMD", available from the Explorer context menu for `.md` files, SHALL create a `.yamd` file next to the original with the converted content and open it. It SHALL NOT change or delete the `.md` file.

#### Scenario: Converting a README
- **WHEN** the user runs the command on `README.md`
- **THEN** `README.yamd` is created with the converted content and opened, and `README.md` is unchanged

#### Scenario: Existing target
- **WHEN** `README.yamd` already exists
- **THEN** the user is asked whether to overwrite it or pick another name
