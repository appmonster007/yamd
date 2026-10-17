# Design

## Context

After `add-linked-notes`, the extension has a workspace index and an interactive preview protocol (`edit` messages with an expected-text check). There is no data layer yet. See proposal.md for motivation, and the delta specs for requirements. The main constraints are no native modules, no network, and safety even when a document is malicious.

## Goals / Non-Goals

**Goals:**
- One query model (SQLite SQL) for both backends and for the notes tables, so authors learn one language.
- Security by layering: trust gate, scope check, read-only check, in-memory copy, worker timeout and escaped output. Each layer would stop most attacks on its own.
- `.ydb` files stay pleasant to read, edit by hand and merge in git.

**Non-Goals:**
- Building a SQLite table browser. That is handed to installed extensions.
- Rollups, charts, and formulas beyond SQL expressions.
- Multi-user sync or locking of SQLite files beyond the mtime check.

## Decisions

### 1. sql.js as the engine for everything
- `sql.js` (SQLite compiled to WASM) runs in a `worker_threads` worker started on first use.
- A `.ydb` database is loaded into an in-memory SQLite database: one table named after the file, with columns per property, and `multi_select` and `relation` stored as JSON text.
- Formula properties are added as columns of a view over that table (`SELECT *, (<expr>) AS "<name>" FROM base`), so queries see them like any other column.
- The notes tables are built the same way from the workspace index, limited to the document's scope.

*Alternatives considered:*
- `better-sqlite3`: a native module, which would need per-platform builds of the `.vsix`.
- A custom query language for `.ydb`: one more thing to learn and implement, with no benefit over SQL.

### 2. `.ydb` read and write
- Reading uses the `yaml` package and validates the result against the property types, producing Y852–Y854 with ranges from the YAML parser's source positions.
- Writing uses `parseDocument`, then `setIn`/`addIn`/`deleteIn` on `rows[i]`. Only the changed row's lines are replaced through a `WorkspaceEdit`, so other rows, comments and key order stay unchanged and the change is undoable.
- New rows get `id`s that are 6-character base36 strings, checked for uniqueness.

### 3. SQLite read and write
- **Read**: the file's bytes are loaded into the worker as a new in-memory database every time the file's mtime changes, and cached by `(path, mtime)`. Document queries always run on this copy.
- **Write** (preview or console):
  1. Check that the file's mtime still matches the cached one.
  2. Ask for confirmation on the first write to that file in the session.
  3. Apply the parameterized statement to the copy, export it with `db.export()`, and write it to a temp file next to the original.
  4. Rename the temp file over the original, which is atomic on the same volume.
  5. Log the write.

  This rewrites the whole file, which is fine for the database sizes the size limit allows. It is documented as a known limit.
- `_yamd_meta(key TEXT PRIMARY KEY, value TEXT)` stores JSON for property types and views per table. It is created only when the user saves a view or sets a type.

### 4. Folder scope check
`resolveDatabase(docPath, ref)` resolves the reference against the document's folder, rejects absolute paths and any `..` segment before resolving, then compares `fs.realpath` of the target with `fs.realpath` of the document's folder plus a path separator. Every read goes through this one function, including views, queries, relations between databases and notes tables. A relation from one database to another is checked against the *document's* folder, so a database can't be used to reach a file the document couldn't reach directly.

### 5. Read-only check for document SQL
1. Reject the text if it contains more than one statement. The SQL is prepared with sql.js, and any text left over after the first statement must be whitespace or comments.
2. Reject the keywords `ATTACH`, `DETACH`, `PRAGMA` and `VACUUM`, and the function `load_extension`, after removing string literals and comments.
3. Run `EXPLAIN <sql>` and reject the statement if the bytecode contains `OpenWrite`, `Insert`, `Delete`, `IdxInsert`, `IdxDelete`, `Clear`, `Destroy`, `CreateBtree` or `ParseSchema`. This is the same information SQLite uses for `sqlite3_stmt_readonly`, which sql.js doesn't expose.
4. Run the statement on the in-memory copy, so even an undetected write is thrown away.

View filters are wrapped as `SELECT ... WHERE (<filter>)` and then go through the same steps.

### 6. Worker and limits
The worker receives `{ dbKey, sql, params, maxRows }` and returns rows or an error. The extension host starts a timer for `yamd.queries.timeout`. On timeout it terminates the worker (the only reliable way to stop sql.js mid-statement), reports Y952, and starts a fresh worker lazily. Results are cut off at `maxRows`, and the total count comes from continuing to step without materializing rows, up to 100,000.

### 7. Rendering
- `src/core` gets two new node kinds, `dbView` (from `::db`) and `query` (from ` ```query ` and `:query[]`). The core renderer outputs a placeholder element with a stable key.
- The preview manager runs the queries asynchronously and posts `{ type: 'fill', key, html }` messages, so the document renders instantly and the data arrives after.
- View HTML is built in the extension host by the same escaping helpers as the core renderer. The webview never builds HTML from data.
- Interactive controls post `{ type: 'db', op: 'set' | 'add' | 'delete' | 'saveView', ref, rowId, prop, value }`. The extension validates `op`, `prop` and the value's type against the schema before writing.

### 8. Dependency tracking for live results
Each rendered placeholder records the database files (or "notes in scope") it read. File watchers on those paths, and index change events filtered by scope, trigger a re-run of only the affected placeholders, debounced by 300 ms.

### 9. SQL console
- A `WebviewView` in the YAMD container holds a `<textarea>` editor with simple SQL keyword highlighting done in the webview (no Monaco, to keep the size down), a picker, a read-only toggle and a results grid built with escaped HTML. History is kept in `workspaceState`.
- Writes go through the same write path as the preview. For `.ydb` databases, write statements run on the in-memory copy, the changed rows are found by comparing `id`s, and the change is applied to the text as row edits.

### 10. Handing off to a SQLite viewer
At run time, the extension reads `vscode.extensions.all[].packageJSON.contributes.customEditors` and keeps editors whose `selector[].filenamePattern` matches the file's name. It opens the file with `vscode.commands.executeCommand('vscode.openWith', uri, viewType)`, so no extension IDs are hard-coded. With none installed, it runs `workbench.extensions.search` with `sqlite viewer`.

## Risks / Trade-offs

- [The sql.js WASM file adds about 1 MB to the `.vsix`] → Acceptable for an offline engine. It is loaded lazily, only when a database feature is first used.
- [Rewriting the whole SQLite file on each write races with other writers] → The mtime check, an atomic rename, the confirmation dialog and documented limits. Users with concurrent writers should use the console's read-only mode or their SQLite tool.
- [The EXPLAIN opcode list may miss a write path in a future SQLite version] → Queries also run on a discarded in-memory copy, so a missed write still never reaches disk.
- [Large `.ydb` files are slow to load] → The size limit, and a suggestion in the Y852 hover text to move large datasets to SQLite.
- [Formula expressions run SQL from the database file] → They go through the same read-only check and run on the copy.

## Migration Plan

1. Land after `add-linked-notes`, which provides the workspace index and preview protocol.
2. Update `yamd-spec.md` with a Databases and Queries section, a `.ydb` appendix and the codes Y850–Y854 and Y950–Y952.
3. Use `examples/04-databases/` (with `data/tasks.ydb`, `data/projects.ydb` and `data/crm.sqlite`) as fixtures, and remove its "Planned feature" callouts.
4. Rollback means removing the extension version. `.ydb` and SQLite files stay readable by any YAML or SQLite tool.

## Open Questions

- The default row limit for gallery and calendar views may need tuning separately from tables. The plan is to use the same `maxRows` setting.
