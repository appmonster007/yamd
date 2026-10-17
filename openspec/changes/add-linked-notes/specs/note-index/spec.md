# Spec Delta

## Purpose

Keeps an up-to-date picture of every YAMD note in the workspace, so linking, search, panels and the graph all work from the same data.

## ADDED Requirements

### Requirement: Indexed notes
The extension SHALL index every `.yamd` file in the open workspace folders, except files matched by `files.exclude`, `yamd.index.exclude` or the template folder.

#### Scenario: Notes are found on startup
- **WHEN** a workspace containing `a.yamd` and `notes/b.yamd` is opened
- **THEN** both notes are in the index

#### Scenario: Excluded folders
- **WHEN** `yamd.index.exclude` contains `archive/**`
- **THEN** notes under `archive/` are not indexed

### Requirement: Indexed data per note
For each note the index SHALL record its path, title, aliases, tags, headings with their IDs, block IDs, outgoing links and embeds with their source ranges, task items, and front matter properties.

#### Scenario: Title
- **WHEN** a note has `title: Roadmap` in its front matter
- **THEN** its indexed title is `Roadmap`

#### Scenario: Title fallback
- **WHEN** a note has no `title` but its first heading is `# Q3 Plan`
- **THEN** its indexed title is `Q3 Plan`, and with no heading either, the file name without `.yamd`

#### Scenario: Tags from text and front matter
- **WHEN** a note has `tags: [planning]` in its front matter and `#project/web` in its text
- **THEN** its indexed tags are `planning` and `project/web`

### Requirement: Index freshness
The index SHALL update when a note is edited (unsaved edits included), created, deleted or renamed, within 1 second.

#### Scenario: Unsaved edit
- **WHEN** the user types `#urgent` in an open note without saving
- **THEN** the tag explorer lists `urgent` for that note within 1 second

#### Scenario: Deleted note
- **WHEN** a note is deleted
- **THEN** it disappears from the index, the backlinks panel and the graph

### Requirement: Index performance
Building the index SHALL NOT block the editor, and SHALL handle a workspace of 5,000 notes.

#### Scenario: Large workspace
- **WHEN** a workspace with 5,000 notes is opened
- **THEN** the editor stays responsive while indexing, and a progress indicator is shown until indexing finishes
