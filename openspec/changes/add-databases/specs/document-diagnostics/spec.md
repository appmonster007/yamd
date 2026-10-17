# Spec Delta

## ADDED Requirements

### Requirement: Database and query diagnostics
The extension SHALL report these codes in documents and `.ydb` files: Y850 unknown database or alias (error), Y851 SQL error in a view or query (error), Y852 invalid `.ydb` structure (error), Y853 value doesn't match its property (error for type, warning for unknown option), Y854 duplicate row `id` (error), Y950 query refused as unsafe (error), Y951 database outside the document's scope (error), and Y952 query timed out (warning).

#### Scenario: Diagnostic on a query block
- **WHEN** a `query` block has a syntax error
- **THEN** error Y851 with SQLite's message is reported on the block's first line

#### Scenario: Out-of-scope database
- **WHEN** the front matter maps an alias to `../shared/tasks.ydb`
- **THEN** error Y951 is reported on that front matter line
