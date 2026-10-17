# Tasks

## 1. Format and core parsing

- [x] 1.1 Update `yamd-spec.md` with tags, embeds, block IDs, aliases, the wikilink resolution order, template placeholders and the new or changed codes (Y301, Y602, Y708, Y709); remove the "Planned feature" callouts from `examples/03-notes/` and add those files to the no-diagnostics set in `test/examples.test.ts`; verify the spec's pain-point table and code tables list the additions
- [x] 1.2 Parse tags (inline `tag` node, front matter `tags`) and narrow Y301 to `##word` and more; verify with tests for the tag scenarios in the `yamd-rendering` delta, including `#42`, `C#`, URLs and code
- [x] 1.3 Parse block IDs on paragraphs and list items and embeds (inline and block-level); verify block ID removal, anchor rendering and Y708 with tests
- [x] 1.4 Implement `src/core/resolve.ts` with the `NoteLookup` interface: resolution order, case-insensitive name and alias matching, ambiguity candidates, section and block extraction; verify with in-memory fixture tests for each `note-linking` resolution scenario
- [x] 1.5 Render resolved embeds and `::include` with the depth limit, cycle placeholder and `data-source` attributes; add Y602, Y701 (embeds and block refs) and Y709 to the linter; verify with tests for the embed, circular and missing-target scenarios

## 2. Workspace index

- [ ] 2.1 (implemented in `src/workspace/index.ts` over the tested `NoteStore`; the temp-folder test is not written) Implement the index in `src/workspace/` (initial batched scan, summaries, reverse link map, exclusions, 2 MB cap, progress); verify with tests that run the index over a temp folder of fixtures
- [ ] 2.2 (implemented; manual check pending) Keep the index fresh from file watchers, unsaved edits and renames; verify by hand that a tag typed without saving appears in the tag explorer within 1 second and that a deleted note disappears
- [ ] 2.3 (implemented; manual check pending) Wire the index into diagnostics so cross-note Y701, Y602 and Y709 update when other notes change; verify by hand that deleting a linked note produces Y701 in the linking note

## 3. Linking and navigation

- [ ] 3.1 (implemented in `src/workspace/features.ts`; provider tests not written, manual check pending) Add completion for `[[`, `![[`, `#` (tags) and headings and block IDs inside links; verify with provider tests against a fixture index and by hand
- [ ] 3.2 (implemented; manual check pending) Add document links, Go to Definition and creating missing notes from links; verify each `note-linking` navigation scenario by hand
- [x] 3.3 Add link updates on rename through `onWillRenameFiles`; verify with tests for the path-based and name-based rename scenarios, and by hand that one Undo reverts the rename and the link edits
- [ ] 3.4 (implemented; manual check pending) Add the quick switcher with alias search and note creation; verify the alias scenario by hand
- [ ] 3.5 (implemented; manual check pending) Add the document symbol provider for headings; verify the Outline view nests headings

## 4. Panels and graph

- [ ] 4.1 (implemented; manual check pending) Add the YAMD view container, the Backlinks view (linked and unlinked mentions, with the "link it" action) and the Tags tree; verify each scenario in `note-panels` by hand
- [x] 4.2 Add the Properties webview view with typed fields, editing through `yaml.parseDocument` that keeps comments; verify with tests for the front matter rewrite, and by hand that Undo restores the old value
- [ ] 4.3 (implemented, checked in headless Chrome with the example notes; manual offline check pending) Add the graph view (bundled d3-force, canvas, global and local modes, filters, click to open, hollow nodes for missing notes, no network); verify the local depth and click scenarios by hand with networking disabled

## 5. Daily notes and templates

- [x] 5.1 Implement the date formatter and placeholder expansion; verify with unit tests for each token and `{{@cursor}}`
- [ ] 5.2 (implemented; manual check pending) Add the daily note commands (today, previous, next) and the template insertion command with their settings; verify each `daily-notes-and-templates` scenario by hand

## 6. Interactive preview

- [x] 6.1 Implement the edit message protocol with the expected-text check, line-scoped edits, and the trust and read-only guards; verify with tests for the stale-edit check
- [ ] 6.2 (implemented, embeds route edits by `data-source`; manual check pending) Make task checkboxes clickable, including inside embeds; verify by hand that ticking updates the right file, Undo works, and checkboxes are disabled in Restricted Mode

## 7. Docs and release

- [x] 7.1 Update `vscode-yamd/README.md` with the new commands, views, settings and diagnostics; verify the documented commands exist in `package.json`
- [ ] 7.2 (typecheck and 247 tests pass; packaging and install pending) Run typecheck, tests and `npm run package`, then install the `.vsix`; verify `examples/03-notes/home.yamd` shows tags, embeds, backlinks and the graph

## Workflow follow-up

- Archive `add-vscode-extension` before archiving this change.
- Archive this change with `/opsx:archive` after review.
