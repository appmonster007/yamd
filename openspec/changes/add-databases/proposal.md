# Proposal

## Why

Notion's databases and Obsidian's Dataview let people keep structured data (tasks, contacts, reading lists) next to their writing and show live views of it inside documents. YAMD documents can't hold or query structured data today. This change adds real databases, as git-friendly text files or SQLite files, that documents can display, query and edit inline, without giving a document a way to read data it shouldn't or run harmful queries.

## What Changes

- **Two database backends** behind one model:
  - `.ydb`: a readable YAML text file with a schema of typed properties, saved views and rows. It diffs and merges per row in git.
  - SQLite (`.sqlite`, `.sqlite3`, `.db`): each table is a database. Optional YAMD metadata (property types, views) lives in a `_yamd_meta` table.
- **Typed properties**, Notion style: title, text, number, select, multi-select, status, date, checkbox, URL, email, person, relation, formula (an SQL expression), created time and updated time.
- **Folder scoping**: a document can use databases in its own folder and its subfolders only, never a parent folder. This is enforced on resolved real paths, so symlinks can't escape.
- **Using databases in a document**:
  - A `databases:` front matter key maps aliases to database files.
  - `::db[alias]` shows a view: table, list, gallery or calendar, with filter, sort, group and columns.
  - ` ```query ` blocks and inline `:query[...]` run SQL and render the result.
  - A query without `db` runs over the notes in scope (front matter, tags, links, tasks), which covers Dataview-style use.
- **Interactive views**: edit cells with type-aware controls, add and delete rows, and sort and filter in the view header. Writes go to the `.ydb` text (undoable) or to SQLite (with confirmation).
- **Query security**:
  - Queries run only in trusted workspaces.
  - Document queries are read-only, single-statement and run on an in-memory copy.
  - `ATTACH`, `PRAGMA` and similar statements are blocked.
  - Time, row and file-size limits apply, and all output is escaped.
  - Preview writes are structured operations with bound parameters only.
  - Writes are logged to an output channel.
- **SQL console** in the YAMD sidebar: pick any workspace database (or browse to one), run SQL with Cmd+Enter, see results in a grid, keep a query history, and use a read-only toggle that is on by default.
- **Reuse of an installed SQLite extension**: "Open in SQLite Viewer" opens a SQLite file with whichever installed extension provides a custom editor for it, instead of YAMD building its own table browser.
- Commands to create a `.ydb` database and to add a database alias to the current note, chosen from the databases in scope.

## Capabilities

### New Capabilities
- `database-files`: the `.ydb` format, the SQLite mapping, property types, and validation of database files.
- `database-access`: aliases in front matter, the folder scoping rule, and choosing databases for a note.
- `database-views`: rendering and interactive editing of table, list, gallery and calendar views.
- `queries`: query blocks, inline queries, result rendering, and the notes tables for Dataview-style queries.
- `query-security`: trust, read-only enforcement, blocked statements, limits, and safe writes.
- `sql-console`: the sidebar console, database picker, history, and the handoff to an installed SQLite viewer.

### Modified Capabilities
- `document-diagnostics`: adds database and query diagnostics (Y850–Y854, Y950–Y952).

## Impact

- `yamd-spec.md`: a new Databases and Queries section, a `.ydb` format appendix, and the new diagnostic codes.
- `vscode-yamd/`: new `src/db/` (backends, schema, SQL worker, security checks), new views and commands, a `.ydb` language registration and a database icon.
- New dependency `sql.js` (SQLite compiled to WebAssembly, about 1 MB, MIT), bundled into the extension. No native modules and no network.
- Depends on `add-linked-notes` for the workspace index (notes tables) and the interactive preview protocol.
