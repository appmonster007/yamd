import assert from 'node:assert/strict';
import { describe, test } from 'node:test';
import { parse, render } from '../src/core/markdown';
import { defaultMonth } from '../src/core/markdown/renderBoards';
import { addGalleryCard, moveGalleryCard } from '../src/core/widgets/galleryEdit';
import { applyBodyEdit } from '../src/core/widgets/widgetBody';

const html = (body: string, type: string, options = {}) => render(parse(`:::${type}\n${body}\n:::`), options);

describe('gallery', () => {
  const list = '- ![Architecture](a.svg)\n- ![The team](b.svg)\n- ![A divider](c.svg)';

  test('a list of images is a gallery, with the alt text as the caption', () => {
    const out = html(list, 'gallery');
    assert.equal((out.match(/class="db-card"/g) ?? []).length, 3);
    assert.match(out, /db-card-caption">Architecture</);
    assert.match(out, /<img src="b\.svg"/);
  });

  test('an image with its own caption paragraph still works, and shows that caption', () => {
    const out = html('![Alt](a.svg)\nShot at sunset.\n\n![Two](b.svg)\nPeak flow.', 'gallery');
    assert.equal((out.match(/class="db-card"/g) ?? []).length, 2);
    assert.match(out, /Shot at sunset/);
    assert.doesNotMatch(out, /db-card-caption/);
  });

  test('adding to a list gallery adds a list item; to an empty one too', () => {
    const doc = ':::gallery\n- ![A](a.svg)\n:::';
    const e = addGalleryCard(doc, 0, 'z.svg', 'Zed');
    assert.ok(e);
    assert.match(e.text, /- !\[A\]\(a\.svg\)\n- !\[Zed\]\(z\.svg\)$/);
    const empty = addGalleryCard(':::gallery\n:::', 0, 'z.svg', '');
    assert.match(empty?.text ?? '', /\n- !\[Image\]\(z\.svg\)$/);
  });

  test('moving a list card keeps the list tight', () => {
    const src = `:::gallery\n${list}\n:::`;
    const out = html(list, 'gallery', { interactive: true });
    const m = /data-line="(\d+)" data-hash="([^"]+)"/.exec(out);
    assert.ok(m);
    const e = moveGalleryCard(src, 0, { line: Number(m[1]) + 1, hash: m[2] as string }, 2);
    void applyBodyEdit;
    // The first card's own hash differs from the one asked for, so a stale ref is refused rather than guessed.
    assert.equal(e, null);
    const lines = src.split('\n');
    const real = /data-line="1" data-hash="([^"]+)"/.exec(out);
    assert.ok(real);
    const moved = moveGalleryCard(src, 0, { line: 1, hash: real[1] as string }, 2);
    assert.ok(moved);
    const result = [...lines.slice(0, moved.startLine), moved.text, ...lines.slice(moved.endLine + 1)].join('\n');
    assert.equal(result, ':::gallery\n- ![The team](b.svg)\n- ![A divider](c.svg)\n- ![Architecture](a.svg)\n:::');
  });
});

describe('calendar', () => {
  const cards = [{ due: '2026-12-04' }, { due: '2026-12-18' }, { due: '2027-02-01' }, {}];

  test('opens on the next month that has events, not an empty current one', () => {
    assert.equal(defaultMonth(cards, '2026-11-05'), '2026-12');
    assert.equal(defaultMonth(cards, '2026-12-20'), '2026-12');
    assert.equal(defaultMonth(cards, '2027-03-01'), '2027-02');
    assert.equal(defaultMonth([], '2026-11-05'), '2026-11');
  });

  test('the panel view shows one month with buttons; a static page lists every month with events', () => {
    const body = '- [ ] A {due=2026-12-04}\n- [ ] B {due=2027-02-01}';
    const panel = html(body, 'calendar', { interactive: true, today: '2026-11-05' });
    assert.match(panel, /data-month="2026-12"/);
    assert.equal((panel.match(/class="db-calendar"/g) ?? []).length, 1);
    assert.equal((panel.match(/db-month-nav/g) ?? []).length, 3);
    assert.match(panel, /db-event-summary">[^<]*<input[^>]*> A</);
    assert.doesNotMatch(panel, /> B</);
    const page = html(body, 'calendar', { today: '2026-11-05' });
    assert.equal((page.match(/class="db-calendar"/g) ?? []).length, 2);
    assert.doesNotMatch(page, /db-month-nav/);
    assert.match(page, /December 2026/);
    assert.match(page, /February 2027/);
  });

  test('a requested month wins', () => {
    const out = html('- [ ] A {due=2026-12-04}', 'calendar', { interactive: true, month: '2026-10', today: '2026-11-05' });
    assert.match(out, /October 2026/);
    assert.doesNotMatch(out, /> A</);
  });
});

describe('timeline', () => {
  const body = '## Ada\n- [ ] One {start=2026-01-12 due=2026-02-06}\n- [ ] Two {start=2026-02-09 due=2026-03-06}';

  test('has a month scale and keeps every bar inside the track', () => {
    const out = html(body, 'timeline', { today: '2026-02-20' });
    assert.match(out, /db-timeline-axis/);
    assert.match(out, />Jan 2026</);
    assert.match(out, />Feb</);
    assert.match(out, /db-timeline-today/);
    for (const m of out.matchAll(/style="left:([\d.]+)%;width:([\d.]+)%"/g)) assert.ok(Number(m[1]) + Number(m[2]) <= 100.0001, m[0]);
  });

  test('no scale or today mark for a timeline with no dated cards', () => {
    assert.doesNotMatch(html('## Ada\n- [ ] undated', 'timeline'), /db-timeline-axis/);
  });
});
