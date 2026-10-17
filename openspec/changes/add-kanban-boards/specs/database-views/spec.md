# Spec Delta

## ADDED Requirements

### Requirement: Board view
`::db[ref]{type=board group=Prop}` SHALL show rows as cards in columns, one per option of `Prop` in option order, followed by "No value". `Prop` MUST be a `select`, `status`, `person` or `checkbox` property. Cards SHALL show the title and the properties listed in `columns`.

#### Scenario: Board by status
- **WHEN** `Status` has the options `Todo`, `Doing` and `Done`, and a note has `::db[tasks]{type=board group=Status columns="Due,Owner"}`
- **THEN** the board has the columns Todo, Doing, Done and No value, and each card shows its title, due date and owner

#### Scenario: Ungroupable property
- **WHEN** a board is grouped by a `multi_select` property
- **THEN** an error box is shown, and error Y855 is reported on the directive

### Requirement: Moving database cards
Dragging a card to another column SHALL set the row's group property to that column's value, with "No value" clearing it. When the view has no `sort`, dropping a card at a position SHALL also move the row to that position in the database's row order. Writes use the safe write path.

#### Scenario: Move to another status
- **WHEN** the user drags a card from Todo to Done
- **THEN** that row's `Status` becomes `Done` in the database

#### Scenario: Reorder without sort
- **WHEN** a board has no `sort` and the user drags a card above another in the same column
- **THEN** the row is moved before that row in the `.ydb` `rows` list, or in the `_yamd_meta` order for SQLite

#### Scenario: Reorder with sort
- **WHEN** a board has `sort=Due`
- **THEN** cards can only be moved between columns, not reordered within one

### Requirement: Adding database cards
Each board column SHALL have an "Add card" control that creates a row with the column's group value and the entered title.

#### Scenario: Add to a column
- **WHEN** the user adds `Ship v2` in the Doing column
- **THEN** a row with `Title: Ship v2` and `Status: Doing` is added
