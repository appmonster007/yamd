---
title: Getting started
bibliography: 01-writing/refs.bib
citation-style: apa
---

# Getting started

This note uses each part of YAMD once. Everything here is ordinary Markdown: without the extension, widgets show as code blocks and callouts as quotes.

<!-- yamd:toc depth=2 -->
- [Getting started](#getting-started)
  - [A board](#a-board)
  - [A query](#a-query)
  - [A callout](#a-callout)
  - [A citation](#a-citation)
  - [References](#references)
<!-- /yamd:toc -->

## A board

A fenced block named `kanban` is a board. Headings are columns and task items are cards. The word after the type is the block's id.

```kanban first-board
## Todo
- [ ] Open this board with the link above it {due=2026-12-01}
- [ ] Drag a card to another column

## Done
- [x] Install YAMD
```

## A query

A `sql` block whose first line is a comment with `source=` is a read-only query over a data file next to the note.

```sql
-- id="open-bugs" source="03-queries/bugs.csv" view="table"
SELECT id, title, owner FROM bugs WHERE status = 'open' ORDER BY id;
```

## A callout

> [!theorem] Pythagorean theorem ^thm-pyth
> For a right triangle with legs $a$, $b$ and hypotenuse $c$: $a^2 + b^2 = c^2$.

Callouts end at the first line that doesn't start with `>`, so leave a blank line after them. Study callouts are numbered; refer to [Theorem 1](#thm-pyth) and Build turns it into a link.

## A citation

Distributed systems rely on logical clocks [(Lamport, 1978)](#ref-lamport1978 "cite"). Build links the citation to the reference list below.

## References

<!-- yamd:bibliography -->
- <a id="ref-lamport1978"></a>Lamport, L. (1978). Time, Clocks, and the Ordering of Events in a Distributed System. <i>Communications of the ACM</i>, <i>21</i>(7), 558–565.
<!-- /yamd:bibliography -->
