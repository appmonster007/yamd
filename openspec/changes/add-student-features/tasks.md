# Tasks

## 1. Core: study-aid blocks and cross-references

- [x] 1.1 Add `definition`, `theorem`, `lemma`, `proof`, `example`, `question`, `remark`, `summary`, `derivation` to `KNOWN_CONTAINERS` in `src/core/parser.ts`; extend the cross-ref prefix regex to include `def`, `thm`, `lem`, `ex`, `q`, `rem`
- [x] 1.2 Implement `src/core/study/blocks.ts`: `collectStudyBlocks`, `buildCheatSheet`, `firstLine`, `STUDY_KINDS`
- [x] 1.3 Render study blocks (numbered headers, `{title}`, body) and cross-references in `src/core/render.ts`; verify with renderer tests

## 2. Core: flashcards and spaced repetition

- [x] 2.1 Add `card` to `KNOWN_CONTAINERS` and `KNOWN_LEAVES` in `src/core/parser.ts`
- [x] 2.2 Add `cloze` to `KNOWN_INLINE_DIRECTIVES` in `src/core/inline.ts`
- [x] 2.3 Implement `src/core/study/cards.ts`: `extractCards`, `clozeFront`, `clozeBack`, SM-2 `review`, `buildQueue`, `pruneSchedule`, `parseSchedule`, `stringifySchedule`, `previewIntervals`
- [x] 2.4 Render card blocks (collapsible answer), leaf cards, cloze spans (hidden in quiz mode) in `src/core/render.ts`
- [x] 2.5 Append Y605 diagnostics from `extractCards` in `src/core/lint.ts`
- [x] 2.6 Write `src/study/workspace.ts`: `collectCards`, `readData`, `writeData`, `requireFolder`, `todayIso`, `openAt`, `workspaceRoot`, `exists`
- [x] 2.7 Write `src/study/review.ts` (`ReviewPanel`) and `src/study/reviewMain.ts` (webview script); add the `review` esbuild entry
- [x] 2.8 Add cloze reveal click/Enter/Space handler to `src/preview/main.ts`

## 3. Core: courses, deadlines and progress

- [x] 3.1 Implement `src/core/study/deadlines.ts`: `collectDeadlines`, `groupDeadlines`, `relativeDay`, `isoDate`, `courseOf`, `NoteProgress`, `courseProgress`, `staleTopics`
- [x] 3.2 Implement `src/core/study/studylog.ts`: `Session`, `StudyLog`, `parseLog`, `stringifyLog`, `minutesByDay`, `minutesByCourse`, `streak`, `heatmap`, `logLine`, `formatMinutes`

## 4. Extension: timer, dashboard, review commands

- [x] 4.1 Write `src/study/timer.ts`: `StudyTimer` (status bar, start/pause/toggle/finish/cancel/menu), `recordSession`, `loadLog`; `appendToDailyNote` added to `src/workspace/daily.ts`
- [x] 4.2 Write `src/study/dashboard.ts`: `gather` (agenda, progress, stale, heatmap, queue) and `DashboardPanel`

## 5. Core: citations

- [x] 5.1 Implement `src/core/study/bibtex.ts`: `parseBibtex`, `Bibliography`, `citationStyle`, five citation styles
- [x] 5.2 Wire up `[@key]` citation rendering and `::bibliography` in `src/core/render.ts`
- [x] 5.3 Write `src/study/bibliography.ts`: `bibliographyPath`, `readBib` (mtime cache), `bibliographyFor`
- [x] 5.4 Inject `bibliography` into render options in `src/extension/preview.ts`

## 6. Core: peer review

- [x] 6.1 Implement `src/core/study/review.ts`: `collectReview`, `resolveReview` (accept/reject)

## 7. Core: export

- [x] 7.1 Implement `src/core/study/export.ts`: `documentHtml`, `slidesHtml`, `ExportOptions`
- [x] 7.2 Implement `src/core/study/zip.ts`: `zip`, `crc32`
- [x] 7.3 Implement `src/core/study/docx.ts`: `buildDocx` (OOXML, hand-rolled ZIP)

## 8. Core: templates, symbols, importers

- [x] 8.1 Implement `src/core/study/templates.ts`: `STUDY_TEMPLATES`, `READING_LIST_YDB`, `MATH_SYMBOLS`
- [x] 8.2 Implement `src/core/study/importers.ts`: `obsidianToYamd`, `notionToYamd`, `htmlToYamd`, `parseCsv`, `csvToYdb`

## 9. Extension: commands, package.json

- [x] 9.1 Write `src/study/commands.ts`: all study commands, `registerStudyCommands`
- [x] 9.2 Update `src/extension/extension.ts` to import and register `ReviewPanel`, `DashboardPanel`, `StudyTimer`, `registerStudyCommands`, `yamd.toggleQuizInternal`
- [x] 9.3 Add 21 new commands to `package.json contributes.commands`
- [x] 9.4 Add `yamd.study.*` settings (newCardsPerDay, pomodoroMinutes, logToDailyNote, staleAfterDays) to `package.json contributes.configuration`
- [x] 9.5 Add menu contributions (Explorer context, editor title, editor context) to `package.json`

## 10. Styles

- [x] 10.1 Add study-block, card, cloze, citation and reference styles to `media/preview.css`
- [x] 10.2 Create `media/review.css` for the review webview

## 11. Tests

- [x] 11.1 Write `test/study.test.ts` covering all core modules; 27 tests pass with no failures

## 12. Docs and examples

- [x] 12.1 Add §6.3–§6.14 (study features) to `yamd-spec.md`
- [x] 12.2 Add Y605 to the diagnostics table in §12.1 of the spec
- [x] 12.3 Create `examples/07-study/refs.bib` and a full per-feature guide (`README.yamd`, `01-study-blocks.yamd` … `10-symbols.yamd`, `lecture-full.yamd`)
- [x] 12.4 Write this proposal and tasks file in `openspec/changes/add-student-features/`
- [x] 12.5 Add daily-note front matter: `openDaily`/`appendToDailyNote` in `src/workspace/daily.ts` now write `---\ntitle/date/lang\n---` when no template supplies front matter
- [x] 12.6 Cross-link study features from `examples/README.yamd`, `examples/getting-started.yamd` and `examples/02-documents/review-and-comments.yamd` / `directives.yamd`

## Limitations and known gaps

- `.docx` export was validated with `unzip -t` and `xmllint`; Word and LibreOffice were not available for a live test.
- PDF export depends on the system browser; the command opens the HTML file for the user to print to PDF.
- No image-to-LaTeX or handwriting recognition (requires offline model; not in scope).
- Citation lookup requires network access; the command works offline via manual BibTeX paste.
- Items 10 (runnable code blocks) and 15 (mobile/offline capture) from the original feature list were deliberately excluded and left for separate proposals.
