---
title: Attributes and page breaks
---

# Attributes and page breaks

Two kinds of HTML comment shape the exported page. They are invisible in editors and in other Markdown viewers.

## Attributes

A comment above an element adds classes and `key=value` attributes to it when the note is exported:

<!-- {.wide width=60%} -->
![The system architecture](../assets/architecture.svg)

Ids always use `^id` (see the references example); this comment is only for extra attributes.

## Page breaks

`<!-- pagebreak -->` starts a new page when the exported HTML is printed.

<!-- pagebreak -->

## A second page

This heading starts a new page in print and PDF output.
