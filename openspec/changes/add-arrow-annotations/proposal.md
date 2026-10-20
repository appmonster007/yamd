# Proposal

## Why

Students annotating notes constantly draw an arrow from one piece of text to another — a word to its definition, a correction to the phrase it fixes, a cause to its effect — often across paragraphs or sections. YAMD's existing inline markup (spans, footnotes, cross-references) can label or link text, but nothing lets an author connect two spans with a visible connector line the way a hand-drawn arrow does on paper. Without this, students fall back to screenshots, external diagramming tools, or give up on the annotation.

## What Changes

- Add inline syntax to mark a span as an **arrow anchor** (a point an arrow can connect to) and a span as an **arrow source** (a point an arrow starts from), reusing the existing `{#id}`/`^id` anchor mechanisms wherever possible.
- Add a new span attribute key, `arrow=target-id` (used inside the existing `{...}` attribute syntax, e.g. `[text]{arrow=target-id}`), that marks the span it's attached to as the source of an arrow pointing at the element with `id` `target-id` (an existing `{#target-id}` attribute, heading ID, or `^id` block ID). A bare `->target-id` token was considered but rejected — `core/attrs.ts`'s `parseAttrBlock`/`splitTrailingAttrs` already reject any attribute body starting with `-` (reserved for CriticMarkup-style review syntax), so the new attribute must be an ordinary `key=value` pair to avoid a grammar change.
- Render arrow sources/targets as data attributes in the HTML output (`core/render.ts`); no visual connector is drawn server-side.
- Add a client-side SVG overlay in the VS Code preview webview that draws a connector with an arrowhead from each source span to its target element (`wire`, a right-angled line routed clear of the text in between, by default; `curve` for a direct bracket), recomputed on preview render, resize, and scroll.
- Extend the existing `Y701` diagnostic ("missing link, image, anchor, reference or footnote target", §10) to also cover an arrow source whose `target-id` does not resolve to any element in the document — no new diagnostic code is needed.
- Give each connector its own automatically assigned color (no two on a page repeat, however many there are) and separate same-side connectors into non-overlapping lanes, so arrows that run close together or converge on the same target stay visually distinguishable.
- Render an arrow-source span as a real `<a href="#target-id">` link, not a non-interactive element, so it's clickable and jumps to its target in any HTML consumer, not just the live preview — it was previously a `<span>` that looked clickable (same styling as a wikilink) but did nothing on click.
- Skip drawing a connector whose source or target currently has a zero-size rect (hidden, e.g. inside a collapsed section), instead of drawing one to a degenerate position.
- Update `yamd-spec.md` with the new syntax and its rendering contract.
- **Out of scope, deliberately:** flow charts and other diagrams. An earlier iteration of this change grew a `:::arrows` directive and a `::node`/`shape=` mechanism specifically to support flow charts within this same system; that approach became increasingly complex to route correctly (box-to-box edges, vertical chains, same-row hops) and was removed. Flow charts belong in a standard ` ```mermaid ` code block instead (§3.9, already supported as a diagram fallback block, independent of this capability) — a separate, already-existing mechanism, not part of this change. This capability is scoped to annotating prose: one span of text pointing at another labeled element elsewhere in the document.

## Capabilities

### New Capabilities
- `arrow-annotations`: inline syntax, parsing, rendering (data attributes) and VS Code preview visualization for arrows connecting one span of text to another labeled element in the same document, plus the associated lint diagnostic for unresolved targets.

### Modified Capabilities
(none — no existing specs are registered in `openspec/specs/` yet, so this is purely additive)

## Impact

- `yamd-spec.md` — new subsection under §4 (Inline elements) for arrow syntax.
- `vscode-yamd/src/core/render.ts` — read the existing `attrs.values['arrow']` on `span` nodes and emit a `data-yamd-arrow-to` attribute; no AST or parser changes needed since spans already carry arbitrary `key=value` attrs.
- `vscode-yamd/src/core/lint.ts` — a `case 'span':` branch alongside the existing `crossRef`/`footnoteRef` checks, reusing the linter's existing `this.ids` set to validate `arrow` targets and report `Y701`.
- `vscode-yamd/src/extension/preview.ts`, `src/extension/webviewShell.ts`, `src/preview/main.ts` — SVG overlay layer and its CSS, wired into the existing render/hydrate lifecycle; routing/color/lane logic, and a box-detection helper so routing connects whole callout/study boxes rather than the inline span an attribute happens to sit on.
- No new runtime dependencies; no network access required (consistent with project constraints).
