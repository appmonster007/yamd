---
title: Markers at a glance
---

# Markers at a glance

Everything YAMD reads from an HTML comment follows one convention: the comment sits on a line of its own and starts with `yamd:`. It is invisible in editors, on GitHub and in every other Markdown viewer. Any other comment is yours and is never touched. The examples below are in code blocks so Build ignores them.

## Regions

A **region** is generated content between an opening and a closing marker. Build and Run Query rewrite what is between the markers and nothing else; delete the markers to stop.

````markdown
<!-- yamd:toc depth=2 -->
<!-- /yamd:toc -->

<!-- yamd:bibliography -->
<!-- /yamd:bibliography -->

<!-- yamd:query:open-bugs -->
<!-- /yamd:query:open-bugs -->
````

| Region | Filled by | Options |
|---|---|---|
| `yamd:toc` | Build | `depth=N` (default 3) |
| `yamd:bibliography` | Build | none; reads `bibliography:` and `citation-style:` from the front matter |
| `yamd:query:ID` | Run Query | none; `ID` is the id of the `sql` block above it |

## Instructions

An **instruction** is a single marker that changes how the note is exported.

````markdown
<!-- yamd:pagebreak -->

<!-- yamd:attrs class=wide width=50% -->
![A picture](../assets/team.svg)
````

| Instruction | Effect |
|---|---|
| `yamd:pagebreak` | Starts a new page when the exported HTML is printed |
| `yamd:attrs key=value …` | Adds a class (`class=wide`) or any other attribute to the next element when exported |

Attributes use the same `key=value` and `key="value with spaces"` form as widget blocks. Ids are not set here; use `^id` on its own line.

## The rest of the syntax

These are not comments, and each has one job:

| Syntax | Used for |
|---|---|
| ` ```kanban id=name ` | A widget block |
| `-- id="name" source="file"` | The first line of a `sql` block, a SQL comment, since it sits inside the code block |
| `> [!type] Title ^id` | A callout |
| `^id` on its own line | A cross-reference target |
| `{due=2026-12-01}` | A task's own attributes |

The linter warns about an unknown `yamd:` marker, a region that is never closed, and `yamd:attrs` pairs it can't use.

A comment that is not in the `yamd:` namespace stays yours:

<!-- Remember to check these figures before sending. -->
