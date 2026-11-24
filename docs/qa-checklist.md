# QA checklist for YAMD 1.2

Three automated suites run before this list. What is left below is what automation cannot judge: how things look, anything that needs a human at a real microphone, a quick pick or a Marketplace install.

| Suite | Command | What it drives |
|---|---|---|
| Unit tests (420) | `npm test` | the pure logic in `src/core/**`, every example note, both package manifests |
| Real VS Code, trusted (33) | `npm run test:integration` | the extension host: activation, commands, CodeLens, diagnostics, Build and Build on save, queries and refresh on save, export (HTML, slides, single Markdown, one widget), transcription with a fake tool, Study This Note, Link This Mention, the walkthrough and sidebar manifests, completion, and VS Code's own Markdown preview through our mermaid plugin |
| Real VS Code, Restricted Mode (6) | `npm run test:integration:restricted` | the workspace is untrusted (`isTrusted` is false): queries, transcription and recording refuse; an export will not read a file outside the workspace; Build still works |
| Panel scripts in Chrome (37) | `npm run test:panels` | the real `dist/preview.js` with a stubbed VS Code API: drag and drop, keyboard moves, rename, tick, add, collapse, month navigation, the details form, filter, overdue, enlarge, image picker, gallery reorder; each check was seen to fail when its expectation was wrong |

`make test-integration` runs the last three. Use a copy of `examples/` as the workspace for what follows.

## Not covered by any suite

These are the checks to do by hand. Tick each when done.

### Looks

- [ ] Open each board in `examples/02-widgets` and a query in `03-queries` in light and dark themes: nothing overlaps, clips or is unreadable. (The README screenshots are dark-theme renders in headless Chrome, not a VS Code window.)
- [ ] Table, board and bar and line charts all look right. A board card shows the other columns.
- [ ] The calendar and timeline: the month scale sits above the lanes and every bar stays inside its lane.
- [ ] Overdue cards, events and bars are clearly red.

### Widget panels

- [ ] The panel follows hand edits to the note while it is open, and says so when the block is deleted. Undo (Cmd/Ctrl+Z in the note) reverses a panel edit in one step.
- [ ] Drag a timeline bar along its lane and onto another lane (the panel scripts check the calendar, kanban and gallery, not this).
- [ ] The folder gallery (`all-assets`) shows images and cannot be reordered. Images load from next to the note.
- [ ] Edit `bugs.csv` on disk; open query panels refresh. Change a query to `UPDATE …`; the panel shows a Q001 message and nothing changes. Open `data/crm.sqlite` queries; joins work.

### Menus, pickers and prompts (anything that opens a quick pick or an input box)

- [ ] `YAMD: Menu` and the status-bar item open the same list; each entry runs. Turn the status-bar item off with `yamd.statusBar.enabled`.
- [ ] `YAMD: New Note` for each template: no leftover placeholders, `Build` is clean. `Create Sample Note` opens a note with its data file.
- [ ] `Insert Callout`, `Insert Figure, Table or Equation`, `Insert Citation` (including the offer to attach a `.bib`), `Insert Query…` (file, table, columns, filter, view), `Turn Selection into a Widget`, `Add Card`, `Add Event`, `Add Timeline Item`, `Add Image to Gallery`: each asks sensible questions and writes sensible markup.
- [ ] `Check This Note` lists a missing image, a missing data file and a dangling `[@fig-x]`; "Fix safe problems" adds a missing blank line; picking an entry jumps to its line.
- [ ] Snippets (`kanban`, `callout`, `mermaid`) and completion (`source="`, `> [!`, `[@`, `[@fig-`) show in a real editor; hovering `source="…"` shows columns.
- [ ] First install: the welcome toast appears once; `YAMD: Open Walkthrough` shows 14 steps, and each step's buttons run.
- [ ] The once-a-day reminder appears with cards due or a deadline today, and not twice in a day.

### Audio

- [ ] `Record Audio and Add Link`: macOS asks to let VS Code use the microphone, or the panel says it is blocked and offers "Record in browser instead".
- [ ] Record a few seconds, pause, resume, stop, play back, name and save: a file appears in `audio/` and a link on its own line where the cursor was, even if you typed above that line while recording. Try a cursor inside a code block (link goes after it) and a note that was never saved (it asks to save first). In the browser fallback, allow the microphone there and the link appears in the note.
- [ ] `Transcribe Audio` with a real tool in `yamd.audio.transcribeCommand` (for example `whisper-cli`): the callout appears; a second run replaces it. (A fake tool is covered by the suite.)

### Export and preview

- [ ] The exported HTML in a browser: callouts are numbered, `[Figure 1]` links jump, widgets are static, a hard-wrapped paragraph is one paragraph. Print to PDF: `yamd:pagebreak` starts a new page. The slide export steps with the arrow keys.
- [ ] Open the Markdown preview (side by side) of `examples/07-whats-new/diagrams-and-outline.md`: both diagrams are drawn; break one and see the source and the error; fix it and see it redrawn; switch light and dark and reopen: colours follow. (The suite checks that VS Code hands the block to our script and that the script draws it in Chrome, not the two together.)
- [ ] `Export as Single Markdown File` output opens correctly in another viewer with images visible. `Export Widget as HTML` looks like the panel.

### Sidebar

- [ ] The Outline view shows headings as a tree and jumps to them. In `examples/06-linked-notes`, open `people/ada.md`: Unlinked Mentions lists the sentence in `ideas.md`, and the link button turns it into a wikilink.
- [ ] The Widgets, Flashcards, Deadlines and Study views show sensible content; the study timer starts, pauses and stops; reviewing cards writes `.yamd/srs.json`.

### Companions

- [ ] Uninstall a companion (for example Edit CSV), run `YAMD: Open in CSV Editor` and the Edit CSV lens above a query block, and accept the install offer.
- [ ] Foam commands open real views: Show Backlinks, Show Note Graph, Show Tags. (Their command names come from Foam's manifest and have never been run.)
- [ ] Publish the extension, then install `YAMD Studio Pack` in a clean profile: YAMD 1.2.0 and the five companions arrive.
