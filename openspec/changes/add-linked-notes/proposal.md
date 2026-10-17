# Proposal

## Why

YAMD handles single documents well, but people who keep notes in Obsidian rely on working across many notes: tags, embedding one note in another, linking to a single paragraph, seeing what links back, and daily notes. Without these, a folder of `.yamd` files is just a pile of files. This change makes a workspace of YAMD notes behave like a connected knowledge base.

## What Changes

- **Format additions** to `yamd-spec.md`:
  - `#tag` and nested `#area/topic` tags in text, plus a `tags:` front matter key.
  - Embeds: `![[note]]`, `![[note#Heading]]`, `![[note#^block-id]]` and `![[image.png]]`.
  - Block IDs: ` ^block-id` at the end of a paragraph or list item, linkable with `[[note#^block-id]]`.
  - `aliases:` front matter key; wikilinks resolve by file name or alias anywhere in the workspace.
  - Template placeholders `{{@date}}`, `{{@time}}`, `{{@title}}` and `{{@cursor}}`, expanded only when a template is inserted.
  - **BREAKING**: `#word` at the start of a line is now a tag. Diagnostic Y301 now only applies to `##word` through `######word`.
- **Workspace index** of every `.yamd` file's title, aliases, tags, headings, block IDs and links, kept current as files change.
- **Navigation**: completion for `[[`, `![[` and `#`; Go to Definition and clickable links; a quick switcher that searches titles and aliases and can create missing notes; heading outline in the Outline view; link updates when files are renamed.
- **Sidebar panels**: backlinks (linked and unlinked mentions), a tag explorer, and a front matter properties editor.
- **Graph view** of notes and the links between them.
- **Daily notes and templates**: open or create today's note from a template, and insert any template into the current note.
- **Interactive preview, first step**: clicking a task checkbox in the preview updates the source file, as an undoable edit.
- **Preview rendering** of embeds (resolved, with cycle protection), tags and block anchors. `::include` is now resolved too.

## Capabilities

### New Capabilities
- `note-index`: discovering YAMD notes in the workspace and keeping titles, aliases, tags, headings, block IDs and links up to date.
- `note-linking`: resolving wikilinks, embeds and block references; completion, navigation and link updates on rename.
- `note-panels`: the backlinks panel, tag explorer, properties panel, outline and graph view.
- `daily-notes-and-templates`: daily note creation and template insertion with placeholders.
- `interactive-preview`: how the preview sends edits back to the source document, starting with task checkboxes.

### Modified Capabilities
- `yamd-rendering`: renders tags, block anchors and resolved embeds and includes.
- `document-diagnostics`: Y301 narrows to multi-`#` cases; adds diagnostics for unresolved embeds and block references, circular embeds (Y602) and duplicate block IDs.

## Impact

- `yamd-spec.md`: new sections for tags, embeds, block IDs, aliases, templates, and the Y301 change. The examples in `examples/03-notes/` already use these features.
- `vscode-yamd/`: new `src/core` modules (tags, embeds, block IDs, resolution), a new `src/workspace/` index, new tree views and webviews, new commands and settings.
- Depends on `add-vscode-extension`, which should be archived first so the modified capabilities exist as main specs.
- New dev dependency `d3-force` for the graph layout, bundled so no network is needed.
