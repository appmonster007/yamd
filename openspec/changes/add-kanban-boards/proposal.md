# Proposal

## Why

Kanban boards are one of the most used views in both Notion (a board view of a database) and Obsidian (the Kanban plugin, a board written as Markdown). YAMD users should be able to plan work on a board that is still plain text, and to see any database as a board, moving cards with drag and drop.

## What Changes

- **Standalone boards**: a `:::kanban` container where each heading is a column and each top-level task item under it is a card. Indented content becomes the card's body.
  - Columns can have attributes: `{limit=N}` for a work-in-progress limit and `{complete}` to tick cards moved into that column.
  - Cards can have tags and attributes such as `{due=2026-10-20 owner=ada}`.
- **Board view for databases**: `::db[ref]{type=board group=Status}` shows rows as cards in columns. The columns are the property's options in order, plus "No value".
- **Interactive boards** in the preview:
  - Drag cards within and between columns, or move them with the keyboard.
  - Add cards, edit card titles, and collapse columns.
  - Standalone boards rewrite the source text as one undoable edit. Database boards change the row's property, and its row order when no sort is set, through the safe write path from `add-databases`.
- **Rendering**: due-date badges (overdue in red), tag chips, owner, card counts and limit warnings. Headings inside a board are left out of the table of contents, the outline and heading-level checks.
- **Diagnostics**: Y603 for content in a board before its first column, Y604 when a column is over its limit, and Y855 for a board grouped by a property that can't be grouped.

## Capabilities

### New Capabilities
- `kanban-boards`: standalone `:::kanban` syntax, rendering and interactive editing.

### Modified Capabilities
- `database-views`: adds the `board` view type, with drag-and-drop between groups and manual card order.
- `document-diagnostics`: adds Y603, Y604 and Y855, and leaves headings inside boards out of the Y704 and Y705 checks.

## Impact

- `yamd-spec.md`: a Kanban section, `kanban` added to the standard directives, and the new codes.
- `vscode-yamd/`: core parsing and rendering for `:::kanban`, preview drag-and-drop using native HTML5 drag events (no library), new `move` and `addCard` messages in the preview protocol, and a `board` renderer for database views.
- Depends on `add-linked-notes` (preview edit protocol) and `add-databases` (database views and the write path).
