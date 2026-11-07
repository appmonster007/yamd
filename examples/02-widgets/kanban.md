---
title: Kanban boards
---

# Kanban boards

A `kanban` block is a board: headings are columns, task items are cards, and indented lines under a card are its body. Click **Open kanban: sprint-12** above a block to open it beside the note. Drag a card to another column, double-click a title to rename it, or add a card at the bottom of a column. Each edit rewrites only the lines inside the block, and undo works.

```kanban sprint-12
## Backlog
- [ ] Export a board as CSV
- [ ] Fix login on Safari {due=2026-12-10 owner=ada}
  Users get logged out after the redirect.
- [ ] Keyboard shortcut cheat sheet

## Todo
- [ ] Dark mode for the widgets
- [ ] Write the release notes {due=2026-12-14 owner=grace}

## Doing
- [ ] Sign-up flow {due=2026-12-12 owner=ada}
  - [x] Email field
  - [x] Password rules
  - [ ] Confirmation page
- [ ] Load test the API {owner=alan}

## Done
- [x] Set up CI
- [x] Choose a licence
```

A note can hold several boards. Give each its own id so you can open the right one:

```kanban personal-reading
## To read
- [ ] A book about maps

## Reading
- [ ] A paper on logical clocks

## Finished
- [x] A short history of zero
```

Without the extension, both boards are code blocks showing readable headings and task lists.

## Try it

1. Click **Open kanban: sprint-12** above the first block. The board opens beside the note.
2. Drag a card to another column, or within a column to reorder it.
3. Double-click a title to rename it. Tick a card's checkbox to mark it done.
4. Use the **+** at the bottom of a column (or **YAMD: Add Card**) to add a card.
5. Click the pencil on **Fix login on Safari** to edit due date, owner, tags and notes.
6. Type `@ada` or `#tag` in the filter box. Past-due cards that aren't done show in red.
7. Collapse a column with its arrow. Press Ctrl/Cmd+Z in the note to undo any edit.
8. Run **YAMD: Open Widget** to pick any block in the note from a list, or **Open Kanban** for boards only.
9. Select task lines in any note and run **Turn Selection into a Widget…**. Or type `kanban` and press Tab.
