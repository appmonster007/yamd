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
