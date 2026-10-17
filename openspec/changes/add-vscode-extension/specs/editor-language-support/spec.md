# Spec Delta

## Purpose

Makes VS Code recognize YAMD documents and gives authors highlighting, editing conveniences and shortcuts while writing them.

## ADDED Requirements

### Requirement: Language registration
The extension SHALL register a language with id `yamd` and alias `YAMD`, associated with the `.yamd` file extension.

#### Scenario: Opening a YAMD file
- **WHEN** the user opens a file named `notes.yamd`
- **THEN** VS Code shows the language mode as `YAMD` and activates the extension

### Requirement: Syntax highlighting
The extension SHALL highlight every construct defined in `yamd-spec.md` with a distinct scope, so that themes color them consistently with similar Markdown constructs.

#### Scenario: Block constructs are highlighted
- **WHEN** a document contains front matter, headings, list markers, task boxes, quotes, fenced code, tables, thematic breaks, math blocks and directive fences
- **THEN** each one is given its own scope and its markers are distinguishable from its content

#### Scenario: Inline constructs are highlighted
- **WHEN** a line contains emphasis markers, code spans, links, wikilinks, images, attributes, variables, footnotes, citations, cross-references, comments and review markup
- **THEN** each one is given its own scope

#### Scenario: Code inside fences uses the language's grammar
- **WHEN** a fenced block's info string names a language VS Code knows, such as `python`
- **THEN** the block's contents are highlighted with that language's grammar

#### Scenario: Underscores are not emphasis
- **WHEN** a line contains `snake_case_name` or `__init__`
- **THEN** no emphasis scope is applied to it

### Requirement: Comment toggling
The extension SHALL use `%% %%` as the block comment for the toggle-comment commands.

#### Scenario: Toggle comment on a selection
- **WHEN** the user selects text and runs Toggle Block Comment
- **THEN** the selection is wrapped in `%% ` and ` %%`, and running it again removes them

### Requirement: Auto-closing pairs
The extension SHALL auto-close brackets, braces, parentheses and backticks while typing.

#### Scenario: Typing an opening brace
- **WHEN** the user types `{`
- **THEN** a closing `}` is inserted after the cursor

### Requirement: List continuation
Pressing Enter at the end of a non-empty list item SHALL start a new item with the same marker and indentation, numbered one higher for ordered lists and with an unchecked box for task items.

#### Scenario: Continuing a bullet list
- **WHEN** the cursor is at the end of `  - Item` and the user presses Enter
- **THEN** a new line `  - ` is inserted

#### Scenario: Continuing an ordered list
- **WHEN** the cursor is at the end of `3. Third` and the user presses Enter
- **THEN** a new line `4. ` is inserted

#### Scenario: Continuing a task list
- **WHEN** the cursor is at the end of `- [x] Done` and the user presses Enter
- **THEN** a new line `- [ ] ` is inserted

#### Scenario: Ending a list
- **WHEN** the cursor is on an item that contains only its marker and the user presses Enter
- **THEN** the marker is removed and the list ends

### Requirement: Snippets
The extension SHALL provide snippets for front matter, callouts, collapsible sections, columns, list tables, pipe tables, fenced code, math blocks, figures and review markup.

#### Scenario: Inserting a callout
- **WHEN** the user types the `note` snippet prefix and accepts the suggestion
- **THEN** a `:::note` container with a placeholder body and closing `:::` is inserted

### Requirement: Formatting shortcuts
The extension SHALL provide commands, bound to keyboard shortcuts in YAMD files, that toggle bold, italic, underline, strikethrough, highlight and inline code around the selection.

#### Scenario: Making a selection bold
- **WHEN** the user selects `word` and presses Cmd+B (Ctrl+B on Windows and Linux)
- **THEN** the text becomes `**word**`

#### Scenario: Removing bold
- **WHEN** the user selects `**word**`, or `word` inside it, and presses Cmd+B
- **THEN** the markers are removed and the text becomes `word`

#### Scenario: No selection
- **WHEN** nothing is selected and the user runs a formatting command
- **THEN** the markers are inserted with the cursor placed between them
