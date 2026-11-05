# QA checklist for YAMD 1.2

`make test-integration` already checks, in a real VS Code: activation, every contributed command, CodeLens above widget blocks, diagnostics and quick fixes, Build (and that a second Build changes nothing), Run Query (and its idempotence), opening a widget and a query panel (one panel per block), accept/reject review commands, Go to Reference Target, and HTML and slide export. What follows is what automation can't do: anything that happens inside a widget panel, and how things look.

Use a copy of `examples/` as the workspace.

## Widget panels (`examples/02-widgets`)

- [ ] **Kanban:** open `sprint-12`. Drag a card to another column; the note changes only inside the fence; undo restores it.
- [ ] Rename a card (double-click its title) and add a card from the box at a column's bottom.
- [ ] Tick a card's checkbox; the `[ ]` in the note becomes `[x]`.
- [ ] Edit the note by hand while the panel is open; the panel follows. Delete the block; the panel says it is gone.
- [ ] Open both boards in `kanban.md`; two panels open, and clicking a lens again reveals the same panel.
- [ ] **Calendar:** it opens on December 2026 (the next month with an event); ‹ › and Today move between months. Drag an event to another day; only its `due=` changes. Click a date to expand it.
- [ ] **Timeline:** a month scale sits above the lanes and every bar stays inside its lane. Drag a bar along its lane (start and end move together) and onto another lane.
- [ ] **Gallery:** drag to reorder; the folder gallery (`all-assets`) shows the images and cannot be reordered.
- [ ] Images in a gallery load (the panel can read files next to the note).

## Query widgets (`examples/03-queries`)

- [ ] Table, board and bar and line charts all render. A board card shows the other columns.
- [ ] Edit `bugs.csv` on disk; open query panels refresh without reopening.
- [ ] Change a query to `UPDATE bugs SET status='x'`; the panel shows a Q001 message and nothing changes.
- [ ] Break a column name in a chart; the panel and the Problems panel both explain it.
- [ ] Open `data/crm.sqlite` queries; joins work.

## Writing tools

- [ ] **Build** in `01-writing/references.md`: delete a label's number, run Build, it returns.
- [ ] Turn on `yamd.build.onSave`; saving a changed note rebuilds it. Turn off `yamd.build.linkCitations`; citations stay as `[@key]`.
- [ ] Callouts: remove the blank line after one; a warning appears with a quick fix.
- [ ] `YAMD: Go to Reference Target` on an image link opens the image beside the note.

## Export

- [ ] Open the exported HTML in a browser: callouts are numbered, `[Figure 1]` links jump to the figure, widgets are static, the query is a table, a hard-wrapped paragraph is one paragraph.
- [ ] Print to PDF: `yamd:pagebreak` starts a new page.
- [ ] The slide export steps with the arrow keys.

## Companions and study tools

- [ ] Uninstall a companion (for example Edit CSV), run `YAMD: Open in CSV Editor`, accept the install offer.
- [ ] `YAMD: New Study Note` creates a note that has no leftover placeholders. Review a few cards; the schedule appears in `.yamd/srs.json`. Deadlines appear in the YAMD sidebar. Start and stop the study timer.

## Restricted Mode

- [ ] Open the workspace untrusted: boards render but cannot be edited, and queries on files outside the workspace are refused.
