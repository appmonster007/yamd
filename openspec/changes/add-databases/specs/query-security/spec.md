# Spec Delta

## Purpose

Makes sure opening or previewing a YAMD document can never change data, read data outside its scope, or hang the editor, even if the document is malicious.

## ADDED Requirements

### Requirement: Workspace trust
Queries, database views and the SQL console SHALL only run in trusted workspaces. In Restricted Mode they SHALL render a placeholder explaining that queries are disabled.

#### Scenario: Restricted Mode
- **WHEN** a document with a `query` block is previewed in an untrusted workspace
- **THEN** the block shows "Queries are disabled in Restricted Mode" and no database file is read

### Requirement: Document queries are read-only
SQL from a document (query blocks, inline queries, view filters) MUST be a single statement that SQLite reports as read-only, and SHALL run against an in-memory copy of the database. Anything else SHALL be refused with error Y950 without running.

#### Scenario: Write in a query block
- **WHEN** a query block contains `DELETE FROM contacts`
- **THEN** it doesn't run, the block shows "Only read-only queries can run in documents", and Y950 is reported

#### Scenario: Multiple statements
- **WHEN** a query is `SELECT 1; DROP TABLE contacts`
- **THEN** it is refused with Y950

#### Scenario: Injection through a filter
- **WHEN** a view has `filter="1=1); DELETE FROM tasks; --"`
- **THEN** the query is refused, and the database is unchanged

### Requirement: Blocked statements
Document queries MUST NOT use `ATTACH`, `DETACH`, `PRAGMA`, `VACUUM`, `load_extension`, or any function that reads or writes files.

#### Scenario: Attach
- **WHEN** a query block contains `ATTACH '/etc/passwd' AS x`
- **THEN** it is refused with Y950

### Requirement: Resource limits
Each query SHALL run off the extension host's main thread and be stopped after `yamd.queries.timeout` (default 2 seconds). At most `yamd.queries.maxRows` (default 500) rows SHALL be rendered. Database files larger than `yamd.databases.maxFileSize` (default 100 MB) SHALL NOT be loaded for previews.

#### Scenario: Runaway query
- **WHEN** a query uses a recursive CTE that never ends
- **THEN** it is stopped after the timeout, the block shows a timeout error, and Y952 is reported

### Requirement: Safe writes
Writes from the preview SHALL be structured operations (set cell, add row, delete row, move card) built by the extension with bound parameters. SQL text from a document MUST NOT be used to build a write.

#### Scenario: Value with quotes
- **WHEN** the user sets a text cell to `x'); DROP TABLE t; --`
- **THEN** that exact text is stored as the value, and nothing else changes

### Requirement: SQLite write confirmation
The first preview write to a SQLite file in each session SHALL ask the user to allow writes to that file. Writes SHALL fail with a reload prompt if the file changed on disk since it was loaded. Every write SHALL be logged in the "YAMD Databases" output channel.

#### Scenario: First write
- **WHEN** the user edits a cell of a SQLite-backed view for the first time in a session
- **THEN** a dialog asks "Allow YAMD to modify crm.sqlite?", and the edit only applies after "Allow"

#### Scenario: Changed on disk
- **WHEN** another program changed `crm.sqlite` after YAMD loaded it and the user then edits a cell
- **THEN** the edit isn't written, and the user is asked to reload
