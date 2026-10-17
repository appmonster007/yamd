# Proposal

## Why

Students take notes, write lab reports, build up glossaries of terms, track assignments and deadlines, make flashcards, and prepare for exams. All of these workflows currently require several separate apps. YAMD is already a structured plain-text format; this change adds the primitives that make it the single tool for coursework.

## What Changes

- **Study-aid blocks** (§6.3): `:::definition`, `:::theorem`, `:::lemma`, `:::proof`, `:::example`, `:::question`, `:::remark`, `:::summary`, `:::derivation` — numbered per kind, cross-referenceable with `[@id]`, gatherable into a cheat sheet.
- **Cross-references** (§6.3.1): `[@prefix:key]` with prefixes `fig`, `tbl`, `eq`, `sec`, `def`, `thm`, `lem`, `ex`, `q`, `rem`; fallback to citation.
- **Flashcards and spaced repetition** (§6.4): container cards (`:::card` with `---` separator), leaf cards (`::card[Q]{a="A"}`), cloze deletions (`:cloze[answer]`). Schedule stored in `.yamd/srs.json` using SM-2. Quiz mode hides cloze answers in the preview.
- **Courses, deadlines and progress** (§6.5): `course:` and `due:` front matter; task `{due=…}` attributes; an agenda, per-course progress bars and stale-topic detection in the dashboard.
- **Study timer** (§6.6): a Pomodoro-style focus timer in the status bar; sessions logged to `.yamd/study-log.json` and optionally to the daily note.
- **Citations** (§6.7): BibTeX via `bibliography:` front matter; `[@key]` and `[@key, p. N]` syntax; `::bibliography` leaf; five citation styles (APA, MLA, Chicago, IEEE, Vancouver); DOI/ISBN/arXiv lookup command.
- **Peer-review commands** (§6.8): accept-all and reject-all for the review markup (§7).
- **Export** (§6.9): HTML with title page and TOC; PDF via browser print; `.docx` (OOXML, no server dependency); HTML slides.
- **Note templates** (§6.10): lecture notes, lab report, exam prep, reading note.
- **Importers** (§6.11): Obsidian vaults, Notion Markdown exports, HTML files; CSV to `.ydb`.
- **Reading list** (§6.12): a `.ydb` database template for a kanban-style reading tracker.
- **Math symbol picker** (§6.13): searchable LaTeX symbol quick-pick.
- **Diagnostic Y605** (§6.14): flashcard with no answer.

## Capabilities

All features run fully offline. Citation lookup (DOI/ISBN/arXiv) makes one optional outbound HTTPS request; the command works without network access by prompting for a BibTeX paste.

## Not in scope

- Runnable code blocks (Python/JS with inline output) — deferred for separate consideration.
- Mobile/offline capture — deferred for separate consideration.
- Image-to-LaTeX / handwriting recognition — requires a third-party model; not feasible offline.
