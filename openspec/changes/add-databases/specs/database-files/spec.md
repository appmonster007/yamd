# Spec Delta

## Purpose

Defines how YAMD databases are stored, as readable `.ydb` text files or SQLite files, and the typed properties they share.

## ADDED Requirements

### Requirement: Text database files
A `.ydb` file SHALL be a YAML document with a `yamdb` version key, an optional `name`, a `properties` map from property name to type, an optional `views` map, and a `rows` list. Each row MUST have a unique `id` and holds values keyed by property name.

#### Scenario: Minimal database
- **WHEN** `tasks.ydb` contains `yamdb: 0.1`, `properties: {Title: title, Done: checkbox}` and `rows: [{id: t1, Title: Write spec, Done: true}]`
- **THEN** it loads as a database with one row whose `Title` is `Write spec` and `Done` is true

#### Scenario: Git-friendly writes
- **WHEN** one cell of one row is changed through YAMD
- **THEN** only that row's lines change in the file, and comments and the order of keys are kept

### Requirement: SQLite database files
Files ending in `.sqlite`, `.sqlite3` or `.db` SHALL be opened as SQLite databases where each table is a YAMD database, referenced as `file#table`. Property types SHALL come from a `_yamd_meta` table when present, and otherwise be inferred from column types.

#### Scenario: Table reference
- **WHEN** a note uses `::db[data/crm.sqlite#contacts]`
- **THEN** the `contacts` table of `data/crm.sqlite` is shown

#### Scenario: Inferred types
- **WHEN** a table without `_yamd_meta` has an `INTEGER` column `age` and a `TEXT` column `name`
- **THEN** `age` is treated as a number and `name` as text

### Requirement: Property types
Databases SHALL support these property types: `title`, `text`, `number`, `select`, `multi_select`, `status`, `date`, `checkbox`, `url`, `email`, `person`, `relation`, `formula`, `created_time` and `updated_time`. A `select`, `multi_select` or `status` property MAY list its `options`. A `relation` names another database in scope. A `formula` holds an SQL expression over the row's other properties.

#### Scenario: Formula
- **WHEN** a property `Overdue` is `{type: formula, expression: "Due < date('now') AND Status != 'Done'"}`
- **THEN** each row's `Overdue` is computed from its `Due` and `Status`, and it can't be edited

#### Scenario: Relation
- **WHEN** a property `Project` is `{type: relation, database: projects.ydb}` and a row has `Project: [p1]`
- **THEN** the view shows the title of row `p1` in `projects.ydb` as a link

#### Scenario: Automatic times
- **WHEN** a row is added or edited through YAMD in a database with `created_time` and `updated_time` properties
- **THEN** those properties are set to the current time

### Requirement: Database files are validated
Opening or editing a `.ydb` file SHALL report Y852 for an invalid structure or unknown property type, Y853 for a value that doesn't match its property's type or options, and Y854 for a duplicate row `id`.

#### Scenario: Wrong value type
- **WHEN** a `number` property `Points` has the value `"three"` in a row
- **THEN** error Y853 is reported on that value

#### Scenario: Unknown option
- **WHEN** a `select` property lists `options: [Todo, Done]` and a row has `Doing`
- **THEN** warning Y853 is reported on that value

### Requirement: Creating a database
The command "YAMD: New Database" SHALL create a `.ydb` file in a chosen folder, with a title property, a status property and a default table view.

#### Scenario: New database
- **WHEN** the user runs the command, picks `projects/` and names it `tasks`
- **THEN** `projects/tasks.ydb` is created and opened
