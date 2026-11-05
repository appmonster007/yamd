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

## Audio

- [ ] **YAMD: Record Audio and Add Link** opens a recorder beside the note. Press Record: macOS asks to let VS Code use the microphone, or the panel says it is blocked and offers "Record in browser instead".
- [ ] Record a few seconds, pause and resume, stop, play it back, name it and save: a file appears in `audio/` next to the note and a link on its own line where the cursor was.
- [ ] Type above the cursor's line while recording; the link still lands where recording started.
- [ ] Try it with the cursor inside a code block (link goes after the block) and in a note that was never saved (it asks to save first).
- [ ] In the browser fallback, allow the microphone in the browser, save there, and the link appears in the note.

## Export

- [ ] Open the exported HTML in a browser: callouts are numbered, `[Figure 1]` links jump to the figure, widgets are static, the query is a table, a hard-wrapped paragraph is one paragraph.
- [ ] Print to PDF: `yamd:pagebreak` starts a new page.
- [ ] The slide export steps with the arrow keys.

## Companions and study tools

- [ ] Uninstall a companion (for example Edit CSV), run `YAMD: Open in CSV Editor`, accept the install offer.
- [ ] `YAMD: New Study Note` creates a note that has no leftover placeholders. Review a few cards; the schedule appears in `.yamd/srs.json`. Deadlines appear in the YAMD sidebar. Start and stop the study timer.

## Restricted Mode

- [ ] Open the workspace untrusted: boards render but cannot be edited, and queries on files outside the workspace are refused.

## Writing and onboarding (1.2 additions)

- [ ] First install: the welcome toast appears once; `YAMD: Open Walkthrough` shows 15 steps whose buttons work.
- [ ] `YAMD: Menu` and the status-bar item open the same list; each entry runs.
- [ ] `YAMD: New Note` for each template: no leftover placeholders, `Build` is clean.
- [ ] Snippets (`kanban`, `callout`) and completion (`source="`, `> [!`, `[@`) show in a real editor; hover over `source="…"` shows columns.
- [ ] Paste an image into a note (VS Code's own paste) and check the link renders in the panel.

## Widgets and data (1.2 additions)

- [ ] The pencil on a kanban card, a calendar agenda event and a timeline item opens the form; saving changes only that card; Escape closes it.
- [ ] The filter box hides cards by text, `@owner` and `#tag`, and keeps what you typed after an edit.
- [ ] Overdue cards, events and bars are red.
- [ ] Gallery: "Choose images…" opens the file dialog; clicking an image enlarges it; Escape closes.
- [ ] `Insert Query…` walks through file, table, columns, filter and view, then runs it.
- [ ] `yamd.queries.refreshOnSave` on: saving refreshes an existing snapshot and nothing else.

## Media, study and checks (1.2 additions)

- [ ] `Transcribe Audio` with a real tool set in `yamd.audio.transcribeCommand` writes a Transcript callout under the link; running it again replaces it.
- [ ] `Export as Single Markdown File` opens correctly elsewhere with images visible.
- [ ] `Export Widget as HTML` opens in a browser and looks like the panel.
- [ ] `Study This Note` creates the `cards` region and starts a review; running it twice changes nothing.
- [ ] The daily reminder appears once per day with cards due or a deadline today.
- [ ] `Check This Note` lists a missing image and a dangling `[@fig-x]`, and "Fix safe problems" adds a missing blank line.
