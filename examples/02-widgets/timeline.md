---
title: Timeline
---

# Timeline

A `timeline` block is a calendar stretched into bars: `{start=…}` and `{due=…}` are the two ends. Headings are optional; with them, each heading is a lane. Drag a bar to reschedule it (start and end shift together) or onto another lane to move it there.

```timeline q1-roadmap
## Ada
- [ ] Ship the billing API {start=2026-01-12 due=2026-02-06}
- [ ] Billing dashboard {start=2026-02-09 due=2026-03-06}

## Alan
- [ ] Migrate auth {start=2026-01-19 due=2026-03-13}

## Grace
- [ ] Sign-up redesign {start=2026-02-02 due=2026-02-27}
- [ ] Usability study {start=2026-03-02 due=2026-03-20}
```

## Try it

1. Click **Open timeline: q1-roadmap**.
2. Drag a bar sideways to reschedule it. Start and due shift together.
3. Drag a bar onto another lane to change its owner lane.
4. Read the schedule list under the lanes, and click the pencil on an item to edit it.
5. Use **YAMD: Add Timeline Item** to add one, or type `timeline` and press Tab.
