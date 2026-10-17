# Spec Delta

## Purpose

Gives authors a place to explore and change their databases with SQL inside VS Code, and hands detailed table browsing to an installed SQLite extension.

## ADDED Requirements

### Requirement: Console view
The YAMD sidebar SHALL contain an "SQL Console" view with a database picker, a query editor, a Run button (also Cmd+Enter or Ctrl+Enter), a results grid, and a read-only toggle that is on by default.

#### Scenario: Running a query
- **WHEN** the user picks `data/crm.sqlite`, types `SELECT * FROM contacts LIMIT 10` and presses Cmd+Enter
- **THEN** the results grid shows up to 10 rows, the row count and the run time

### Requirement: Choosing a database
The picker SHALL list every `.ydb`, `.sqlite`, `.sqlite3` and `.db` file in the workspace, the databases of the active note's front matter, and a "Browse…" entry that opens a file dialog. The last choice SHALL be remembered per workspace.

#### Scenario: Browsing to a file
- **WHEN** the user picks "Browse…" and selects `~/Downloads/export.sqlite`
- **THEN** that file is used for the console and appears in the picker afterwards

### Requirement: Writing from the console
With read-only off, the console SHALL run any single statement after the user confirms it for that database, and SHALL show the number of changed rows. With read-only on, write statements SHALL be refused with a message. `.ydb` databases SHALL accept writes as row changes, applied to the text file.

#### Scenario: Read-only on
- **WHEN** read-only is on and the user runs `UPDATE contacts SET stage = 'won'`
- **THEN** nothing changes and the console says the statement was refused because read-only is on

#### Scenario: Confirmed write
- **WHEN** read-only is off and the user runs that statement and confirms
- **THEN** the rows are updated, the console shows the change count, and the write is logged

### Requirement: Query history
The console SHALL keep the last 50 queries per workspace, browsable with the arrow keys in the editor and from a history list.

#### Scenario: Recalling a query
- **WHEN** the user presses the Up arrow in an empty query editor
- **THEN** the last query run is filled in

### Requirement: Open in an installed SQLite extension
"Open in SQLite Viewer" (in the console and in the Explorer context menu for SQLite files) SHALL open the file with an installed extension that provides a custom editor for it. If several do, it SHALL ask which to use and remember the choice in `yamd.sqlite.viewer`. If none does, it SHALL offer to search the Marketplace for one.

#### Scenario: Viewer installed
- **WHEN** an installed extension registers a custom editor for `*.sqlite` and the user runs "Open in SQLite Viewer" on `crm.sqlite`
- **THEN** the file opens in that extension's editor

#### Scenario: No viewer installed
- **WHEN** no installed extension provides a SQLite editor
- **THEN** the user is offered a Marketplace search for "sqlite viewer"
