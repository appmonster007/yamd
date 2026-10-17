# Spec Delta

## Purpose

Gives authors views of the knowledge base around the current note: what links to it, its tags and properties, its structure, and how all notes connect.

## ADDED Requirements

### Requirement: YAMD sidebar
The extension SHALL add a YAMD view container to the activity bar holding the Backlinks, Tags and Properties views.

#### Scenario: Opening the sidebar
- **WHEN** the user clicks the YAMD icon in the activity bar
- **THEN** the Backlinks, Tags and Properties views are shown

### Requirement: Backlinks panel
The Backlinks view SHALL list, for the active note, every note that links to it or embeds it (linked mentions) with the line containing each link. It SHALL also list notes that mention its title or an alias as plain text (unlinked mentions).

#### Scenario: Linked mention
- **WHEN** `a.yamd` contains `[[roadmap]]` and `roadmap.yamd` is active
- **THEN** the Backlinks view lists `a.yamd` with that line, and clicking it opens `a.yamd` at the link

#### Scenario: Unlinked mention
- **WHEN** `b.yamd` contains the words `Roadmap` without a link and `roadmap.yamd` is active
- **THEN** `b.yamd` appears under unlinked mentions, with an action that turns the mention into `[[roadmap]]`

### Requirement: Tag explorer
The Tags view SHALL show all tags as a tree, with nested tags under their parents and a note count on each. Selecting a tag SHALL list the notes that have it, including notes with its nested tags.

#### Scenario: Nested tags
- **WHEN** notes use `#project/web` and `#project/mobile`
- **THEN** the Tags view shows `project` with `web` and `mobile` under it, and selecting `project` lists notes with either tag

### Requirement: Properties panel
The Properties view SHALL show the active note's front matter as editable fields, typed as text, number, checkbox, date or list from the current values. Editing a field SHALL update the front matter as an undoable edit, keeping other keys and comments unchanged.

#### Scenario: Editing a property
- **WHEN** the user changes `status` from `draft` to `published` in the Properties view
- **THEN** the front matter line `status: draft` becomes `status: published`, and Undo restores it

#### Scenario: Adding a property
- **WHEN** the user adds a property `due` with the date 2026-11-01
- **THEN** `due: 2026-11-01` is added to the front matter, which is created if the note has none

### Requirement: Outline
The extension SHALL provide document symbols for headings, nested by level, so the built-in Outline view and breadcrumbs show the note's structure.

#### Scenario: Outline view
- **WHEN** a note has `## Setup` and `### Install` under it
- **THEN** the Outline view shows `Install` nested under `Setup`

### Requirement: Graph view
The command "YAMD: Open Graph View" SHALL open a panel drawing notes as nodes and links and embeds as edges. It SHALL support a whole-workspace mode and a local mode (the active note plus notes within a chosen number of link steps), filtering by tag or path, zoom and pan, and opening a note by clicking its node.

#### Scenario: Local graph
- **WHEN** the active note links to `b.yamd`, which links to `c.yamd`, and the local graph depth is 1
- **THEN** the graph shows the active note and `b.yamd`, but not `c.yamd`

#### Scenario: Opening a note from the graph
- **WHEN** the user clicks the node for `b.yamd`
- **THEN** `b.yamd` opens in the editor

#### Scenario: Missing notes
- **WHEN** a note links to `[[ideas]]` and no such note exists
- **THEN** the graph shows `ideas` as a hollow node, distinct from existing notes

### Requirement: Graph works offline
The graph view MUST NOT load any resource from the network.

#### Scenario: No network
- **WHEN** the graph view is open with networking disabled
- **THEN** it renders fully
