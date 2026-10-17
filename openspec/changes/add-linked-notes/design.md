# Design

## Context

The extension from `add-vscode-extension` parses one document at a time. `src/core` (parser, renderer, linter) has no VS Code dependency, and the preview is a single webview that receives rendered HTML. Nothing yet looks across files apart from `fileExists` checks. See proposal.md for motivation, and the delta specs for requirements.

## Goals / Non-Goals

**Goals:**
- One workspace index that every cross-note feature reads from.
- Keep `src/core` free of `vscode` imports: resolution logic depends on a small lookup interface that the index implements, so it can be tested with in-memory fixtures.
- Make every preview interaction an edit to the source, so undo, git and other editors keep working.

**Non-Goals:**
- Syncing with Obsidian vaults or reading `.md` files.
- Real-time collaboration.
- Persisting the index to disk. It is rebuilt on startup; disk caching can come later if startup is slow.

## Decisions

### 1. Parser additions in `src/core`
- New inline nodes: `tag` (`{ name }`) and `embed` (`{ target, heading?, blockId?, attrs }`).
- An embed alone on its line becomes a block-level `embed` block, so whole sections can be rendered in place.
- Block IDs are detected while building paragraphs and list items: a final ` ^id` on the last line is removed from the inline content and stored as `blockId` on the block.
- Tags follow the rule in the `yamd-rendering` delta. The check that `#` follows start of line, whitespace or `(` makes `C#`, `x/#y` and URL fragments not tags without special cases.
- Template placeholders `{{@...}}` don't match the variable pattern (which needs a letter or `_`), so they stay literal text and produce no Y801.

*Alternative considered:* treating tags as a post-processing pass over text nodes. Rejected because it would also see text inside link labels as tags, and because the block parser must know about tags to stop treating `#tag` lines as candidates for Y301.

### 2. Resolution through a `NoteLookup` interface
```ts
interface NoteLookup {
  resolve(target: string, fromPath: string): { path: string; candidates: string[] } | null;
  read(path: string): string | undefined;   // current text, including unsaved edits
}
```
`src/core/resolve.ts` implements the wikilink resolution order, section extraction for `#Heading` (up to the next heading of the same or higher level) and block extraction for `#^id`, using the lookup only for file access. The renderer takes an optional `resolveEmbed` built on it and tracks the embed stack for the depth and cycle rules. Tests use an in-memory lookup.

### 3. Workspace index in `src/workspace/`
- On activation, `workspace.findFiles('**/*.yamd', excludes)` lists the notes. They are parsed in batches of 50, yielding with `setImmediate` between batches so the extension host stays responsive. Progress is shown with `window.withProgress` in the status bar.
- Each note is stored as a summary, not a full tree: path, title, aliases, tags, headings (text, id, line), block IDs (id, line), links and embeds (target, range, resolved path), tasks and front matter. This keeps memory to a few KB per note.
- Updates come from a `FileSystemWatcher` (create, delete, change on disk) and `onDidChangeTextDocument` (unsaved edits, debounced by 300 ms). Renames come through `onDidRenameFiles`.
- A reverse map `target path → [source note, range]` serves backlinks in constant time. It is rebuilt for a note whenever that note's links change.
- Files over 2 MB are skipped, with a log message in the YAMD output channel.

### 4. Link updates on rename
`workspace.onWillRenameFiles` returns a `WorkspaceEdit` (through `event.waitUntil`) that rewrites path-based links (`[x](path)`, `[[path/to/note]]`, `![[path]]`) whose resolved target is the renamed file. Name-based and alias-based links are only rewritten if they would stop resolving, or would resolve to a different note, after the rename. VS Code applies the edit together with the rename, so one undo reverts both.

### 5. Editor features
- `CompletionItemProvider` triggered by `[`, `#` and `^`. It reads the index for titles, aliases, headings, block IDs and tags.
- `DocumentLinkProvider` and `DefinitionProvider` share one function that finds the link under a position and resolves it.
- `DocumentSymbolProvider` for headings, which feeds the Outline view and breadcrumbs.
- The quick switcher is a `QuickPick` over the index, using VS Code's built-in fuzzy matching on `label` and `description` (aliases and path).

### 6. Panels
- Backlinks and Tags are `TreeDataProvider`s in a new `yamd` view container.
- Unlinked mentions are computed only while the Backlinks view is visible. The search scans indexed note text for the title and aliases at word boundaries, skipping code, links and front matter, and is capped at 200 results.
- The Properties view is a `WebviewView` with a small form. Edits use the `yaml` package's `parseDocument` with `setIn` and `deleteIn`, then `toString()`, which keeps comments and key order. The result replaces only the front matter range, as one undoable edit.

### 7. Graph view
A `WebviewPanel` draws on a `<canvas>`, with layout from `d3-force` bundled into `dist/graph.js`. The extension sends nodes and edges from the index. Local mode does a breadth-first walk to the chosen depth in the extension, so the webview only gets the subgraph. Above 2,000 nodes, the layout runs for a fixed number of ticks and then stops, to keep the CPU quiet. The CSP is the same as the preview's, with no network origins.
*Alternative considered:* an SVG with a hand-written layout. Rejected because SVG gets slow above a few hundred nodes, and d3-force is small (about 15 KB) with no dependencies.

### 8. Interactive preview protocol
- The renderer adds `data-line` (already present) and, inside embeds, `data-source="<uri>"` so edits target the right file.
- The webview sends `{ type: 'edit', uri, line, expect, replace }`. The extension checks that the line's current text equals `expect`, applies a `WorkspaceEdit` for that line only, and the normal change listener re-renders the preview.
- A mismatch drops the edit and forces a re-render.
- Edits are refused (and the controls rendered disabled) when `workspace.isTrusted` is false or the document's file system is read-only.
- Later changes (databases, kanban) add message types to the same protocol.

### 9. Daily notes and templates
A small date formatter supports `YYYY`, `MM`, `DD`, `HH` and `mm` tokens, so no date library is needed. Template insertion uses a `SnippetString`, with the text before and after `{{@cursor}}` escaped and a `$0` tab stop at the cursor, so it is one edit with the cursor placed correctly.

## Risks / Trade-offs

- [Tags change how `#word` lines behave (BREAKING)] → The spec and sample are updated in the same change, and Y301 still catches `##word`, which is the common typo for a heading.
- [The index uses memory in very large vaults] → Summaries only, a size cap per file, and the `yamd.index.exclude` setting.
- [Name-based links become ambiguous as a workspace grows] → Y709 warns, the shortest path wins predictably, and completion inserts the shortest unique path.
- [Unlinked mention search is slow on big workspaces] → It runs only while the view is visible, is capped, and is cancelled when the active note changes.
- [The preview writes to files] → The expected-text check, line-scoped edits, normal undo, and disabled controls in untrusted workspaces.

## Migration Plan

1. Archive `add-vscode-extension` so `yamd-rendering` and `document-diagnostics` exist as main specs. This change modifies them.
2. Update `yamd-spec.md`: tags, embeds, block IDs, aliases, wikilink resolution order, template placeholders, Y301, Y602, Y708 and Y709.
3. Remove the "Planned feature" callouts from `examples/03-notes/`, which already use every feature in this change.
4. Rollback is uninstalling or reverting the extension. No data formats change on disk apart from the authors' own notes.

## Open Questions

- Default for unlinked mention matching: whole title only, or also each alias. The plan is to match both; this can be tuned without changing the specs.
