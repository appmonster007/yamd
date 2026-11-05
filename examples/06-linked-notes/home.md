---
title: Home
aliases: [start, index]
tags: [hub]
---

# Home

A small set of notes that link to each other, for trying backlinks and the note graph. These come from [Foam](https://marketplace.visualstudio.com/items?itemName=foam.foam-vscode), which installs with YAMD; YAMD adds the commands that open its views.

## Try it

- Run **YAMD: Show Backlinks (Foam)** with this note open. [[ideas]], [[people/ada]] and [[meetings/standup]] all link here, so they appear as backlinks.
- Run **YAMD: Show Note Graph (Foam)** to see the four notes as a graph.
- Run **YAMD: Show Tags (Foam)** and open `#planning`.
- Open `people/ada.md` and look at the **Unlinked Mentions** view in the YAMD sidebar: [[ideas]] names "Ada Lovelace" (one of Ada's aliases) without linking. The link button on the line turns it into `[[people/ada|Ada Lovelace]]`. The **Outline** view next to it lists this note's headings.
- Hover a link, or Cmd/Ctrl-click it, to open the note. A link to a heading works too: [[ideas#Parked]].
- A link to a note that doesn't exist yet, such as [[roadmap]], shows up as a placeholder in Foam and can be created from there.

## The notes

| Note | About |
| ---- | ----- |
| [[ideas]] | Things worth trying, with a parked list |
| [[people/ada]] | A person, linked from meetings |
| [[meetings/standup]] | A meeting that links people and ideas |

When you export a note, `[[page]]` becomes a link to `page.md` next to the export.
