# Spec Delta

## Purpose

Reports problems in YAMD documents inside the editor, using the diagnostic codes defined in `yamd-spec.md`, so authors never get silent failures.

## ADDED Requirements

### Requirement: Reported diagnostic codes
The extension SHALL report these codes with the listed severity: Y101, Y501, Y702, Y703, Y801 as errors; Y201, Y301, Y401, Y601, Y701, Y704, Y705, Y706, Y901 as warnings; Y707 as information. Each diagnostic MUST show its code, a message and the source `yamd`.

#### Scenario: Diagnostic format
- **WHEN** an image has no alt text
- **THEN** an error with code `Y702`, source `yamd` and a message explaining how to fix it appears on that image

### Requirement: Syntax diagnostics
The extension SHALL report tabs in indentation (Y101), a trailing backslash (Y201), `#` followed directly by a word at the start of a line (Y301), a non-blank line without `>` directly after a quote line (Y401), an unclosed code fence (Y501) and an unknown directive name (Y601).

#### Scenario: Hashtag at line start
- **WHEN** a line starts with `#Title`
- **THEN** warning Y301 asks whether a heading was intended

#### Scenario: Unclosed fence
- **WHEN** a code fence has no closing fence
- **THEN** error Y501 is reported on the opening fence

#### Scenario: Vendor directive
- **WHEN** a document uses `:::x-acme-chart`
- **THEN** warning Y601 is reported, naming the directive

### Requirement: Link diagnostics
The extension SHALL report Y701 for in-document anchors with no matching id, and for relative links, wikilinks and image paths whose target file does not exist in the workspace. It SHALL report Y901 for links with a URL scheme that is not allowed.

#### Scenario: Missing anchor
- **WHEN** the document links to `#tablez` and no element has that id
- **THEN** warning Y701 is reported on the link

#### Scenario: Missing file
- **WHEN** the document contains `[[installation]]` and `installation.yamd` does not exist
- **THEN** warning Y701 is reported on the wikilink

#### Scenario: External links are not checked
- **WHEN** the document links to `https://example.com`
- **THEN** no diagnostic is reported and no network request is made

### Requirement: Accessibility diagnostics
The extension SHALL report images without alt text and without `{decorative}` (Y702), pipe tables without a header separator row (Y703), skipped heading levels (Y704), more than one H1 (Y705), non-descriptive link text such as "click here", "here" or "link" (Y706), and front matter without `lang` (Y707).

#### Scenario: Skipped heading level
- **WHEN** an `##` heading is followed directly by an `####` heading
- **THEN** warning Y704 is reported on the `####` heading

#### Scenario: Decorative image
- **WHEN** an image has empty alt text and the `{decorative}` attribute
- **THEN** no Y702 diagnostic is reported

### Requirement: Variable diagnostics
The extension SHALL report Y801 for each `{{ name }}` that does not match a `vars` entry or a built-in variable.

#### Scenario: Undefined variable
- **WHEN** the text contains `{{ produc }}` and only `product` is defined
- **THEN** error Y801 is reported, naming `produc`

### Requirement: Content excluded from checks
Text inside code spans, fenced code blocks, math and comments MUST NOT produce diagnostics other than Y501.

#### Scenario: Code is ignored
- **WHEN** a code span contains `{{ undefined }}` or `#Title`
- **THEN** no diagnostic is reported for it

### Requirement: When diagnostics run
Diagnostics SHALL update within 500 milliseconds after the user stops typing and when a document is opened, and SHALL be cleared when the document is closed.

#### Scenario: Fixing a problem clears it
- **WHEN** the user adds alt text to an image that had a Y702 error
- **THEN** the error disappears without saving the file

### Requirement: Configuration
The extension SHALL provide `yamd.diagnostics.enabled` (default `true`) to turn all diagnostics off and `yamd.diagnostics.ignore` (a list of codes) to turn off individual codes.

#### Scenario: Ignoring a code
- **WHEN** `yamd.diagnostics.ignore` contains `Y707`
- **THEN** no Y707 diagnostics are reported
