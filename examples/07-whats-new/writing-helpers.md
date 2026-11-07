---
title: Snippets, completion and insert commands
---

# Snippets, completion and insert commands

## Snippets

Type a prefix in any Markdown note and press Tab: `kanban`, `calendar`, `timeline`, `gallery`, `query`, `callout`, `theorem`, `definition`, `card`, `toc`, `bibliography`, `pagebreak`, `figure`, `tabletarget`, `equation`, `ins`, `del`.

## Completion

Completion suggests, as you type:

- widget types after a fence: ` ```ka ` offers `kanban`;
- file names in `source="` of a query header, and column names inside the SQL;
- `view`, `group`, `x`, `y` and `type` values in a query header;
- callout types after `> [!`;
- citation keys from your `.bib` after `[@`, and reference ids after `[@fig-`;
- marker names after `<!-- yamd:`.

Hover a `source="…"` file to see its tables and columns.

## Insert commands

Each writes the markup, with a free id, at the cursor:

| Command | Writes |
|---|---|
| Insert Callout… | `> [!theorem] Title ^thm-title` |
| Insert Figure, Table or Equation… | the item and its `^fig-…` target |
| Insert Citation… | `[@key]`, and offers to attach a `.bib` file |
| Insert Query… | a query block from a short form (file, columns, filter, view) |
| Turn Selection into a Widget… | selected task items become a board, calendar or timeline |

Try it:
1. Select the three tasks below and run **Turn Selection into a Widget…**. Pick board, calendar or timeline.
2. Below them, type `kanban`, `theorem` or `toc` and press Tab.
3. Type ` ```ka` for widget completion, or `> [!` for callout types.

- [ ] Draft the outline
- [ ] Review with the team
- [ ] Publish
