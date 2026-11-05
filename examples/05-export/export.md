---
title: Exporting a note
author: Ada Lovelace
bibliography: ../01-writing/refs.bib
citation-style: ieee
---

# Exporting a note

**YAMD: Export HTML** writes `export.html` next to this note. **YAMD: Export PDF** opens that page in your browser to print it. **YAMD: Export Slides** writes `export-slides.html`, which starts a new slide at every `---` rule and every H1 or H2 heading.

The exported page resolves callouts, cross-references and citations, and draws widgets and queries as static HTML.

The prose of a note is read as plain Markdown, so it exports the way VS Code's preview and GitHub show it: a line break inside a paragraph is a space, a #hashtag or ==equals signs== are just text, and [[another-note]] becomes a link to `another-note.md` next to the export. Inside a widget block the fuller syntax still works, so a kanban card can carry a #tag and a `{due=…}` date.

## A callout

> [!theorem] A short theorem ^thm-short
> Every export is a single file you can email.

See [Theorem 1](#thm-short). Logical clocks are described in [\[1\]](#ref-lamport1978 "cite").

## A board, as static columns

```kanban export-board
## Todo
- [ ] Write the report

## Done
- [x] Collect the data
```

## A query, as a table

```sql
-- id="export-table" source="../03-queries/bugs.csv" view="table"
SELECT owner, count(*) AS bugs FROM bugs GROUP BY owner ORDER BY owner;
```

<!-- yamd:pagebreak -->

## Slides

---

## Last slide

A `---` line above starts a new slide in the slide export.

## References

<!-- yamd:bibliography -->
1. <a id="ref-lamport1978"></a>L. Lamport, “Time, Clocks, and the Ordering of Events in a Distributed System,” <i>Communications of the ACM</i>, vol. 21, no. 7, pp. 558–565, 1978.
<!-- /yamd:bibliography -->
