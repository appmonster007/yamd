# Spec Delta

## Purpose

Lets an author connect a span of text to another labeled element anywhere in the same document with a visible arrow, matching the annotation style students use on paper (e.g. a word pointing at its definition). Flow charts and other diagrams are a separate concern, handled by a standard ` ```mermaid ` code block (§3.9), not by this capability.

## ADDED Requirements

### Requirement: Arrow source syntax
An inline span SHALL accept an `arrow=target-id` key/value attribute inside its attribute braces, using the standard attribute syntax (§5), marking that span as the source of an arrow pointing at the element whose `id` is `target-id`. The attribute SHALL be usable alongside other attributes in the same braces (e.g. `[text]{.muted arrow=target-id}`).

#### Scenario: Span with only an arrow attribute
- **WHEN** a document contains `[mitosis]{arrow=def-mitosis}`
- **THEN** the parser produces a span node for "mitosis" with an arrow source targeting `def-mitosis`

#### Scenario: Arrow attribute combined with other attributes
- **WHEN** a document contains `[mitosis]{.key-term arrow=def-mitosis}`
- **THEN** the parser applies the `key-term` class and the arrow source targeting `def-mitosis` to the same span

### Requirement: Arrow targets reuse existing anchor mechanisms
An arrow's `target-id` SHALL resolve against any `id` already producible in the document: an attribute ID on a block (`{#id}` directly above it, or starting its own first line, §5 — the preferred way to label a target, the same way a cross-reference or a LaTeX `\label{}` does), a heading's own trailing `{#id}`, a cross-reference label (§4.7), or a block ID (`^id`, §4.11). No new anchor syntax is introduced for arrow targets.

#### Scenario: Target is an attribute ID directly above a paragraph
- **WHEN** a document contains `{#def-mitosis}` on its own line directly above a paragraph, and another span has `{arrow=def-mitosis}`
- **THEN** the arrow resolves to that paragraph

#### Scenario: Target is an attributed span
- **WHEN** a span `[Mitosis]{#def-mitosis}` exists and another span has `{arrow=def-mitosis}`
- **THEN** the arrow resolves to the `Mitosis` span

#### Scenario: Target is a block ID
- **WHEN** a paragraph ends with `^def-mitosis` and another span has `{arrow=^def-mitosis}`
- **THEN** the arrow resolves to that paragraph

### Requirement: Rendered output carries arrow data attributes
The HTML renderer SHALL emit `data-yamd-arrow-to="target-id"` on the element produced for an arrow-source span, and SHALL ensure every element with a resolvable `id` keeps that `id` in the rendered output so it can be used as an arrow target. The renderer SHALL NOT draw any visual connector itself; rendering is limited to the data attributes.

#### Scenario: Arrow source renders with data attribute
- **WHEN** rendering `[mitosis]{arrow=def-mitosis}`
- **THEN** the output HTML contains an element with `data-yamd-arrow-to="def-mitosis"` wrapping the text "mitosis"

### Requirement: An arrow source is a real link to its target
An arrow-source span SHALL render as an `<a href="#target-id">` element, not a non-interactive element, so it navigates to its target when activated in any HTML consumer (the preview, a browser viewing exported HTML, or any other reader), independent of whether a visual connector is drawn.

#### Scenario: Arrow source is clickable without the preview
- **WHEN** a document with `[mitosis]{arrow=def-mitosis}` is exported to static HTML and opened in a plain browser with no preview script
- **THEN** clicking "mitosis" navigates to the element with `id` `def-mitosis`, the same as any other same-page link

### Requirement: Unresolved arrow target is diagnosed
An arrow source whose `target-id` does not resolve to any `id` in the same document SHALL produce diagnostic `Y701` (missing link, image, anchor, reference or footnote target), at the location of the arrow source span, with a suggested fix of either removing the arrow or adding the missing target ID.

#### Scenario: Target does not exist
- **WHEN** a document contains `[mitosis]{arrow=no-such-id}` and no element in the document has `id` `no-such-id`
- **THEN** the linter reports `Y701` at the span's location

#### Scenario: Target exists
- **WHEN** a document contains `[mitosis]{arrow=def-mitosis}` and an element with `id` `def-mitosis` exists
- **THEN** no diagnostic is reported for that arrow

### Requirement: VS Code preview draws arrow connectors
The VS Code preview webview SHALL render a visible connector with an arrowhead from each arrow-source element to its resolved target element, overlaid on the rendered document, whenever both elements are present in the rendered DOM. The connector SHALL be recomputed after each preview re-render, and after the preview viewport is resized or scrolled, so it continues to visually line up with its source and target.

#### Scenario: Arrow drawn between two visible elements
- **WHEN** the preview renders a document containing `[mitosis]{arrow=def-mitosis}` and an element with `id` `def-mitosis`
- **THEN** the preview displays a connector line with an arrowhead running from the "mitosis" span to the `def-mitosis` element

#### Scenario: Arrow updates after scrolling
- **WHEN** the preview is scrolled after an arrow has been drawn
- **THEN** the connector is redrawn so it still points from the source span to the target element at their new on-screen positions

#### Scenario: Target not resolvable in the rendered document
- **WHEN** an arrow source's `target-id` does not resolve (per the `Y701` diagnostic requirement above)
- **THEN** the preview does not draw a connector for that arrow source

### Requirement: A hidden source or target draws no connector
When an arrow's source or target element is present in the DOM but currently has no visible size (e.g. inside a collapsed section), the preview SHALL NOT draw a connector for it, rather than drawing one to a degenerate position.

#### Scenario: Target inside a collapsed section
- **WHEN** an arrow's target element is inside a section that is currently collapsed (zero rendered size)
- **THEN** the preview does not draw a connector for that arrow until the section is expanded

### Requirement: Arrow connector routing is selectable
A span's `arrow-style` attribute SHALL select how its connector is routed in the preview: `wire` (the default, used when the attribute is absent) routes it as a right-angled line out to the page margin and back in; `curve` routes it as a smooth bracket between the same two anchor points instead. An unrecognized `arrow-style` value SHALL be treated the same as `wire`.

#### Scenario: Default routing is wire
- **WHEN** a document contains `[mitosis]{arrow=def-mitosis}` with no `arrow-style`
- **THEN** the preview routes that connector as a right-angled wire, not a curve

#### Scenario: Curve routing requested
- **WHEN** a document contains `[mitosis]{arrow=def-mitosis arrow-style=curve}`
- **THEN** the preview routes that connector as a curved bracket instead of a right-angled wire

### Requirement: Arrow connectors are colored to stay distinguishable
The preview SHALL assign each rendered connector its own distinct color automatically, without any markup for the author to configure, such that no two connectors on the same page repeat a color regardless of how many connectors the page has, so that connectors which run close together or cross remain visually distinguishable from one another.

#### Scenario: Two arrows on the same side of the page
- **WHEN** the preview renders two arrow connectors routed to the same side of the page
- **THEN** the two connectors are drawn in two different colors

#### Scenario: More arrows than any small fixed palette would hold
- **WHEN** the preview renders more than a handful (e.g. ten) arrow connectors in one document
- **THEN** every connector still gets its own distinct color, none repeating

### Requirement: Arrow connectors avoid overlapping each other
When multiple `wire`-routed connectors would otherwise run along the same path on the same side of the page, the preview SHALL separate them into distinct, non-overlapping lanes, limited to connectors that could actually visually collide (share a vertical span on the same side) — connectors elsewhere on the page SHALL NOT be pushed into a lane unnecessarily.

#### Scenario: Several arrows converge on one target from the same side
- **WHEN** three arrow connectors are routed to the same side of the page with overlapping vertical spans
- **THEN** each is drawn in its own lane so no two run along the same line

#### Scenario: Unrelated arrows do not affect each other's lane
- **WHEN** one arrow connector is far above another, unrelated arrow connector on the page
- **THEN** neither arrow's lane is affected by the other

### Requirement: Arrow connectors are hidden from non-visual output
Export targets and renderings that are not the interactive VS Code preview (e.g. accessible/text-only output, exported HTML without the preview's client-side script) SHALL NOT be required to render the visual connector. The underlying text content and arrow data attributes SHALL remain present so the relationship is still discoverable programmatically.

#### Scenario: Static HTML export
- **WHEN** a document with an arrow annotation is exported to static HTML without the preview script
- **THEN** the exported HTML still contains the source span's text, the target element's text and `id`, and the `data-yamd-arrow-to` attribute, even though no connector line is drawn

### Requirement: Routing connects whole boxes, not the point an id happens to attach to
When an arrow's source or target is or sits inside a labeled box — a callout or a study block — routing SHALL treat that entire box's edges as the connection point, not a narrower element nested inside it.

#### Scenario: A span inside a box points at another box
- **WHEN** a span with an `arrow=` attribute sits inside a callout box, and its target is a separate callout box directly below
- **THEN** the connector runs from the source box's own bottom edge to the target box's own top edge, not from the span's own position

### Requirement: An arrow anchors on rendered text, not an element's full container width
When an arrow's source or target is not a recognized box, the preview SHALL anchor the connector on the tight bounding area of that element's actual rendered text, not the element's own layout box.

#### Scenario: A short labeled paragraph in a wide column
- **WHEN** a `{#id}`-labeled paragraph containing a single short sentence sits in a content column much wider than that sentence, and an arrow targets it with `arrow-style=curve`
- **THEN** the connector's endpoint lands at the visual center of the rendered sentence, not at the horizontal center of the paragraph's full-width container

### Requirement: A block's label can share its own first line
A paragraph's `{#id}` (or other block attributes, §5) SHALL be acceptable either on its own line directly above the paragraph, or starting the paragraph's own first line, immediately before its text — so a single-sentence labeled note doesn't cost two source lines.

#### Scenario: Label and text share one line
- **WHEN** a document contains `{#def-mitosis} Mitosis is nuclear division.`
- **THEN** a paragraph with `id` `def-mitosis` and that text content is produced, the same as `{#def-mitosis}` on its own line above the sentence would produce

#### Scenario: Non-matching braces stay literal
- **WHEN** a paragraph starts with `{...}` that doesn't parse as a valid attribute list
- **THEN** that text renders literally, unchanged from today's behavior for such a line
