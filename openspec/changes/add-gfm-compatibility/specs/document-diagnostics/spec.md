# Spec Delta

## MODIFIED Requirements

### Requirement: Reported diagnostic codes
The extension SHALL report these codes with the listed severity: Y501, Y702, Y703, Y801 as errors; Y101, Y301, Y401, Y601, Y701, Y704, Y705, Y706, Y901 as warnings; Y201, Y210, Y212, Y707 as information. Each diagnostic MUST show its code, a message and the source `yamd`.

#### Scenario: Diagnostic format
- **WHEN** an image has no alt text
- **THEN** an error with code `Y702`, source `yamd` and a message explaining how to fix it appears on that image

#### Scenario: Tabs are a warning
- **WHEN** a line is indented with a tab
- **THEN** warning Y101 suggests spaces, and the line still renders as GFM would

#### Scenario: Changed bullet marker
- **WHEN** a bullet list using `-` is directly followed by an item using `*`
- **THEN** information Y212 says a new list starts there, and suggests `-` to continue the first list

#### Scenario: Redundant hard break
- **WHEN** a line ends with `\`
- **THEN** information Y201 says the backslash is redundant because a newline is already a line break
