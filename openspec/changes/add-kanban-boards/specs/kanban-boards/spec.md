# Spec Delta

## Purpose

Lets authors plan work on a kanban board that is written as plain YAMD text and can be edited by dragging cards in the preview.

## ADDED Requirements

### Requirement: Board syntax
Inside a `:::kanban` container, each heading SHALL start a column titled by the heading text, and each top-level list item under it SHALL be a card. A card's first line is its title, and its indented lines are its body. The container's `title` attribute names the board.

#### Scenario: Columns and cards
- **WHEN** a `:::kanban` contains `## Todo` with items `- [ ] A` and `- [ ] B`, then `## Done` with `- [x] C`
- **THEN** the board has a `Todo` column with cards A and B, and a `Done` column with card C

#### Scenario: Card body
- **WHEN** a card `- [ ] Write tests` has an indented line `Cover the parser.` under it
- **THEN** the card shows `Cover the parser.` as its body

### Requirement: Column attributes
`{limit=N}` on a column heading SHALL set a work-in-progress limit, shown as `count/N`, with the column highlighted when the count is over N. `{complete}` SHALL mark a column whose cards are done.

#### Scenario: Over the limit
- **WHEN** `## Doing {limit=2}` has three cards
- **THEN** the column header shows `3/2` with a warning style

### Requirement: Card metadata
Cards SHALL show their tags as chips and the attributes `due` (a date badge, red when overdue and not done) and `owner`. A card is done when its checkbox is ticked.

#### Scenario: Overdue card
- **WHEN** today is 2026-10-16 and an unticked card has `{due=2026-10-10}`
- **THEN** its due badge is shown in the overdue style

### Requirement: Moving cards
In trusted workspaces, dragging a card to another position or column SHALL move the card's lines (title and body) to that place in the source as one undoable edit. Moving a card into a `{complete}` column SHALL tick it, and moving it out SHALL untick it.

#### Scenario: Move between columns
- **WHEN** the user drags card B from `Todo` to the top of `Doing`
- **THEN** B's lines are removed from under `## Todo` and inserted first under `## Doing`, and one Undo restores the original text

#### Scenario: Move into a complete column
- **WHEN** the user drags `- [ ] A` into `## Done {complete}`
- **THEN** the card's line becomes `- [x] A` under `## Done`

### Requirement: Keyboard moves
A focused card SHALL move with Alt+Up and Alt+Down within its column, and with Alt+Left and Alt+Right to the neighboring column.

#### Scenario: Keyboard move
- **WHEN** card A is focused in `Todo` and the user presses Alt+Right
- **THEN** A moves to the end of the next column, and focus stays on it

### Requirement: Adding and editing cards
Each column SHALL have an "Add card" control that appends `- [ ] <text>` to that column. Double-clicking a card title SHALL let the user edit it in place, changing only the title text in the source.

#### Scenario: Add a card
- **WHEN** the user types `Fix login` into the add control of `Todo` and presses Enter
- **THEN** `- [ ] Fix login` is added as the last card under `## Todo`

### Requirement: Collapsing columns
Clicking a column's collapse control SHALL collapse it to a narrow strip showing its title and count, in the preview only.

#### Scenario: Collapse
- **WHEN** the user collapses `Done`
- **THEN** the column narrows and the source document doesn't change

### Requirement: Boards outside the preview
Headings inside a `:::kanban` container MUST NOT appear in the table of contents or the Outline view.

#### Scenario: Table of contents
- **WHEN** a note has `::toc` and a board with `## Todo` and `## Done` columns
- **THEN** the table of contents doesn't list `Todo` or `Done`
