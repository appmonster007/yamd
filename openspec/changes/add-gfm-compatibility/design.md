# Design

## Context

`src/core` today is a hand-written parser built around YAMD's original rules: a newline is a break, `_` means nothing, HTML is literal, and lists use relative nesting. It doesn't implement CommonMark's block algorithm (HTML block types, lazy continuation, indented code, list item rules) or its delimiter-run algorithm for emphasis. Getting it to pass about 650 CommonMark examples would mean re-deriving the reference implementation. See proposal.md for motivation, and the delta specs for requirements.

The three planned changes (`add-linked-notes`, `add-databases`, `add-kanban-boards`) all need exact source positions for inline nodes, for completion, go-to-definition, link rewrites on rename, and line-scoped edits.

## Goals / Non-Goals

**Goals:**
- Pass the CommonMark and GFM test suites, except for a short, justified list.
- Keep exact source positions on every node, block and inline.
- Keep `src/core` free of `vscode`, synchronous, and runnable in Node and in a webview.
- Keep the deliberate YAMD differences few and machine-detectable, so migration can fix them.

**Non-Goals:**
- Matching GitHub's HTML byte for byte (heading anchors, class names). Conformance is checked after normalization.
- Supporting other Markdown flavors (MultiMarkdown, Pandoc-specific syntax) beyond what YAMD already defines.

## Decisions

### 1. Rebuild the core on micromark and mdast
The parser becomes `micromark` (a CommonMark-compliant state-machine tokenizer) with `mdast-util-from-markdown` building an `mdast` tree with positions on every node.
- **GFM**: `micromark-extension-gfm` with its defaults, so `~text~` is strikethrough as on GitHub.
- **Existing extensions**: front matter (`micromark-extension-frontmatter`), directives (`micromark-extension-directive`, whose `:::name`, `::name[label]{attrs}` and `:name[content]{attrs}` syntax is the same as YAMD's), and math (`micromark-extension-math`).
- **New YAMD extensions**, as one micromark syntax extension (`src/core/micromark/syntax.ts`) plus one mdast-util extension (`src/core/micromark/mdast.ts`):
  - `mark` (`==`) and `ins` (`++`), using one shared factory that copies the GFM strikethrough tokenizer's attention/delimiter logic, so they follow CommonMark delimiter rules.
  - `script`: `^{...}` and `_{...}` after a non-space character, with balanced braces, and the digit shortcut `^2`, `^-3`. This is a simple bracket tokenizer, not a delimiter run, because the braces mark both ends. `_{` can't open GFM emphasis after a letter, so it doesn't conflict.
  - `attributes`: `{...}` after inline elements, at the end of headings and cells, and on their own line before blocks.
  - `variable` (`{{ path }}`), inline `comment` (`%% %%`), `critic` (the five review forms), `citation` (`[@...]`), `wikilink` (`[[...]]`), `tag`, `embed`, `block-id`, inline footnotes, text directives and YAMD's `$` math rule.
  - The stock directive and math extensions are used only for their flow (block) constructs: their text constructs match `10:30` and `$5 and $10`.
- **Line preprocessing** (offset-preserving, before micromark): block `%%` comments become blank lines, and `{attrs}` on directive lines are blanked and parsed with YAMD's attribute rules. A multi-line custom flow construct for comments sent micromark's `subtokenize` into an endless loop, and line blanking is simpler and keeps every offset.
- **Newline is a break**: the adapter turns every soft line break inside text into a `break` node marked `soft`, with an exact source range. The renderer outputs `<br>` for it (or a newline in conformance mode). This is the same approach as `remark-breaks`, so the parser stays standard.

*Alternatives considered:*
- **Fixing the hand-written parser.** This means re-implementing CommonMark's block and inline algorithms by hand. It has the highest risk, and duplicates a solved problem.
- **markdown-it.** It is CommonMark-compliant with many plugins (mark, ins, sub, sup, attrs, container) and `breaks: true` built in. However, it doesn't track inline source positions, which the linter and the three planned changes depend on. Adding positions would mean patching every inline rule.
- **Porting commonmark.js.** It has positions, but YAMD would own the whole fork.

micromark is the only option that gives conformance and full positions without owning a CommonMark implementation. The cost is that YAMD extensions must be written as micromark state machines, which is harder than markdown-it rules. This is accepted, with one shared emphasis factory covering two of the extensions.

### 2. An adapter to YAMD's types, and a tag-level sanitizer
*Revised during implementation.* The mdast tree is converted into the existing YAMD `Block` and `InlineNode` types (with positions), so the renderer, linter, editing commands and the planned changes keep one document model. The renderer stays string-based and gains GFM output (tight and loose lists, table `align`, `<del>`, URL normalization).

Raw HTML (blocks and inline tags) goes through `src/core/sanitize.ts`, which rebuilds every tag from GitHub's allow-list (taken from `hast-util-sanitize`'s default schema): disallowed tags are dropped, `script`, `style`, `iframe` and similar are dropped with their content, only allowed attributes are kept, URL attributes are checked after decoding character references, and `id`/`name` get the `user-content-` prefix. Building it on hast would have meant parsing every HTML fragment with parse5 and converting the whole document to hast for little gain, because YAMD's own output is generated, not parsed.
- `data-line` comes from the block's start line on every block element.

### 3. Linter on the adapted tree
The rules keep their codes and messages. They walk the adapted YAMD tree, whose ranges come from mdast offsets. GFM leaves undefined `[text][label]` and `[^id]` as text, so Y701 scans text nodes for them.
- Line-based rules (Y101, Y201, Y301, Y401) still scan raw lines, using a verbatim mask built from the positions of `code`, `math`, `yaml`, `html` and comment nodes.
- Y401 keeps its code, but its message changes: lazy lines now continue the quote, as in GFM, so the warning suggests adding `>` for clarity rather than saying the quote ends.
- New rules: Y210 (hard-wrapped paragraph heuristic from the `markdown-migration` spec) and Y212 (a bullet list directly followed by a list with a different marker, found from adjacent `list` nodes with no blank-line-separated content between them).

### 4. Conformance tests
- `test/conformance.test.ts` loads `commonmark-spec` (CommonMark 0.31.2, about 650 examples) and a vendored `test/fixtures/gfm-extensions.json`, extracted once from `cmark-gfm`'s `test/spec.txt` (tables, task lists, strikethrough, autolinks, disallowed raw HTML, footnotes).
- Each example is rendered and normalized: YAMD attributes are removed, tags are lower-cased, self-closing style is unified, whitespace between tags is collapsed, and attributes are sorted. The result is then compared with the expected HTML.
- `test/fixtures/known-differences.json` maps an example number to its reason. The test fails on any unlisted failure and on any listed example that now passes, and prints the pass rate per suite.
- **Expected categories**:
  - `yamd-syntax`: `#hashtag` tags, `---` front matter on line 1, `[[` wikilinks.
  - `sanitized-html`: link schemes outside YAMD's URL allow-list (`irc:`, custom schemes).
  - `gfm-extension`: CommonMark examples where GFM's extended autolinks apply.
  - `newline-is-break`: unused; see below.

  *Revised during implementation:* the examples render in a conformance mode (`softBreaks: 'newline'`, `rawHtml: 'trust'`), so the suite tests parsing rather than YAMD's two deliberate output choices, which have their own tests. Result: CommonMark 637/652 (97.7%), GFM extensions 20/21.

### 5. Migration converter
`src/core/convert.ts` is a pure function `convertFromMarkdown(source): { text, escaped, joined }`:
- *Revised during implementation:* instead of guessing which character sequences YAMD would claim, it runs YAMD's micromark tokenizer and escapes the first character of every YAMD-only token (`yamdSyntaxOffsets`). Escaping one construct can reveal another (`{{x}}` → `\{{x}}` leaves `{x}`), so it repeats until no YAMD-only token is left. Only syntax YAMD would actually read differently is escaped; `a == b` and `$5 and $10` stay as written. `$` math is not escaped, because GitHub renders it too.
- It then joins every soft line break inside paragraphs and headings, using the exact break ranges from the parser.

The round-trip test converts each CommonMark example and checks that YAMD's default rendering of it matches the spec's HTML (whitespace outside `<pre>` collapsed).

### 6. Performance
micromark is slower than the current parser, at roughly 1–2 MB/s. That is fine for documents (the preview is debounced). The workspace index (planned) parses notes in batches anyway. Benchmark: `examples/getting-started.yamd` × 100 must parse in under 1 second in the test suite.

## Risks / Trade-offs

- [YAMD micromark extensions are hard to write correctly] → One shared emphasis factory, unit tests per extension, and the conformance suite as a guard against extensions breaking GFM behavior.
- [The `newline-is-break` difference is large: every hard-wrapped Markdown file looks different] → Y210 with a quick fix, the converter, and a prominent entry in "Differences from GFM". The proposal records this as a deliberate trade-off.
- [Rendering raw HTML widens the attack surface compared with literal HTML] → The sanitizer uses GitHub's allow-list, URLs are checked after sanitizing, the webview CSP still blocks scripts, and the security tests (`<script>`, `onerror`, `javascript:`, `<iframe>`, `<style>`) run on every change.
- [Bundle size grows by about 130 KB minified (micromark, mdast, character entities)] → Acceptable for an offline extension. Tree-shaken by esbuild.
- [Rewriting the core invalidates parts of the existing tests] → Behavior tests are kept and updated where GFM behavior was adopted (underscores, HTML, numbered list starts). Each changed assertion is listed in the task that changes it.

## Migration Plan

1. Land this change before `add-linked-notes`, `add-databases` and `add-kanban-boards`. Their parsing tasks then target micromark extensions in `src/core/micromark/`.
2. Update `yamd-spec.md` (§0, §3, §4, §9, a new §13 "Differences from GFM", and §14), update the examples, and add `examples/06-markdown/`.
3. Users' existing `.yamd` files mostly keep working. Files that relied on literal HTML, literal `_` or list starts at 1 render differently. The examples and the diagnostics example are updated in this change.
4. Rollback means reinstalling the previous `.vsix`. No file formats change on disk.

## Open Questions

- Resolved: GFM extension examples are vendored from `cmark-gfm` 0.29.0.gfm.13, recorded in the fixture.
