---
title: Queries, snapshots and exports
---

# Queries, snapshots and exports

## Insert Query…

Pick a data file, a table, the columns, an optional filter and a view; YAMD writes the block and runs it. This one was built that way:

```sql
-- id="open-by-owner" source="../03-queries/bugs.csv" view="table"
SELECT id, title, owner
FROM bugs
WHERE status = 'open'
ORDER BY id;
```

## Run all, and keep snapshots current

**Run All Queries in This Note** writes a Markdown snapshot of every named query under its block and refreshes the ones already there; running it twice changes nothing. Set `yamd.queries.refreshOnSave` to refresh existing snapshots whenever you save.

## Sharing

- **Export as Single Markdown File** writes `name.export.md`: Build applied, images inlined as data URIs, query results as snapshot tables.
- **Export Widget as HTML** writes the block under the cursor (or the one you pick) as a read-only page, for example `data-and-sharing-open-by-owner.html`.
- **Export HTML** and **Export Slides** are unchanged.
