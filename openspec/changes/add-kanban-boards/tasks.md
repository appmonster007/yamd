# Tasks

## 1. Format and model

- [x] 1.1 Update `yamd-spec.md` with the Kanban section, `kanban` in the standard directives, and the codes Y603, Y604 and Y855; remove the "Planned feature" callouts from `examples/05-kanban/`; verify the spec's directive and code tables list the additions
- [x] 1.2 Implement `src/core/kanban.ts` (columns, cards, attributes, tags, body, line ranges, the `inBoard` flag on headings) with Y603 and Y604; verify with tests for the board syntax, card body and limit scenarios
- [x] 1.3 Leave board headings out of the table of contents, document symbols, Y704 and Y705; verify with tests for the table-of-contents and heading-level scenarios

## 2. Rendering

- [x] 2.1 Implement the shared `renderBoard` (columns, counts, limits, due badges with overdue state, tag chips, owner, collapse control, add-card control); verify with renderer tests for the overdue and over-limit scenarios
- [x] 2.2 Add the database `board` view type with option-ordered columns, "No value", `columns` on cards, and Y855 for ungroupable properties; verify with tests for the board-by-status and ungroupable scenarios

## 3. Interaction

- [ ] 3.1 (implemented and checked in headless Chrome: drag, drop indicator, Alt+arrows with focus kept; manual check in VS Code pending) Implement drag and drop and keyboard moves in the webview, with optimistic DOM updates; verify by hand that dragging and Alt+arrow moves work and focus follows the card
- [x] 3.2 Implement the `move` message for standalone boards (expected-text check, destination line, re-indent, complete-column ticking, one WorkspaceEdit); verify with tests for between-column, into-complete and stale-text moves, and by hand that one Undo restores the text
- [x] 3.3 Implement adding cards and editing card titles for standalone boards; verify the add-card scenario with a test and title editing by hand
- [ ] 3.4 (implemented: `.ydb` moves set the grouped property and reorder with `moveRow`, which is tested; SQLite boards set the property but don't store a manual order; manual check pending) Implement database board moves (`set` and `move` with `beforeId`), reorder only without `sort`, and adding cards with the column's value; verify with tests for `.ydb` reorder and by hand for SQLite with the confirmation dialog

## 4. Docs and release

- [x] 4.1 Update `vscode-yamd/README.md` with boards, shortcuts and diagnostics; verify the documented shortcuts match the webview handlers
- [ ] 4.2 (typecheck and 285 tests pass; packaging and install pending) Run typecheck, tests and `npm run package`, then install the `.vsix`; verify `examples/05-kanban/sprint-board.yamd` and `roadmap-board.yamd` both work end to end

## Workflow follow-up

- Archive `add-databases` before archiving this change.
- Archive this change with `/opsx:archive` after review.
