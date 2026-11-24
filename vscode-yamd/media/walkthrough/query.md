# SQL over your data files

````
```sql
-- id="open-bugs" source="bugs.csv" view="table"
SELECT id, title, owner FROM bugs WHERE status = 'open';
```
````

Queries are **read-only** and run on a copy; the data file is never changed. The view can be `table`, `board` (needs `group="column"`) or `chart` (needs `x` and `y`).

**Run Query** writes a Markdown snapshot of the result under the block so the note reads without the extension. **Run All Queries in This Note** refreshes every snapshot, and the `yamd.queries.refreshOnSave` setting does it on save.
