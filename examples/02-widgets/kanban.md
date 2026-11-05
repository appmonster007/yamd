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
