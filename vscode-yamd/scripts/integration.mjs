// Runs test-integration/suite.cjs inside VS Code's extension host against a copy of the examples.
// Needs VS Code 1.145+ installed (the `code` CLI is not required).
// Usage: node scripts/integration.mjs [--untrusted]   (--untrusted opens the workspace in Restricted Mode and runs test-integration/restricted.cjs)
import { spawnSync } from 'node:child_process';
import { cpSync, existsSync, mkdtempSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import * as path from 'node:path';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
const repo = path.resolve(here, '..');
const candidates = [
  process.env.VSCODE_EXECUTABLE,
  '/Applications/Visual Studio Code.app/Contents/MacOS/Code',
  '/usr/share/code/code',
  'C:\\Program Files\\Microsoft VS Code\\Code.exe',
].filter(Boolean);
const code = candidates.find((c) => existsSync(c));
if (!code) {
  console.error('VS Code not found. Set VSCODE_EXECUTABLE to its executable.');
  process.exit(2);
}

const untrusted = process.argv.includes('--untrusted');
const work = mkdtempSync(path.join(tmpdir(), 'yamd-qa-'));
const workspace = path.join(work, 'examples');
cpSync(path.resolve(repo, '..', 'examples'), workspace, { recursive: true });
const out = path.join(work, 'results.json');

// If this script itself runs inside an Electron app, VS Code would start as plain Node and reject its options.
const { ELECTRON_RUN_AS_NODE, ...env } = process.env;
void ELECTRON_RUN_AS_NODE;

const run = spawnSync(
  code,
  [
    `--extensionDevelopmentPath=${repo}`,
    `--extensionTestsPath=${path.join(repo, 'test-integration', untrusted ? 'restricted.cjs' : 'suite.cjs')}`,
    `--user-data-dir=${path.join(work, 'user')}`,
    ...(untrusted ? [] : ['--disable-workspace-trust']),
    '--skip-welcome',
    '--skip-release-notes',
    '--disable-telemetry',
    workspace,
  ],
  { env: { ...env, YAMD_QA_OUT: out }, stdio: 'inherit', timeout: 240000 },
);

if (existsSync(out)) {
  const results = JSON.parse(readFileSync(out, 'utf8'));
  for (const r of results) console.log(`${r.ok ? 'ok  ' : 'FAIL'} ${r.name}${r.ok ? '' : `\n       ${r.error}`}`);
  const failed = results.filter((r) => !r.ok).length;
  console.log(`\n${results.length - failed} of ${results.length} checks passed (workspace copy: ${workspace})`);
  process.exit(failed ? 1 : 0);
}
console.error('No results were written; VS Code exited with', run.status, run.signal ?? '');
process.exit(1);
