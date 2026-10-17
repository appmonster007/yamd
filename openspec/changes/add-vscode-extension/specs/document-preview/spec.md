# Spec Delta

## Purpose

Shows the rendered YAMD document next to the source inside VS Code, so authors see the result while they type.

## ADDED Requirements

### Requirement: Opening the preview
The extension SHALL provide the commands "YAMD: Open Preview" and "YAMD: Open Preview to the Side", available from the command palette and the editor title bar for YAMD files.

#### Scenario: Preview to the side
- **WHEN** a `.yamd` file is active and the user runs "YAMD: Open Preview to the Side"
- **THEN** a panel titled `Preview <file name>` opens in the column beside the editor showing the rendered document

#### Scenario: Reusing the panel
- **WHEN** a preview is already open and the user runs the command again for the same file
- **THEN** the existing panel is revealed instead of a new one being created

### Requirement: Live updates
The preview SHALL re-render after edits to its document, within 300 milliseconds of the last keystroke, without waiting for the file to be saved.

#### Scenario: Typing updates the preview
- **WHEN** the user types in the source document
- **THEN** the preview reflects the change without saving

### Requirement: Following the active editor
When the user switches to a different YAMD editor, the preview SHALL switch to that document.

#### Scenario: Switching files
- **WHEN** the preview shows `a.yamd` and the user focuses an editor for `b.yamd`
- **THEN** the preview shows `b.yamd` and its title updates

### Requirement: Scroll sync
The preview SHALL scroll to keep the block at the top of the editor's visible range at the top of the preview.

#### Scenario: Scrolling the editor
- **WHEN** the user scrolls the editor so line 120 is the first visible line
- **THEN** the preview scrolls to the block that starts at or just before line 120

### Requirement: Theme matching
The preview SHALL follow the current VS Code color theme, light or dark.

#### Scenario: Dark theme
- **WHEN** a dark theme is active
- **THEN** the preview uses dark background and foreground colors from the theme

### Requirement: Local resources and security
The preview SHALL load images relative to the document's folder and workspace, SHALL block scripts other than its own, and SHALL make no network requests except for images explicitly referenced by `http` or `https` URLs.

#### Scenario: Relative image
- **WHEN** the document contains `![Logo](img/logo.png)` and the file exists next to it
- **THEN** the image is displayed in the preview

#### Scenario: Missing image
- **WHEN** the referenced image does not exist
- **THEN** the image's alt text is shown in its place

### Requirement: Opening links
Clicking a link in the preview SHALL open web links in the external browser, jump to the target for in-document anchors, and open the target file in an editor for links to other workspace files.

#### Scenario: Anchor link
- **WHEN** the user clicks a link to `#tables`
- **THEN** the preview scrolls to the element with id `tables`

#### Scenario: Link to another YAMD file
- **WHEN** the user clicks a wikilink to `installation`
- **THEN** `installation.yamd` opens in an editor if it exists, and an error message is shown if it does not
