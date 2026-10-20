# Design

## Context

See `proposal.md` - Why. Relevant existing mechanics this design builds on:

- Inline `span` nodes (`core/types.ts`) already carry an `Attrs` object with a free-form `values: Record<string, string | boolean>` map, populated by `core/attrs.ts`'s `parseAttrs`. No AST change is needed to carry a new `key=value` attribute through parsing — `core/parser.ts`/`core/inline.ts` already pass any such attrs onto the `span` node untouched.
- `core/attrs.ts`'s `parseAttrBlock` and `splitTrailingAttrs` both reject an attribute body whose text starts with `+`, `-`, `~`, `=` or `>` (`/^[+\-~=>]/`), reserved for CriticMarkup-style review markup (spec §7). This rules out a bare `->target-id` token as the leading (or only) content of an attribute list.
- `core/lint.ts` already collects every resolvable `id` in the document into `this.ids` (`collectIds()`), and checks reference-like inline nodes against it in a `visit` callback used by `walkInline`, e.g. `case 'crossRef': if (!this.ids.has(n.id)) this.report('Y701', ...)`. `span` nodes already reach this callback (there's already a `case 'span':` in the recursion switch in `walkInline`, used to recurse into children); it has no target-resolution check today.
- The VS Code preview webview (`src/preview/main.ts`) re-renders by diffing and replacing only the top-level blocks that changed in `#root` (`update()`), to preserve scroll position, open `<details>`, etc. A DOM node added once as a sibling of `#root` (e.g. in `webviewShell.ts`'s body) survives these partial re-renders untouched.
- The only existing connector/arrow-drawing code in the repo is `src/graph/main.ts`, a `<canvas>` + d3-force force-directed graph for the separate backlinks/graph view. It draws arrowheads for a physics-simulated node-link diagram, not for arbitrary DOM elements, so it isn't directly reusable, but its arrowhead trigonometry is a useful reference.

## Goals / Non-Goals

**Goals:**
- Let an author mark an existing inline span as pointing at any element that already has a resolvable `id` in the same document.
- Make the relationship inspectable in plain HTML output (data attributes) even where no visual connector is drawn.
- Draw a visible connector with an arrowhead in the interactive VS Code preview — a right-angled `wire` by default, a direct `curve` on request — kept in sync with scrolling/resizing/re-rendering.

**Non-Goals:**
- Cross-document arrows (target in another note/embed). Out of scope for this change; `target-id` resolves only within the current document's own `this.ids`.
- Arrows in static/exported HTML (no preview script) drawing a visual line — the data attributes are preserved, but drawing is explicitly the live preview's job only (see spec's "hidden from non-visual output" requirement).
- Any UI for drawing arrows by mouse/drag — this change is source-syntax + rendering only, not an editing gesture.
- Changing `core/attrs.ts`'s grammar (e.g. permitting `-` as a leading attribute character) — out of scope; works within the existing grammar instead.
- Flow charts and other diagrams. A `:::arrows` directive and a `::node`/`shape=` mechanism were both tried, specifically to let this capability also draw flow charts, and both were removed (see `tasks.md` groups 8–20 for that history) — routing box-to-box edges, vertical chains and same-row hops correctly turned out to need enough special-case logic that it kept producing new visual bugs with each fix. Flow charts belong in a standard ` ```mermaid ` code block instead, a separate, already-existing mechanism. This design covers only prose annotation: one span of text pointing at another labeled element.

## Decisions

**Attribute spelling: `arrow=target-id`, not `->target-id`.**
A bare `->id` token was the first idea (it reads like an arrow), but `parseAttrBlock`/`splitTrailingAttrs` reject any attribute body starting with `-`, since that prefix is reserved for CriticMarkup review markup. Changing that guard would risk ambiguity with review syntax and widen the blast radius of this change into the core attribute grammar. Using an ordinary `key=value` pair (already fully supported by the `TOKEN` regex in `attrs.ts`) needs zero grammar changes, is consistent with how every other per-element setting works (`width=300`, `align=center`, etc.), and degrades gracefully: per spec §5, "Renderers must ignore keys they don't recognize," so a renderer that hasn't implemented arrows yet silently ignores `arrow=...` instead of failing to parse the span at all.

**No new AST node type for "arrow source."**
Because `span.attrs.values['arrow']` already holds the target id once parsing is done, `core/render.ts` and `core/lint.ts` can read it directly off the existing `span` node. Introducing a dedicated `arrowSource` node type (or a typed field on `Attrs`) would duplicate what a generic attribute already stores and would require changes in `parser.ts`/`inline.ts`/`types.ts` for no behavioral gain.

**Target resolution reuses `this.ids`, the same set used for `crossRef`.**
Arrow targets are deliberately defined (spec: "Arrow targets reuse existing anchor mechanisms") to be exactly the ids already in `this.ids` — block IDs, heading/attribute ids, cross-reference labels — so `core/lint.ts` only needs one more `case` in the existing `visit` switch (next to `crossRef`/`footnoteRef`) rather than a new resolution pass.

**Diagnostic reuses `Y701` instead of a new code.**
`Y701` is already documented as "Missing link, image, anchor, reference or footnote target" and is used for structurally identical checks (`crossRef`, footnote refs, wikilink targets). An arrow with an unresolved target is the same category of problem, so extending `Y701`'s wording rather than minting a new `Y7xx` code avoids spec churn and keeps the diagnostics table from accumulating near-duplicate codes.

**Preview overlay: a single absolutely-positioned SVG layer, not canvas, not per-arrow elements injected into the content flow.**
- SVG over canvas: arrows are sparse (a handful per document, not thousands of simulated nodes), need to look crisp at any zoom/DPI, and benefit from CSS theming (light/dark) the way the rest of the preview's HTML does — all easier with SVG `<path>` elements than imperative canvas redraws. `graph/main.ts`'s canvas choice was for a physics simulation repainting every frame; arrows here only need to repaint on discrete events (render/resize/scroll), where SVG's retained-mode DOM is simpler and cheaper.
- A single overlay `<svg>` sibling of `#root` (added once in `webviewShell.ts`'s body, sized to cover the scrollable content, pointer-events: none) is added so it is never touched by `update()`'s partial block-replacement of `#root`, and so z-ordering is trivial (always on top, never intercepting clicks/selection).
- Arrow geometry is computed in `preview/main.ts` by querying `[data-yamd-arrow-to]` source elements and resolving each target by `id`, using `getBoundingClientRect()` on both (consistent with how `scrollToLine` already measures `getBoundingClientRect()` for layout-dependent positioning), then recomputed: after every `update()` call, on a `ResizeObserver` on `root`, and on the window's `scroll`/`resize` events (throttled with `requestAnimationFrame`, following the existing `syncing`/`requestAnimationFrame` pattern used for scroll-sync).

## Risks / Trade-offs

- **Many/overlapping arrows could clutter dense notes.** → Out of scope to prevent in markup (that's an authoring choice), but the design keeps arrows visually subtle (thin curved path, modest arrowhead) and purely additive to existing content, so a document with no arrows is visually unaffected.
- **Elements can be off-screen or not yet rendered (e.g. inside a collapsed `<details>` or an unrendered embed).** → Per spec, if a target isn't resolvable/visible in the rendered DOM, no connector is drawn for that arrow (fails closed, not with a broken/garbage line); recomputation on each relevant event means a connector appears once both ends do become visible (e.g. after expanding a `<details>`, if that's wired to trigger a recompute — see Open Questions).
- **Performance of recomputing on scroll.** → Mitigated by `requestAnimationFrame` throttling, same technique already used for scroll-sync; arrow count per document is expected to be small.
- **`arrow=target-id` collides with a future unrelated use of the word "arrow" as a key.** → Accepted risk, consistent with how other single-purpose keys (`width`, `align`, `limit`) are already chosen without namespacing; spec §5 already states unrecognized keys must be ignored, so a future conflicting use would be a spec decision at that time, not a code risk now.

## Open Questions

- Should expanding a collapsed `<details>` (e.g. a folded section) explicitly trigger an arrow recompute, or is it acceptable to wait for the next scroll/resize? Doesn't change the spec or task breakdown — can be resolved during implementation by checking whether `<details>` toggling already fires a layout event the overlay can hook into.
