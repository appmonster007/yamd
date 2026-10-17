# Spec Delta

## Purpose

Lets documents run SQL over their databases and over the notes around them, and show the results inline as live content.

## ADDED Requirements

### Requirement: Query blocks
A fenced block with the language `query` SHALL run its SQL when the document is previewed and render the result in its place. The `db` attribute names the database (alias or path). The `view` attribute SHALL be `table` (default), `list` (the first column as items), or `value` (the first cell only). A fenced block with the language `sql` MUST NOT run.

#### Scenario: Query over a database
- **WHEN** a note contains a `query {db=crm}` block with `SELECT name, email FROM contacts WHERE stage = 'lead'`
- **THEN** the preview shows a table of matching contacts

#### Scenario: SQL documentation is not run
- **WHEN** a note contains a `sql` fenced block
- **THEN** it renders as a code block and is never executed

### Requirement: Inline queries
`:query[SQL]{db=...}` SHALL render the first cell of the result inline.

#### Scenario: Inline count
- **WHEN** a note has `Done: :query[SELECT count(*) FROM tasks WHERE Status = 'Done']{db=tasks}` and 7 tasks are done
- **THEN** the preview shows `Done: 7`

### Requirement: Table names
A `.ydb` database SHALL be queryable as a table named after its file (`tasks.ydb` as `tasks`). SQLite databases SHALL expose their own tables. `multi_select` and `relation` values SHALL be JSON arrays, `checkbox` values 0 or 1, and dates ISO 8601 text.

#### Scenario: Multi-select filter
- **WHEN** a query runs `SELECT Title FROM tasks, json_each(tasks.Tags) WHERE json_each.value = 'urgent'`
- **THEN** it returns tasks tagged `urgent`

### Requirement: Notes tables
A query without `db` SHALL run over the notes in the document's scope (its folder and subfolders) using the tables `notes` (path, title, folder, created, modified, one column per front matter key, and `properties` as JSON), `tags` (path, tag), `links` (source, target) and `tasks` (path, line, text, done).

#### Scenario: Dataview-style list
- **WHEN** a note in `projects/` has a `query {view=list}` block with `SELECT title FROM notes JOIN tags USING (path) WHERE tag = 'project' AND status = 'active'`
- **THEN** the preview lists the active project notes under `projects/`

#### Scenario: Open tasks across notes
- **WHEN** a query is `SELECT path, text FROM tasks WHERE done = 0`
- **THEN** it lists unfinished tasks from notes in scope only

### Requirement: Live results
Query results SHALL update when the document, a database it uses, or a note in its scope changes.

#### Scenario: Database changed
- **WHEN** a row is edited in `tasks.ydb` while a note showing a query over it is previewed
- **THEN** the query result updates within 1 second

### Requirement: Result rendering
Results SHALL be rendered as escaped text, with URL values passed through the URL allow-list and dates formatted. Results longer than the row limit SHALL show the first rows and a note giving the total count.

#### Scenario: HTML in data
- **WHEN** a cell contains `<img src=x onerror=alert(1)>`
- **THEN** it is shown as text and no element is created
