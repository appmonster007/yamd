import assert from 'node:assert/strict';
import { existsSync, readFileSync, readdirSync, statSync } from 'node:fs';
import * as path from 'node:path';
import { describe, test } from 'node:test';
import { COMPANIONS } from '../src/core/companions';
import { findMentions, namesOf } from '../src/core/notes/mentions';

const repo = path.resolve(__dirname, '..', '..');
const read = (p: string) => JSON.parse(readFileSync(path.join(repo, p), 'utf8')) as Record<string, unknown> & { extensionPack?: string[]; version: string; name: string; publisher: string; engines: { vscode: string }; categories: string[] };
const ext = read('vscode-yamd/package.json');
const pack = read('vscode-yamd-pack/package.json');
const companionIds = Object.values(COMPANIONS).map((c) => c.id);

describe('files the Marketplace shows', () => {
  test('the extension carries the licence and changelog, identical to the repository root', () => {
    for (const f of ['LICENSE', 'CHANGELOG.md']) {
      assert.equal(readFileSync(path.join(repo, 'vscode-yamd', f), 'utf8'), readFileSync(path.join(repo, f), 'utf8'), `${f} differs from the root copy; copy it again`);
    }
  });
});

describe('extension and extension pack', () => {
  test('the pack lists YAMD and every companion, and nothing else', () => {
    assert.deepEqual([...(pack.extensionPack ?? [])].sort(), [`${ext.publisher}.${ext.name}`, ...companionIds].sort());
  });
  test('the extension itself brings the same companions', () => {
    assert.deepEqual([...(ext.extensionPack ?? [])].sort(), [...companionIds].sort());
  });
  test('both ship the same version for the same VS Code', () => {
    assert.equal(pack.version, ext.version);
    assert.equal(pack.engines.vscode, ext.engines.vscode);
    assert.equal(pack.publisher, ext.publisher);
  });
  test('the pack is a pack: no code, the right category, a README, a licence and an icon', () => {
    assert.ok(pack.categories.includes('Extension Packs'));
    assert.equal(pack['main'], undefined);
    for (const f of ['README.md', 'LICENSE', 'icon.png']) assert.ok(existsSync(path.join(repo, 'vscode-yamd-pack', f)), f);
  });
  test('the changelog has an entry for this version', () => {
    assert.match(readFileSync(path.join(repo, 'CHANGELOG.md'), 'utf8'), new RegExp(`^## ${ext.version.replace(/\./g, '\\.')}`, 'm'));
  });
});

function notes(dir: string): string[] {
  return readdirSync(dir).flatMap((f) => {
    const p = path.join(dir, f);
    return statSync(p).isDirectory() ? notes(p) : p.endsWith('.md') ? [p] : [];
  });
}

/** The text outside fenced code, however many backticks open the fence. */
function withoutFences(text: string): string {
  let fence = '';
  return text.split('\n').filter((line) => {
    const m = /^\s*(`{3,}|~{3,})/.exec(line);
    if (m && !fence) { fence = m[1] as string; return false; }
    if (m && fence && (m[1] as string)[0] === fence[0] && (m[1] as string).length >= fence.length) { fence = ''; return false; }
    return !fence;
  }).join('\n').replace(/`[^`\n]*`/g, '');
}

describe('examples stay connected', () => {
  const all = notes(path.join(repo, 'examples'));
  test('every relative link in an example or the README points at a file', () => {
    const bad: string[] = [];
    for (const file of [...all, path.join(repo, 'README.md')]) {
      const text = withoutFences(readFileSync(file, 'utf8'));
      for (const m of text.matchAll(/\]\(([^)\s#]+)(?:#[^)]*)?\)/g)) {
        const target = m[1] as string;
        if (/^[a-z][a-z0-9+.-]*:/i.test(target)) continue;
        if (!existsSync(path.resolve(path.dirname(file), decodeURI(target)))) bad.push(`${path.relative(repo, file)} -> ${target}`);
      }
    }
    assert.deepEqual(bad, []);
  });
  test('every screenshot the README uses exists', () => {
    const text = readFileSync(path.join(repo, 'README.md'), 'utf8');
    for (const m of text.matchAll(/!\[[^\]]*\]\((docs\/images\/[^)]+)\)/g)) assert.ok(existsSync(path.join(repo, m[1] as string)), m[1]);
  });
  test('the linked-notes example has an unlinked mention of Ada to find', () => {
    const dir = path.join(repo, 'examples', '06-linked-notes');
    const adaPath = path.join(dir, 'people', 'ada.md');
    const pool = notes(dir).map((p) => ({ path: p, text: readFileSync(p, 'utf8') }));
    const found = findMentions(namesOf(adaPath, readFileSync(adaPath, 'utf8').split('\n')), pool, adaPath);
    // Only the plain-text sentence in ideas.md: the stand-up's `owner=ada` is inside a board block.
    assert.deepEqual(found.map((m) => `${path.basename(m.path)}:${m.text}`), ['ideas.md:Ada Lovelace']);
  });
});

describe('walkthrough size is stated correctly', () => {
  test('the docs say how many steps the walkthrough has', () => {
    const steps = (ext as unknown as { contributes: { walkthroughs: { steps: unknown[] }[] } }).contributes.walkthroughs[0]?.steps.length;
    for (const f of ['README.md', 'vscode-yamd/README.md', 'examples/getting-started.md', 'examples/07-whats-new/getting-started-tools.md']) {
      const text = readFileSync(path.join(repo, f), 'utf8');
      for (const m of text.matchAll(/(\d+)[- ]steps?\b/g)) if (/walkthrough|tour/i.test(text.slice(Math.max(0, (m.index ?? 0) - 60), (m.index ?? 0) + 60))) assert.equal(Number(m[1]), steps, `${f}: "${m[0]}"`);
    }
  });
});
