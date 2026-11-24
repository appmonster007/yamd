---
title: Calendar
---

# Calendar

Every top-level task item in a `calendar` block is an event, placed by its `{due=YYYY-MM-DD}`. Open it beside the note, drag an event to another day to reschedule it (only its `due=` changes), and click a date or an event for details.

```calendar december
- [ ] Submit grant report {due=2026-12-04}
- [ ] Team sync {due=2026-12-08 owner=ada}
- [ ] Draft budget review {due=2026-12-08 owner=grace}
- [ ] Holiday party {due=2026-12-18}
- [x] Renew domain {due=2026-12-01}
```

An item without a due date can't be placed on a day, so it isn't shown.

## Try it

1. Click **Open calendar: december**. The month with the earliest event opens.
2. Drag **Team sync** to another day. Only its `due=` changes in the note.
3. Click a date to narrow the event list to that day; use the week option to narrow to a week.
4. Switch months with the arrows.
5. Click the pencil on an event for due date, owner, tags and notes.
6. Use **YAMD: Add Event** to add an event, or type `calendar` and press Tab for a snippet.
