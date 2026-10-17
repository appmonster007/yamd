# Spec Delta

## Purpose

Speeds up writing recurring notes: a one-command daily note, and reusable templates with placeholders filled in at insertion time.

## ADDED Requirements

### Requirement: Daily notes
The command "YAMD: Open Today's Daily Note" SHALL open the note for today's date, creating it if needed in `yamd.dailyNotes.folder` (default `daily`) with the file name format `yamd.dailyNotes.format` (default `YYYY-MM-DD`), from the template `yamd.dailyNotes.template` if set.

#### Scenario: Creating today's note
- **WHEN** today is 2026-10-16, `daily/2026-10-16.yamd` does not exist, and the user runs the command
- **THEN** the file is created from the daily template and opened

#### Scenario: Opening an existing note
- **WHEN** `daily/2026-10-16.yamd` already exists
- **THEN** it is opened unchanged

### Requirement: Moving between daily notes
The commands "YAMD: Previous Daily Note" and "YAMD: Next Daily Note" SHALL open the nearest existing daily note before or after the active one.

#### Scenario: Skipping missing days
- **WHEN** the active note is `daily/2026-10-16.yamd` and the previous existing one is `daily/2026-10-13.yamd`
- **THEN** "Previous Daily Note" opens `daily/2026-10-13.yamd`

### Requirement: Templates
The command "YAMD: Insert Template" SHALL list the `.yamd` files in `yamd.templates.folder` (default `templates`) and insert the chosen one at the cursor, with placeholders expanded. If the current note is empty, the template's front matter SHALL become the note's front matter.

#### Scenario: Inserting a template
- **WHEN** the user inserts `templates/meeting.yamd` into an empty note
- **THEN** the note gets the template's content with its placeholders expanded

### Requirement: Template placeholders
`{{@date}}`, `{{@time}}` and `{{@title}}` SHALL expand to the current date, the current time and the note's title. `{{@date:FORMAT}}` SHALL use a format with `YYYY`, `MM`, `DD`, `HH` and `mm` tokens. `{{@cursor}}` SHALL be removed and the cursor placed there.

#### Scenario: Placeholders
- **WHEN** a template contains `# {{@title}}`, `Date: {{@date:DD/MM/YYYY}}` and `{{@cursor}}`, and it is inserted into `standup.yamd` on 2026-10-16
- **THEN** the result is `# standup`, `Date: 16/10/2026`, and the cursor is where `{{@cursor}}` was

#### Scenario: Placeholders are not variables
- **WHEN** a template file contains `{{@date}}`
- **THEN** no Y801 diagnostic is reported, and the preview shows the placeholder as written
