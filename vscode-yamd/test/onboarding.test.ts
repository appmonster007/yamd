import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import * as path from 'node:path';
import { describe, test } from 'node:test';
import { buildNote } from '../src/core/build/build';
import { calloutProblems } from '../src/core/build/callouts';
import { MENU } from '../src/core/onboarding/menu';
import { expandPlaceholders } from '../src/core/templates/placeholders';
import { NOTE_TEMPLATES, SAMPLE_NOTE } from '../src/core/templates/notes';
import { scanWidgets } from '../src/core/widgets/fences';
import { lintWidgets } from '../src/core/widgets/widgetLint';
import { lintMarkers } from '../src/core/build/markers';

const pkg = JSON.parse(readFileSync(path.join(__dirname, '..', 'package.json'), 'utf8')) as { contributes: { commands: { command: string }[]; walkthroughs: { steps: { description: string; media: { markdown: string } }[] }[] } };
const commands = new Set(pkg.contributes.commands.map((c) => c.command));

describe('menu', () => {
  test('every item runs a command the extension contributes', () => {
    const missing = MENU.flatMap((g) => g.items).filter((i) => !commands.has(i.command));
    assert.deepEqual(missing.map((i) => i.command), []);
  });
});

describe('walkthrough', () => {
  test('every step links to a real command and has its page', () => {
    for (const step of pkg.contributes.walkthroughs[0]?.steps ?? []) {
      for (const m of step.description.matchAll(/command:([\w.]+)/g)) assert.ok(commands.has(m[1] as string), `${m[1]} is not a command`);
      assert.doesNotThrow(() => readFileSync(path.join(__dirname, '..', step.media.markdown), 'utf8'), step.media.markdown);
    }
  });
});

describe('note templates', () => {
  for (const t of [...NOTE_TEMPLATES, SAMPLE_NOTE]) {
    test(`${t.id}: expands cleanly into a valid note`, () => {
      const { text, cursor } = expandPlaceholders(t.text, { now: new Date(2026, 10, 5), title: 'My note' });
      assert.doesNotMatch(text, /\{\{@/);
      assert.ok(cursor === undefined || cursor <= text.length);
      const lines = buildNote(text.split('\n')).lines;
      assert.deepEqual(lintWidgets(lines).filter((p) => p.severity !== 'hint').map((p) => p.code), []);
      assert.deepEqual(calloutProblems(lines), []);
      assert.deepEqual(lintMarkers(lines), []);
      // Building again changes nothing, and each query's file is one the template creates.
      assert.deepEqual(buildNote(lines).lines, lines);
      for (const w of scanWidgets(lines)) if (w.type === 'sql') assert.ok(t.files?.some((f) => f.name === w.attrs['source']), `${t.id} needs ${w.attrs['source']}`);
    });
  }

  test('the article template has a contents, a citation and a bibliography file', () => {
    const t = NOTE_TEMPLATES.find((x) => x.id === 'article')!;
    assert.match(t.text, /yamd:toc/);
    assert.match(t.text, /\[@example2026\]/);
    assert.ok(t.files?.some((f) => f.name === 'refs.bib' && f.text.includes('example2026')));
  });
});
