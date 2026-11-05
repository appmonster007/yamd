# Widget spike

Plain Markdown with widget fences. Each should show a CodeLens above it.

```kanban sprint-12
## Todo
- [ ] Write copy {due=2026-11-12}
- [ ] Pick fonts

## Done
- [x] Kickoff meeting
```

```kanban
## Backlog
- [ ] Unnamed board, labelled by position
```

```calendar id=launch
- [ ] Launch {due=2026-11-20}
```

An ordinary SQL block (no source) gets no CodeLens:

```sql
SELECT 1;
```

```sql
-- id="open-bugs" source="bugs.csv" view="table"
SELECT id, title, status FROM bugs WHERE status != 'closed';
```

```sql
-- id="by-owner" source="bugs.csv" view="chart" type="bar" x="owner" y="n"
SELECT owner, count(*) AS n FROM bugs GROUP BY owner;
```

```sql
-- id="board" source="bugs.csv" view="board" group="status"
SELECT title, owner, status FROM bugs;
```
