---
title: Card details, filter and overdue
---

# Card details, filter and overdue

Open a block with the link above it. On a card, an agenda event or a timeline item, the **pencil** opens a form: due date, owner, tags and notes. Saving rewrites only that card's lines (`{due=… owner=…}`, `#tags` and the indented body), and undo works. If the card changed in the note meanwhile, the edit is refused.

The **filter box** above each panel hides cards that don't match what you type: plain text, `@owner` or `#tag`, in any mix (`@ada #urgent`).

Anything not done and past its date shows **in red** (the dates here are in the past on purpose).

```kanban support
## Open
- [ ] Reset password emails are late #urgent {due=2025-01-15 owner=ada}
  Check the mail queue first.
- [ ] Update the help page #docs {owner=grace}

## Done
- [x] Fix the typo on the pricing page #docs {owner=ada}
```

```calendar releases
- [ ] Beta release {due=2025-01-20 owner=ada}
  Announce on the blog.
- [x] Freeze the branch {due=2025-01-10 owner=alan}
```

```timeline migration
## Database
- [ ] Copy the tables #urgent {start=2025-01-02 due=2025-01-12 owner=alan}
- [x] Plan the cutover {start=2025-01-01 due=2025-01-03 owner=grace}
```

## Try it

1. Open **support**, click the pencil on the urgent card, change the owner, and Save.
2. Type `#urgent` in the filter box, then `@grace`, then both.
3. Open **releases** and **migration**; their past dates show in red.
