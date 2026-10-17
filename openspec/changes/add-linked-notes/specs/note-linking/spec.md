# Spec Delta

## Purpose

Connects notes to each other: resolving wikilinks, embeds and block references, and helping authors write, follow and keep those links valid.

## ADDED Requirements

### Requirement: Wikilink resolution
A wikilink target SHALL resolve in this order: a path relative to the current note, a path from the workspace root, a note whose file name matches anywhere in the workspace, then a note whose `aliases` contain the target. Matching on file names and aliases MUST ignore case.

#### Scenario: Link by file name
- **WHEN** a note links to `[[roadmap]]` and the only matching file is `projects/2026/roadmap.yamd`
- **THEN** the link opens `projects/2026/roadmap.yamd`

#### Scenario: Link by alias
- **WHEN** `q3.yamd` has `aliases: [Q3 Plan]` and another note links to `[[q3 plan]]`
- **THEN** the link resolves to `q3.yamd`

#### Scenario: Ambiguous name
- **WHEN** both `a/notes.yamd` and `b/notes.yamd` exist and a note in the root links to `[[notes]]`
- **THEN** the link resolves to the file with the shorter path, and warning Y709 lists both candidates

### Requirement: Embeds
`![[target]]` SHALL embed the whole target note, `![[target#Heading]]` the section under that heading, and `![[target#^id]]` the block with that ID. `![[file.png]]` and other image files SHALL embed the image. Attributes such as `{width=300}` MAY follow.

#### Scenario: Embed a section
- **WHEN** a note contains `![[guide#Install]]`
- **THEN** the preview shows the `Install` heading of `guide.yamd` and its content up to the next heading of the same or higher level

#### Scenario: Embed an image
- **WHEN** a note contains `![[diagram.png]]{width=300}`
- **THEN** the preview shows the image 300 pixels wide

### Requirement: Block references
A paragraph or list item whose last line ends with a space followed by `^id` (letters, digits and `-`) SHALL get that block ID. `[[note#^id]]` SHALL link to the block and `![[note#^id]]` SHALL embed it.

#### Scenario: Linking to a block
- **WHEN** `ideas.yamd` has a paragraph ending in ` ^pricing` and another note links `[[ideas#^pricing]]`
- **THEN** following the link opens `ideas.yamd` at that paragraph

#### Scenario: The ID is hidden
- **WHEN** a paragraph ends with ` ^pricing`
- **THEN** the preview does not show `^pricing` in the paragraph text

### Requirement: Link completion
Typing `[[`, `![[` or `#` at the start of a tag SHALL offer completions: note titles, aliases and paths for links and embeds; headings after `#` and block IDs after `#^` inside a link; and existing tags for `#`.

#### Scenario: Completing a heading
- **WHEN** the user types `[[guide#`
- **THEN** the headings of `guide.yamd` are offered

#### Scenario: Completing a tag
- **WHEN** the user types `#pro` in text
- **THEN** existing tags starting with `pro`, such as `project/web`, are offered

### Requirement: Link navigation
Wikilinks, embeds, relative links and block references SHALL be clickable in the editor, and Go to Definition SHALL open their target at the right line.

#### Scenario: Go to Definition on a heading link
- **WHEN** the user runs Go to Definition on `[[guide#Install]]`
- **THEN** `guide.yamd` opens with the cursor on the `Install` heading

### Requirement: Creating notes from links
Following a link to a note that does not exist SHALL offer to create it, in the linking note's folder, with the link text as its title.

#### Scenario: Create from a link
- **WHEN** the user follows `[[Meeting Notes]]` and no such note exists, then accepts the offer
- **THEN** `Meeting Notes.yamd` is created next to the current note with `title: Meeting Notes` in its front matter, and opened

### Requirement: Link updates on rename
When a note or image is renamed or moved inside VS Code, links and embeds that point to it SHALL be updated in all notes, as one undoable edit. Links by file name or alias that still resolve to the same note SHALL be left unchanged.

#### Scenario: Moving a note
- **WHEN** `guide.yamd` is moved to `docs/guide.yamd` and another note links `[guide](guide.yamd#install)`
- **THEN** that link becomes `[guide](docs/guide.yamd#install)`

#### Scenario: Name-based links stay
- **WHEN** a note links `[[guide]]` and `guide.yamd` is moved to `docs/guide.yamd`
- **THEN** the link is unchanged and still resolves

### Requirement: Quick switcher
The command "YAMD: Quick Switcher" SHALL search notes by title, alias and path with fuzzy matching, open the selected note, and offer to create a note when nothing matches.

#### Scenario: Opening by alias
- **WHEN** the user opens the quick switcher and types `q3 pl`
- **THEN** the note with the alias `Q3 Plan` is listed and opens when selected
