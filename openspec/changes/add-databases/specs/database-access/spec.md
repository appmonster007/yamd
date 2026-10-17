# Spec Delta

## Purpose

Controls which databases a document can reach and how a document names them, so a note can only see data in its own folder tree.

## ADDED Requirements

### Requirement: Folder scope
A document SHALL only use databases in its own folder or a subfolder of it. References that point to a parent folder, an absolute path, another workspace folder, or a file whose real path (after following symlinks) is outside the document's folder MUST be refused with error Y951.

#### Scenario: Subfolder database
- **WHEN** `README.yamd` at the root uses `projects/tasks.ydb`
- **THEN** the database is available

#### Scenario: Parent folder database
- **WHEN** `projects/web/notes.yamd` uses `../tasks.ydb`
- **THEN** error Y951 is reported and nothing is read from the file

#### Scenario: Symlink escape
- **WHEN** `data/link.ydb` is a symlink to a file outside the document's folder
- **THEN** error Y951 is reported

### Requirement: Aliases in front matter
The `databases:` front matter key SHALL map aliases to database paths (with `#table` for SQLite). Views and queries SHALL accept either an alias or a path. An alias or path that doesn't resolve to an existing database SHALL produce error Y850.

#### Scenario: Using an alias
- **WHEN** the front matter has `databases: {crm: data/crm.sqlite#contacts}` and the text has `::db[crm]`
- **THEN** the `contacts` table is shown

#### Scenario: Unknown alias
- **WHEN** the text has `::db[sales]` and there is no alias or file named `sales`
- **THEN** error Y850 is reported

### Requirement: Adding a database to a note
The command "YAMD: Add Database to Note" SHALL list the databases in the active note's scope (`.ydb` files, and the tables of SQLite files), ask for an alias, and add it to the note's `databases:` front matter as an undoable edit.

#### Scenario: Picking a database
- **WHEN** the user runs the command in `README.yamd`, picks `data/crm.sqlite#contacts` and enters the alias `crm`
- **THEN** the front matter gains `databases: {crm: data/crm.sqlite#contacts}`, merged with any existing aliases

#### Scenario: Only databases in scope
- **WHEN** the command runs in `projects/web/notes.yamd`
- **THEN** databases outside `projects/web/` are not listed
