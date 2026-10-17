# Tasks

## 1. Format and setup

- [x] 1.1 Update `yamd-spec.md` with the Databases and Queries section, the `.ydb` appendix, folder scoping, and the codes Y850–Y854 and Y950–Y952; remove the "Planned feature" callouts from `examples/04-databases/` and `examples/03-notes/queries.yamd`, and check that `examples/04-databases/security.yamd` reports each code it describes; verify the spec's code tables list every new code
- [ ] 1.2 (implemented: `sql.js`, `dist/sql-wasm.wasm` copied by `esbuild.mjs`, `ydb` language with a YAML-based grammar; no file icon; highlighting check by hand pending) Add `sql.js`, copy its WASM file into `dist/` at build time, and register the `.ydb` language (YAML-based grammar and icon); verify `npm run build` puts the WASM file in `dist/` and a `.ydb` file opens with highlighting

## 2. Database backends

- [x] 2.1 Implement the `.ydb` loader and validator (Y852, Y853, Y854 with source ranges); verify with tests for each `database-files` scenario
- [x] 2.2 Implement `.ydb` row writes with `parseDocument` that only touch the changed row; verify with tests that comments, key order and other rows are byte-identical after a write
- [ ] 2.3 (loader, `_yamd_meta` and inferred types done and tested against `crm.sqlite`; files are re-read on each run rather than cached by mtime) Implement the SQLite loader (tables, `_yamd_meta`, inferred types) and the cached in-memory copies keyed by mtime; verify with tests against a fixture `.sqlite` file
- [ ] 2.4 (implemented in `src/extension/dbWorker.ts` and `DatabaseService.run`; row limit and total are tested, the timeout was checked against the bundled worker by hand) Implement the SQL worker with the timeout, row limit and total count; verify with tests for a normal query, a runaway recursive CTE (stopped, Y952) and a capped result
- [x] 2.5 Implement property types, including formulas as view columns, relations and automatic times; verify with tests for the formula, relation and automatic-time scenarios

## 3. Access and security

- [x] 3.1 Implement `resolveDatabase` with alias lookup, the `..` and absolute-path checks, and the realpath containment check; verify with tests for subfolder, parent, absolute, other-workspace-folder and symlink cases (Y850, Y951)
- [x] 3.2 Implement the read-only check (single statement, blocked keywords, EXPLAIN opcodes) and run document SQL only on copies; verify with tests for every `query-security` scenario, including the filter injection
- [ ] 3.3 (implemented in `DatabaseService.writeSqlite`; the parameterized-value test passes, the changed-on-disk case needs a manual check) Implement the SQLite write path (mtime check, per-session confirmation, temp file and atomic rename, output channel log); verify with tests for the changed-on-disk case and a parameterized value containing SQL
- [ ] 3.4 (implemented; manual check pending) Gate every database feature on workspace trust; verify by hand in Restricted Mode that no database file is read

## 4. Queries

- [x] 4.1 Parse ` ```query ` blocks and `:query[]` into core nodes that render as placeholders, and leave ` ```sql ` alone; verify with renderer tests
- [x] 4.2 Build the notes tables (`notes` with front matter columns, `tags`, `links`, `tasks`) from the index, limited to scope; verify with tests for the Dataview-style and open-tasks scenarios
- [x] 4.3 Fill placeholders asynchronously in the preview, with table, list and value result views and escaped output; verify with tests for the HTML-in-data scenario, and by hand that results appear after the document
- [ ] 4.4 (implemented: file watchers, `.ydb` edits and index changes refill the preview after 300 ms; manual check pending) Re-run affected placeholders when their databases or scoped notes change; verify by hand that editing `tasks.ydb` updates a query in an open preview within 1 second

## 5. Database views

- [x] 5.1 Render `::db` table, list, gallery and calendar views with saved views, attribute overrides, grouping and type-aware display; verify with renderer tests for each view type and the grouping scenario
- [ ] 5.2 (implemented; checked in headless Chrome that the webview sends the right messages; manual check pending) Add interactive cell editing, adding rows and deleting rows through validated `db` messages; verify by hand for `.ydb` (with Undo) and SQLite (with the confirmation dialog)
- [ ] 5.3 (implemented: column sort and search are client-side; filtering is by search text, not per property; manual check pending) Add the temporary sort, filter and search header and "Save view"; verify by hand that sorting doesn't change the document and that a saved view appears in the `.ydb` file
- [x] 5.4 Add the error box and Y851 for views and queries; verify with a test for the invalid-filter scenario

## 6. Commands and console

- [ ] 6.1 (implemented; manual check pending) Add "YAMD: New Database" and "YAMD: Add Database to Note" (picker limited to scope, front matter merge); verify each scenario by hand
- [ ] 6.2 (implemented; manual check pending) Add the SQL Console view (picker with Browse, editor, Cmd+Enter, results grid, read-only toggle, confirmed writes, history); verify each `sql-console` scenario by hand
- [ ] 6.3 (implemented; manual check pending) Add "Open in SQLite Viewer" with custom-editor discovery and the Marketplace fallback; verify by hand with and without a SQLite viewer extension installed

## 7. Docs and release

- [x] 7.1 Update `vscode-yamd/README.md` with databases, queries, security, console, settings and diagnostics; verify the documented settings exist in `package.json`
- [ ] 7.2 (typecheck and 285 tests pass; packaging and install pending) Run typecheck, tests and `npm run package`, check the `.vsix` size, and install it; verify `examples/04-databases/views.yamd` and `queries.yamd` render and edits work end to end

## Workflow follow-up

- Archive `add-linked-notes` before archiving this change.
- Archive this change with `/opsx:archive` after review.
