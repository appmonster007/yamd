# YAMD 1.2 examples

Plain Markdown notes that show every YAMD feature. Open them in VS Code with the YAMD extension installed; each one also reads fine on GitHub, where a widget is just a code block.

| Folder | What it shows |
|---|---|
| [getting-started.md](getting-started.md) | A tour: one of everything |
| [01-writing](01-writing/) | Callouts and study blocks, figures and citations, Build and the table of contents, review marks, attributes and page breaks, audio recording, and a one-page guide to every marker |
| [02-widgets](02-widgets/) | Kanban, calendar, timeline and gallery blocks |
| [03-queries](03-queries/) | Read-only SQL over CSV, JSON and SQLite as a table, board or chart |
| [04-study](04-study/) | Lecture notes, flashcards and deadlines |
| [05-export](05-export/) | HTML, print-to-PDF and slides |
| [06-linked-notes](06-linked-notes/) | Wikilinks, backlinks, tags and the note graph (through Foam) |
| [07-whats-new](07-whats-new/) | Menu and templates, snippets and completion, card details and filters, gallery picker, query builder and exports, transcription, study this note and check this note, mermaid diagrams, the outline and unlinked mentions |

## Try it

1. Open [02-widgets/kanban.md](02-widgets/kanban.md). A link above each widget block reads **Open kanban: sprint-12**. Click it to open the board beside the note, then drag a card, rename it or add one. The note changes as you go, and undo works.
2. Open [03-queries/queries.md](03-queries/queries.md) and open a query. Change `bugs.csv` and the view refreshes. **YAMD: Run Query** writes a Markdown snapshot of the result under the block.
3. Open [01-writing/references.md](01-writing/references.md) and run **YAMD: Build**. References become links, citations link to the bibliography, and the table of contents fills in. Run it again and nothing changes.
4. Run **YAMD: Export HTML** on any note.

The data and images these notes use are in `03-queries/` and `assets/`.
