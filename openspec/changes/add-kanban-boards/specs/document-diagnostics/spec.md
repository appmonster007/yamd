# Spec Delta

## ADDED Requirements

### Requirement: Kanban diagnostics
The extension SHALL report Y603 (warning) for content inside a `:::kanban` container before its first column heading, Y604 (information) on a column heading whose card count is over its `limit`, and Y855 (error) for a database board grouped by a property type that can't be grouped.

#### Scenario: Content before the first column
- **WHEN** a `:::kanban` starts with the paragraph `Sprint goals` before `## Todo`
- **THEN** warning Y603 is reported on that paragraph

#### Scenario: Over the limit
- **WHEN** `## Doing {limit=2}` has three cards
- **THEN** information Y604 is reported on the heading

### Requirement: Board headings are not document headings
Headings inside a `:::kanban` container MUST NOT be counted for heading-level skips (Y704) or multiple H1s (Y705).

#### Scenario: Board in a section
- **WHEN** a board under `#### Planning` uses `## Todo` columns
- **THEN** no Y704 is reported for the column headings
