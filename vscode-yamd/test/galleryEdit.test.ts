import assert from 'node:assert/strict';
import { describe, test } from 'node:test';
import { parse } from '../src/core';
import { buildGallery, cardSource, hashText } from '../src/core/kanban';
import { addGalleryCard, moveGalleryCard } from '../src/core/galleryEdit';
import type { ContainerBlock } from '../src/core';
import type { LineEdit } from '../src/core/kanbanEdit';

const SRC = `:::gallery {title="Trip photos"}
![Golden Gate Bridge](ggb.jpg)
Shot at sunset. #landscape

![Yosemite Falls](yosemite.jpg)
Peak flow in spring.
:::`;

function apply(src: string, edit: LineEdit | null): string {
  assert.ok(edit, 'expected an edit');
  const lines = src.split('\n');
  lines.splice(edit.startLine, edit.endLine - edit.startLine + 1, ...edit.text.split('\n'));
  return lines.join('\n');
}

function ref(src: string, alt: string) {
  const doc = parse(src);
  const container = doc.blocks.find((b): b is ContainerBlock => b.type === 'container' && b.name === 'gallery');
  assert.ok(container);
  for (const c of buildGallery(container).cards) {
    if (c.image.alt === alt) return { line: c.line, hash: hashText(cardSource(doc.lines, c)) };
  }
  throw new Error(`no card ${alt}`);
}

describe('gallery edits', () => {
  test('reorders a card to a new position', () => {
    const r = ref(SRC, 'Yosemite Falls');
    const out = apply(SRC, moveGalleryCard(SRC, 0, r, 0));
    const lines = out.split('\n').filter((l) => l.trim());
    assert.ok(lines.indexOf('![Yosemite Falls](yosemite.jpg)') < lines.indexOf('![Golden Gate Bridge](ggb.jpg)'));
  });

  test('rejects a stale hash', () => {
    const r = ref(SRC, 'Yosemite Falls');
    assert.equal(moveGalleryCard(SRC, 0, { ...r, hash: 'stale' }, 0), null);
  });

  test('adds an image with a caption after the last card', () => {
    const out = apply(SRC, addGalleryCard(SRC, 0, 'new.jpg', 'A new photo'));
    assert.match(out, /Peak flow in spring\.\n\n!\[A new photo\]\(new\.jpg\)\nA new photo/);
  });

  test('adds the first card right after an empty gallery opens', () => {
    const empty = ':::gallery\n:::';
    const out = apply(empty, addGalleryCard(empty, 0, 'first.jpg', 'First photo'));
    assert.equal(out, ':::gallery\n\n![First photo](first.jpg)\nFirst photo\n:::');
  });

  test('an image with no caption gets a generic alt text', () => {
    const empty = ':::gallery\n:::';
    const out = apply(empty, addGalleryCard(empty, 0, 'bare.jpg', ''));
    assert.equal(out, ':::gallery\n\n![Image](bare.jpg)\n:::');
  });
});
