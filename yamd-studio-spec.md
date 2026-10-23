# YAMD Studio Features

**Applies to:** the VS Code extension ("YAMD Studio"), not the YAMD format itself.

Everything here is editor/application behavior layered on top of plain YAMD markup (see [yamd-spec.md](yamd-spec.md)). A `.yamd` file that uses the directives below (`:::card`, `:::theorem`, etc.) is still valid, portable YAMD — any conformant renderer shows them as ordinary directives or falls back per §3.10 — but the scheduling, dashboards, commands and timers described here are specific to this extension and aren't part of the format's conformance levels (§12.3).

---

### Note resolution

Core YAMD (yamd-spec.md §4.3) resolves a wikilink (`[[guide]]`) only by relative or project-root path, matched as a path suffix — behavior any renderer handling one file in isolation can implement. YAMD Studio extends this with two more steps, available only because it maintains a project-wide index, tried in order after the Core steps find no match:

1. A note whose **file name** matches `guide` anywhere in the project.
2. A note whose `aliases` front matter (§4.12) contains `guide`.

Both ignore case. These steps never guess on an ambiguous match, same as Core: matching more than one note is reported as error `Y709`, same as a Core-level ambiguity, with the fix being to qualify the link with enough trailing path segments to be unique (`[[advanced/guide]]`). A future note that starts matching an already-qualified link re-triggers `Y709` rather than silently repointing it.

---

### Study-aid blocks

A set of container directives for academic writing. They are numbered per kind within a note, can carry an optional `{title="…"}` and an `{#id}` for cross-referencing, and are gathered by the VS Code extension for cheat-sheet generation.

| Container       | Renders as  | Numbered |
| --------------- | ----------- | -------- |
| `:::definition` | Definition  | yes      |
| `:::theorem`    | Theorem     | yes      |
| `:::lemma`      | Lemma       | yes      |
| `:::proof`      | Proof       | no       |
| `:::example`    | Example     | yes      |
| `:::question`   | Question    | yes      |
| `:::remark`     | Remark      | no       |
| `:::summary`    | Summary     | no       |
| `:::derivation` | Derivation  | no       |

```yamd
:::theorem {title="Pythagorean theorem" #thm:pythagoras}
For a right triangle with legs $a$, $b$ and hypotenuse $c$: $a^2 + b^2 = c^2$.
:::

:::proof
Drop a perpendicular from the right angle…
:::
```

Cross-references to these blocks use the same `[@id]` / `[@prefix:key]` mechanism as figures, tables and equations (yamd-spec.md §4.7), with the additional recognised prefixes `def`, `thm`, `lem`, `ex`, `q`, `rem`.

---

### Flashcards and spaced repetition

YAMD has two ways to mark content as a flashcard, for the two shapes a card actually comes in — a longer question/answer pair, or hiding a word inline. The VS Code extension collects them and schedules reviews using the SM-2 algorithm; the schedule is stored in `.yamd/srs.json`.

**Container card** — a block with a `---` separator between the question and the answer. This covers one-line Q&A too (vocabulary, definitions) — there's no separate leaf form for the short case, since a short card is just a short container:

```yamd
:::card
What is the time complexity of binary search?
---
$O(\log n)$ — each comparison halves the search space.
:::

:::card
What does "idempotent" mean?
---
Applying the operation more than once has the same effect as once.
:::
```

**Cloze deletion** — hide a word or phrase inline. Each `:cloze[…]` in a paragraph becomes one card; cards in the same paragraph share a `{n=…}` group so they are shown independently:

```yamd
The :cloze[mitochondrion] is the :cloze[powerhouse] of the cell.

The derivative of $\sin x$ is :cloze[$\cos x$]{n=1}.
```

- A card with no answer produces diagnostic `Y605`.
- Each card has a stable ID: the explicit `{#id}`, or a hash of its text. Renaming a card (changing the text) produces a new ID and a new scheduling entry.
- **Quiz mode** hides cloze answers in the preview so a note doubles as a self-test. The VS Code command `YAMD: Toggle Quiz Mode` switches it on and off.
- **Review** (`YAMD: Review Flashcards`) shows due cards one at a time. Each is graded *Again*, *Hard*, *Good* or *Easy*; the SM-2 algorithm schedules the next date. `yamd.study.newCardsPerDay` limits how many unseen cards appear per session.
- `YAMD: Prune Orphaned Card Data` removes scheduling data for cards that no longer exist in any note.

---

### Courses, deadlines and progress

Notes name a course with `course: CS101` in their front matter. Tasks and kanban cards name due dates with `{due=YYYY-MM-DD}`. The VS Code dashboard (`YAMD: Open Study Dashboard`) shows an agenda, per-course progress bars, stale topics, a study-log heatmap and the review queue.

**Agenda and deadlines.** A note's own `due:` front matter key marks the whole note as a submission. Task items anywhere in a note can carry `{due=…}` to mark individual deliverables. The dashboard groups them into *overdue*, *today*, *this week*, *later* and *done*.

**Progress.** Checked tasks count towards completion. A note not opened or not marked `reviewed: YYYY-MM-DD` in front matter for `yamd.study.staleAfterDays` days (default 14) is flagged as stale.

---

### Study timer

`YAMD: Start Study Timer` starts a focus session (default 25 minutes, configurable via `yamd.study.pomodoroMinutes`). A status-bar item counts down; clicking it shows a menu to pause, resume, finish or cancel. When the session ends at least one minute of focused time is logged. Optionally (`yamd.study.logToDailyNote: true`, default on) a line is appended to today's daily note under a **Study log** heading.

---

### Citation lookup

`YAMD: Add Citation` looks up a DOI, arXiv ID or ISBN and appends the BibTeX entry to the note's `.bib` file (named by the `bibliography:` front matter key, yamd-spec.md §2.1). Lookup requires network access; the command falls back to a paste-box when offline.

---

### Peer review summary

The review-markup operators (yamd-spec.md §7) are plain text; the VS Code extension adds two commands:

- `YAMD: Accept All Review Changes` — applies all insertions and deletions, removes markup.
- `YAMD: Reject All Review Changes` — reverts to the original text, removes markup.

The review panel (`YAMD: Review Flashcards` shares the panel) also shows a diff of pending changes for a quick pass.

---

### Export

**HTML** (`YAMD: Export as HTML`) — a self-contained HTML file with a title page (when `title:` is set), a linked table of contents, and a print stylesheet. KaTeX math and syntax-highlighted code are inlined.

**PDF** (`YAMD: Export as PDF`) — the same HTML is opened in the system browser. Use File → Print → Save as PDF for the final file.

**Word (.docx)** (`YAMD: Export as Word (.docx)`) — a minimal OOXML package with headings, paragraphs, bold/italic/code/links, tables and task lists.

**Slides** (`YAMD: Export as Slides (HTML)`) — each level-1 heading (or a `---` thematic break) starts a new slide. The output is a single HTML file with a keyboard-navigable presentation.

---

### Note templates

`YAMD: New Study Note…` shows a template picker with four built-in templates: **Lecture notes**, **Lab report**, **Exam prep** and **Reading note**. Each template has placeholders `{{@date}}`, `{{@title}}`, `{{@course}}` and `{{@cursor}}` (where the cursor should land) — see yamd-spec.md §4.12.

---

### Importing from other tools

`YAMD: Import Notes from Folder…` converts a folder of notes to YAMD in a chosen destination:

| Source             | Converted from                            |
| ------------------ | ----------------------------------------- |
| Obsidian vault     | Markdown with `[[links]]`, callouts, tags |
| Notion export      | Markdown with Notion-style callouts       |
| HTML files         | Headings, paragraphs, lists, code, links  |

CSV files can be turned into `.ydb` databases with the column types inferred from the first ten rows.

---

### Reading list

`YAMD: New Reading List` creates a `reading-list.ydb` database with columns for Title, Author, Course, Status (*To read* / *Reading* / *Done*), Pages and Due. It opens in the preview as a kanban board grouped by Status.

---

### Math symbols

`YAMD: Insert Math Symbol` opens a searchable picker of common LaTeX symbols (Greek letters, operators, arrows, set notation, logic, calculus) and inserts the selected symbol as inline math.

---

### Reference locating (arrow-annotation successor)

A span's `ref=target-id` attribute (yamd-spec.md §4.5) renders as a plain anchor link in any renderer. YAMD Studio adds two editor-only affordances on top, neither of which is part of the rendered document:

- **Color coding.** Every distinct `target-id` referenced via `ref=` in a document gets its own color (no two repeat on a page), applied as a decoration on the `ref=` span in the editor and in the live preview, so references to the same target stay visually grouped without a drawn connector line.
- **Locate on hover.** Hovering a `ref=target-id` span shows the target's line and column number and a "Jump to target" action.

---

### Diagnostics added by Studio features

| Code  | Severity | Meaning                                         |
| ----- | -------- | ------------------------------------------------ |
| `Y605` | warning | Flashcard has no answer (Flashcards, above)     |

These extend the core diagnostic set in yamd-spec.md §12.1; a renderer that only implements the core format never emits them.
