# Spec Delta

## Purpose

Shows databases inside documents as Notion-style views that readers can sort, filter and edit in place.

## ADDED Requirements

### Requirement: View directive
`::db[ref]{...}` SHALL render the database as a view. The attributes SHALL be `view` (the name of a saved view), `type` (`table`, `list`, `gallery` or `calendar`; default `table`), `filter` (an SQL condition), `sort` (property names, with a `-` prefix for descending), `group` (a property), `columns` (property names), `limit`, and `date` and `cover` for calendar and gallery. Attributes override the saved view.

#### Scenario: Table view
- **WHEN** a note has `::db[tasks]{columns="Title,Status,Due" sort="-Due" filter="Status != 'Done'"}`
- **THEN** a table shows the three columns for rows that aren't done, newest due date first

#### Scenario: Saved view
- **WHEN** `tasks.ydb` defines a view `Open` and the note has `::db[tasks]{view=Open}`
- **THEN** the view uses the saved type, filter, sort and columns

### Requirement: View types
A table view SHALL show rows and columns. A list view SHALL show one line per row with its title and chosen properties. A gallery view SHALL show cards with an optional `cover` image property. A calendar view SHALL place rows on a month grid by the `date` property. Values SHALL be displayed by property type: checkboxes, select and multi-select as colored chips, dates formatted, URLs as links, and relations as links to the related row.

#### Scenario: Calendar
- **WHEN** a note has `::db[tasks]{type=calendar date=Due}` and a row is due 2026-10-20
- **THEN** that row appears on October 20 in the month grid, and arrows move between months

#### Scenario: Grouping
- **WHEN** a table view has `group=Status`
- **THEN** rows are shown in one section per status value, in option order, with a count on each

### Requirement: Interactive editing
In trusted workspaces, the user SHALL be able to edit a cell with a control that matches its type, add a row, and delete a row after confirming. Formula, created-time and updated-time cells MUST be read-only.

#### Scenario: Editing a select
- **WHEN** the user clicks a `Status` cell and picks `Done`
- **THEN** that row's `Status` becomes `Done` in the database, and every view of it updates

#### Scenario: Adding a row
- **WHEN** the user clicks "New" in a view
- **THEN** a row with a new unique `id` is added, with values that match the view's filter where possible, and its title cell is focused

#### Scenario: Read-only formula
- **WHEN** the user clicks a formula cell
- **THEN** no editor opens

### Requirement: Temporary sort and filter
The view header SHALL let the reader change the sort, filter by property values, and search rows, without changing the document. "Save view" SHALL write the current settings as a named view into the database.

#### Scenario: Temporary sort
- **WHEN** the user clicks the `Due` column header
- **THEN** the rows sort by `Due` in the preview only, and the source document doesn't change

### Requirement: Writes to text databases
Edits to a `.ydb` database SHALL be applied as an undoable workspace edit that changes only the affected row's lines.

#### Scenario: Undo a cell edit
- **WHEN** the user changes a cell in the preview and then runs Undo in the `.ydb` file
- **THEN** the old value is restored

### Requirement: View errors
A view whose database can't be loaded, or whose filter is invalid SQL, SHALL render an error box in its place with the reason, and report Y851 in the document.

#### Scenario: Invalid filter
- **WHEN** a view has `filter="Status ="`
- **THEN** an error box shows the SQL error, and Y851 is reported on the directive
