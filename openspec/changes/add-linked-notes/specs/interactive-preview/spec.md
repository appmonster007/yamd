# Spec Delta

## Purpose

Lets authors act directly on the rendered preview while the YAMD source stays the single source of truth.

## ADDED Requirements

### Requirement: Edits go through the source
Every change made in the preview SHALL be applied as an edit to the source document, as one undoable step, and the preview SHALL then re-render from the source. The preview MUST NOT keep any state that the source does not have.

#### Scenario: Undo
- **WHEN** the user changes something in the preview and then runs Undo in the source editor
- **THEN** the source and the preview both return to the previous state

### Requirement: Stale edits are rejected
An edit from the preview SHALL identify its target by source line and expected text. If the source has changed so the target no longer matches, the edit SHALL be dropped and the preview re-rendered.

#### Scenario: Concurrent typing
- **WHEN** the user ticks a checkbox in the preview while the line was just edited in the source
- **THEN** no edit is applied to the wrong line, and the preview shows the current source

### Requirement: Task checkboxes
Clicking a task checkbox in the preview SHALL toggle `[ ]` and `[x]` on that item in the source, including tasks inside embeds, which SHALL update the embedded note.

#### Scenario: Ticking a task
- **WHEN** the user clicks the checkbox of `- [ ] Ship it` in the preview
- **THEN** the source line becomes `- [x] Ship it`

#### Scenario: Task in an embedded note
- **WHEN** the user ticks a task that comes from `![[todo]]`
- **THEN** `todo.yamd` is updated, not the note that embeds it

### Requirement: Read-only sources
The preview MUST NOT allow edits to documents that are read-only in VS Code, or when the workspace is not trusted.

#### Scenario: Untrusted workspace
- **WHEN** the workspace is in Restricted Mode
- **THEN** checkboxes in the preview are disabled
