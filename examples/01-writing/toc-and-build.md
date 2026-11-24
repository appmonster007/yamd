---
title: Table of contents and Build
---

# Table of contents and Build

**YAMD: Build** refreshes everything the extension generates, and only that:

- reference links and their labels,
- citation links,
- the content between `<!-- yamd:NAME -->` and `<!-- /yamd:NAME -->` markers.

Anything outside those is yours. Delete a marker pair and the extension stops touching that section. The `yamd.build.onSave` setting runs Build on every save; it is off by default.

## Contents

The marker takes `depth=` (default 3). Use **YAMD: Insert Table of Contents** to add one at the cursor.

<!-- yamd:toc depth=3 -->
- [Table of contents and Build](#table-of-contents-and-build)
  - [Contents](#contents)
  - [Section one](#section-one)
    - [A subsection](#a-subsection)
  - [Section two](#section-two)
    - [Another subsection](#another-subsection)
    - [Another subsection](#another-subsection-1)
  - [Query snapshots](#query-snapshots)
<!-- /yamd:toc -->

## Section one

Some text.

### A subsection

More text.

## Section two

Headings inside code blocks are ignored:

```markdown
# Not a heading
```

### Another subsection

Duplicate headings get GitHub-style anchors (`#another-subsection`, `#another-subsection-1`).

### Another subsection

The second one is linked as `another-subsection-1`.

**Try it:**
1. Add a `## Section three` heading anywhere, then run **YAMD: Build**. It appears in the contents.
2. Change `depth=3` to `depth=2` and Build again; the subsections go.
3. Turn on `yamd.build.onSave` to run Build on every save.

## Query snapshots

**YAMD: Run Query** writes a snapshot between `yamd:query:ID` markers under a query block (see the queries folder). Running it again with unchanged rows changes nothing.
