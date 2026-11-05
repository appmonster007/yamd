---
title: Queries over CSV, JSON and SQLite
---

# Queries over CSV, JSON and SQLite

A query is a `sql` block whose **first line is a comment** naming the block and its data file. The rest is a single `SELECT`:

- `id` names the block so you can open it; `source` is a CSV, JSON or SQLite file, relative to the note.
- `view` is `table` (the default), `board` or `chart`.
- CSV and JSON load into a table named after the file (`bugs.csv` becomes `bugs`). SQLite files are read as they are.
- Queries are read-only. To change data, use **YAMD: Open Query Source in SQL Client**, or edit the file in a CSV or SQLite editor.

Open a block from the link above it. The widget refreshes when the data file changes. **YAMD: Run Query** writes a Markdown snapshot (at most 50 rows) under the block, between `yamd:query` markers.

## A table

```sql
-- id="open-bugs" source="bugs.csv" view="table"
SELECT id, title, owner, days_open
FROM bugs
WHERE status = 'open'
ORDER BY days_open DESC;
```

## A board

`group` names the column to group by; the other columns become card details.

```sql
-- id="bugs-by-status" source="bugs.csv" view="board" group="status"
SELECT title, owner, status FROM bugs;
```

## A chart

`type` is `bar` or `line`; `x` and `y` name result columns, and `y` must be numeric.

```sql
-- id="bugs-per-owner" source="bugs.csv" view="chart" type="bar" x="owner" y="n"
SELECT owner, count(*) AS n FROM bugs GROUP BY owner ORDER BY owner;
```

## JSON

```sql
-- id="platform-team" source="people.json" view="table"
SELECT name, level, city FROM people WHERE team = 'Platform' ORDER BY level DESC;
```

```sql
-- id="people-by-team" source="people.json" view="chart" type="line" x="team" y="avg_level"
SELECT team, round(avg(level), 1) AS avg_level FROM people GROUP BY team ORDER BY team;
```

## SQLite

A SQLite file can hold several tables, so queries can join them.

```sql
-- id="open-deals" source="data/crm.sqlite" view="table"
SELECT c.name, c.company, d.title, d.amount, d.closes_on
FROM deals d JOIN contacts c ON c.id = d.contact_id
ORDER BY d.amount DESC;
```

```sql
-- id="pipeline" source="data/crm.sqlite" view="board" group="stage"
SELECT name, company, value, stage FROM contacts;
```

## What is not allowed

Only one `SELECT` runs. Statements such as `UPDATE`, `DROP` or `PRAGMA`, and several statements in one block, are refused with a message in the widget.
