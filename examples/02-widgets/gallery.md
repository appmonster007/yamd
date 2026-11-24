---
title: Gallery
---

# Gallery

A `gallery` block is a grid of images. Each list item is a card; the alt text is the caption. Drag a card to reorder it.

```gallery sketches
- ![Architecture](../assets/architecture.svg)
- ![The team](../assets/team.svg)
- ![A divider](../assets/divider.svg)
```

Or point at a folder and every image in it is shown, sorted by name:

```gallery id=all-assets source="../assets"
```

A folder gallery is read-only: there is no list in the note to rearrange.

## Try it

1. Click **Open gallery: sketches** and drag a card to reorder it. The list in the note reorders.
2. Click an image to enlarge it. Click again or press Escape to close.
3. Press **Choose images…** (or run **YAMD: Add Image to Gallery**) to pick files and confirm captions.
4. Open **all-assets**. It lists every image in `../assets`; it is read-only.
