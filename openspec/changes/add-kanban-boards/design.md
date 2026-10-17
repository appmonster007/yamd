# Design

## Context

After the first two changes, the preview has an edit protocol (line edits with an expected-text check), database views with a safe write path, and `db` messages. The core parser already turns `:::name` containers into child blocks, so `:::kanban` contents parse as headings and lists with source line ranges. See proposal.md for motivation, and the delta specs for requirements.

## Goals / Non-Goals

**Goals:**
- A board is ordinary YAMD inside a container, so it reads well in plain text and degrades to headings and task lists in any renderer that doesn't know `kanban`.
- One board UI used for both standalone and database boards. Only the "apply move" step differs.

**Non-Goals:**
- Swimlanes, card covers, and card archive.
- Real-time multi-user boards.

## Decisions

### 1. Board model built from the parsed tree
`src/core/kanban.ts` turns a `kanban` container into a `Board`:
- `columns[]`, each with its heading, attributes and line range.
- `cards[]`, each with its title inlines, task state, tags, attributes, body blocks and full line range.

Blocks before the first heading produce Y603. Non-list blocks under a column are kept as a column description. A list item counts as a card even without a checkbox, and gets an unticked state.

Database boards build the same `Board` shape from query rows, so `renderBoard(board, mode)` is shared.

### 2. Moves as text operations computed in the extension
The webview sends `{ type: 'move', uri, card: { start, end, expect }, to: { column, index } }`. The extension:
1. Re-parses the document and confirms the card's current text at `start`–`end` equals `expect`. If not, it drops the move and re-renders.
2. Computes the destination line: after the previous card's last line, or after the heading if the index is 0. It uses the destination column's line range from the fresh parse.
3. Re-indents the card's lines to match the destination list's indentation, and toggles `[ ]`/`[x]` when moving into or out of a `{complete}` column.
4. Applies one `WorkspaceEdit` with a delete and an insert, which VS Code undoes as one step.

Doing this in the extension rather than the webview means moves always work from the latest source.

### 3. Drag and drop with native HTML5 events
The webview uses `draggable="true"` with `dragstart`, `dragover` and `drop`, plus a drop indicator element. No library is needed, which keeps the CSP strict and the bundle small. Keyboard moves (Alt+arrows) send the same `move` message. Changes are optimistic: the card moves in the DOM immediately, and the next render from the source confirms or corrects it.

### 4. Database boards
- Moving between columns sends `{ type: 'db', op: 'set', prop: group, value }`. "No value" sends `null`.
- Reordering (only when the view has no `sort`) sends `op: 'move'` with `beforeId`.
- For `.ydb`, the move is a `rows` list reorder done with `parseDocument`, so other rows' text is unchanged.
- For SQLite, the order is stored as `order: [ids]` under the table's entry in `_yamd_meta`. Rows missing from the list sort after the listed ones, by rowid.

### 5. Headings excluded from document structure
Each heading block gets an `inBoard` flag from the parser, set from the enclosing container name. The table of contents, the document symbol provider, Y704 and Y705 skip flagged headings. Slug generation still gives them IDs, so links to a column still work.

## Risks / Trade-offs

- [Optimistic UI and the source can disagree] → The next render (about 150 ms later) replaces the DOM from the source, and moves with stale `expect` text are dropped.
- [Re-indenting card bodies could change meaning for deeply nested content] → Only the card's leading indentation delta is applied, uniformly to every line, so relative nesting is kept.
- [Native drag and drop is awkward on touch devices] → VS Code is desktop-first, and keyboard moves give an accessible alternative.

## Migration Plan

1. Land after `add-databases`.
2. Update `yamd-spec.md` (Kanban section, `kanban` in standard directives, Y603, Y604, Y855) and remove the "Planned feature" callouts from `examples/05-kanban/`.
3. Rollback: boards still render as headings and task lists in older versions, because unknown directives degrade gracefully.
