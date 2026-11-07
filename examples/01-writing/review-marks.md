---
title: Review marks
---

# Review marks

Suggest changes with plain HTML that renders in any Markdown viewer: `<ins>` for text you add and `<del>` for text you remove. Use `<mark>` to highlight and an HTML comment for a note to the author.

The meeting is on <del>Tuesday</del><ins>Wednesday</ins> at <ins>10:30</ins>.

Please check this <mark>figure</mark>. <!-- Is the unit milliseconds or seconds? -->

Put the cursor on a change and run **YAMD: Accept Change at Cursor** or **YAMD: Reject Change at Cursor**. Select several and run the command to resolve all of them in the selection. **YAMD: Accept All Changes** and **YAMD: Reject All Changes** resolve the whole note.

Accepting keeps added text and drops removed text; rejecting does the opposite. Marks inside code are left alone:

```html
<ins>this stays</ins> and <del>so does this</del>
```

## Try it

1. Put the cursor inside the `<ins>Wednesday</ins>` change and run **YAMD: Accept Change at Cursor**. The `<del>` goes and the text stays.
2. Run **YAMD: Reject Change at Cursor** on another change. The addition goes instead.
3. Type `ins` or `del` and press Tab for a snippet.
4. Select several changes and run Accept or Reject once. **Accept All Changes** resolves the whole note.
