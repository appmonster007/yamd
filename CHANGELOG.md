# Changelog

## 1.2.0

YAMD stops being a separate language: notes are plain Markdown, and the extension adds widgets, callouts, Build, queries, study tools and exports on top.

### Widgets and notes
- Kanban, calendar, timeline, gallery and SQL query blocks in fenced code; each opens in a panel beside the note and edits the note in place.
- A pencil on each card opens a form for due date, owner, tags and notes; a filter box (text, `@owner`, `#tag`); overdue items in red; gallery image picker and click-to-enlarge.
- Callouts (`> [!note]`, `[!theorem]`, `[!card]`, …), numbered figures, tables and equations with `[@fig-…]` references, citations and a generated bibliography, table of contents and page breaks, all through `YAMD: Build`.

### Writing
- `YAMD: Menu`, status-bar item, welcome walkthrough, `New Note` templates and a sample note.
- Snippets, completion (fence types, files, callouts, citations, references, SQL columns) and hover on `source=`.
- Insert Callout / Figure, Table or Equation / Citation / Query, Add Card / Event / Timeline Item / Image, Turn Selection into a Widget.

### Data and media
- SQL over CSV, JSON and SQLite (read-only), with table, board and chart views, snapshots, Run All Queries and optional refresh on save.
- Record audio into the note; transcribe it with a tool you choose.
- Export HTML, slides, a single Markdown file (images and query results inlined) and one widget as HTML.

### Study
- Flashcards from `> [!card]` callouts with spaced repetition, Study This Note, deadlines, dashboard, timer, once-a-day reminders.

### Reliability
- Check This Note lists missing images and data files, dangling references and unknown citation keys beside the widget, callout and marker diagnostics.
- CI runs typecheck, tests and packaging; an integration suite drives a real VS Code window.

### Removed from 0.1
`.yamd` files, the custom editor, `.ydb` databases, document variables and DOCX export. Use Foam for links and the graph.
