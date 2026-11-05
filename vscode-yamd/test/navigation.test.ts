/**
 * Orphan-note and unlinked-mention detection reuse `NoteStore` directly (the same engine the
 * navigation commands call through `WorkspaceIndex`), so this tests the store's behavior rather
 * than re-implementing detection logic for the test.
 */
import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { NoteStore } from '../src/core/notes';

describe('orphan notes', () => {
  it('finds notes with no links in or out', () => {
    const store = new NoteStore();
    store.set('a.yamd', '# A\n\n[[b]]\n');
    store.set('b.yamd', '# B\n');
    store.set('c.yamd', '# C (orphan)\n');
    const orphans = store.summaries().filter((s) => s.links.length === 0 && store.backlinks(s.path).length === 0);
    assert.deepEqual(orphans.map((s) => s.path), ['c.yamd']);
  });
});

describe('unlinked mentions', () => {
  it('finds a plain-text mention of a note title', () => {
    const store = new NoteStore();
    store.set('project-x.yamd', '---\ntitle: Project X\n---\n\n# Project X\n');
    store.set('log.yamd', 'Talked about Project X today.\n');
    const mentions = store.unlinkedMentions('project-x.yamd');
    assert.equal(mentions.length, 1);
    assert.equal(mentions[0]?.from, 'log.yamd');
  });

  it('does not flag an already-linked mention', () => {
    const store = new NoteStore();
    store.set('project-x.yamd', '---\ntitle: Project X\n---\n\n# Project X\n');
    store.set('log.yamd', 'Talked about [[Project X]] today.\n');
    assert.deepEqual(store.unlinkedMentions('project-x.yamd'), []);
  });
});
