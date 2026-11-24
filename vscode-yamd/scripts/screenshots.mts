// Renders the extension's real widget HTML and webview script in headless Chrome and saves PNGs to docs/images.
// These are renders of the panel content with VS Code Dark Modern colours, not captures of a VS Code window.
import { execFileSync } from 'node:child_process';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import * as path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import initSqlJs from 'sql.js';
import { parse, render } from '../src/core/markdown';
import { buildNote } from '../src/core/build/build';
import { documentHtml } from '../src/core/export/page';
import { finalizeHtml, prepareExport, renderWidgets } from '../src/core/export/prepare';
import { loadCsv, runQuery } from '../src/core/query/engine';
import { renderQueryResult } from '../src/core/query/views';
import { scanWidgets } from '../src/core/widgets/fences';

const here = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(here, '..');
const examples = path.resolve(root, '..', 'examples');
const out = path.resolve(root, '..', 'docs', 'images');
const tmp = path.resolve(process.env['TMPDIR'] ?? '/tmp', 'yamd-shots');
mkdirSync(out, { recursive: true });
mkdirSync(tmp, { recursive: true });
const CHROME = [process.env['CHROME'], '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome', '/usr/bin/google-chrome', '/usr/bin/google-chrome-stable', '/usr/bin/chromium', '/usr/bin/chromium-browser'].find((c) => c && existsSync(c)) ?? (console.error('Chrome not found. Set CHROME to its executable.'), process.exit(2));
const css = readFileSync(path.join(root, 'media', 'preview.css'), 'utf8');
const script = readFileSync(path.join(root, 'dist', 'preview.js'), 'utf8');
const TODAY = '2026-11-06';

const THEME = `:root{--vscode-editor-foreground:#cccccc;--vscode-editor-background:#1f1f1f;--vscode-textLink-foreground:#4daafc;--vscode-textLink-activeForeground:#4daafc;--vscode-descriptionForeground:#9d9d9d;--vscode-focusBorder:#0078d4;--vscode-panel-border:#2b2b2b;--vscode-input-foreground:#cccccc;--vscode-input-background:#313131;--vscode-textCodeBlock-background:#2b2b2b;--vscode-button-background:#0078d4;--vscode-button-foreground:#ffffff;--vscode-badge-background:#616161;--vscode-badge-foreground:#ffffff;--vscode-editorInfo-foreground:#3794ff;--vscode-editorWarning-foreground:#cca700;--vscode-editorError-foreground:#f85149;--vscode-testing-iconPassed:#73c991;--vscode-font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',sans-serif;--vscode-editor-font-family:Menlo,monospace}body{margin:0;padding:20px 28px;background:var(--vscode-editor-background);color:var(--vscode-editor-foreground);font:14px/1.6 var(--vscode-font-family)}`;

function page(html: string, after = ''): string {
  return `<!doctype html><html><head><meta charset="utf-8"><style>${THEME}${css}</style></head><body class="vscode-dark"><div id="root"></div>
<script>window.acquireVsCodeApi=()=>({postMessage(){},getState(){return undefined},setState(){}});</script>
<script>${script}</script>
<script>window.postMessage({type:'update',html:${JSON.stringify(html)},full:true},'*');setTimeout(()=>{${after}},150);</script></body></html>`;
}

function shot(name: string, html: string, width: number, height: number, after = ''): void {
  const file = path.join(tmp, `${name}.html`);
  writeFileSync(file, page(html, after));
  execFileSync(CHROME, ['--headless=new', '--disable-gpu', '--hide-scrollbars', `--window-size=${width},${height}`, '--virtual-time-budget=4000', `--screenshot=${path.join(out, `${name}.png`)}`, pathToFileURL(file).toString()], { stdio: 'ignore' });
  console.log('wrote', `docs/images/${name}.png`);
}

const block = (file: string, id: string) => {
  const lines = readFileSync(path.join(examples, file), 'utf8').split('\n');
  const w = scanWidgets(lines).find((b) => b.id === id)!;
  return { w, dir: path.dirname(path.join(examples, file)), body: lines.slice(w.bodyStartLine, w.bodyEndLine + 1) };
};
const widgetHtml = (file: string, id: string, today = TODAY) => {
  const b = block(file, id);
  const resolveImage = (src: string) => pathToFileURL(path.resolve(b.dir, src.split(/[?#]/)[0] ?? src)).toString();
  return render(parse(`:::${b.w.type}\n${b.body.join('\n')}\n:::`), { interactive: true, today, resolveImage });
};
const pad = (s: string) => `<h2 style="margin:0 0 12px;font-size:15px;color:var(--vscode-descriptionForeground)">${s}</h2>`;

// Widgets
const kanban = widgetHtml('02-widgets/kanban.md', 'sprint-12');
shot('kanban', kanban, 1180, 640);
shot('kanban-details', kanban, 1180, 760, `document.querySelector('.kanban-card[data-details] .card-edit').click()`);
shot('kanban-filter', kanban, 1180, 520, `const f=document.querySelector('.board-filter');f.value='@ada';f.dispatchEvent(new Event('input'))`);
shot('calendar', widgetHtml('02-widgets/calendar.md', 'december'), 1180, 1080);
shot('timeline', widgetHtml('02-widgets/timeline.md', 'q1-roadmap', '2026-01-05'), 1180, 440);
const gallery = widgetHtml('02-widgets/gallery.md', 'sketches');
shot('gallery', gallery, 1180, 520);
shot('gallery-enlarged', gallery, 1180, 620, `document.querySelector('.db-card img').click()`);

// Queries
const SQL = await initSqlJs();
const bugs = loadCsv(SQL, 'bugs.csv', readFileSync(path.join(examples, '03-queries', 'bugs.csv'), 'utf8'));
const q = (sql: string, o: Parameters<typeof renderQueryResult>[1]) => renderQueryResult(runQuery(bugs, sql), o);
const queries = `${pad('table')}${q("SELECT id, title, owner, days_open FROM bugs WHERE status = 'open' ORDER BY days_open DESC", { view: 'table' })}<br>${pad('chart')}${q('SELECT owner, COUNT(*) AS n FROM bugs GROUP BY owner', { view: 'chart', type: 'bar', x: 'owner', y: 'n' })}<br>${pad('board')}${q('SELECT title, owner, status FROM bugs', { view: 'board', group: 'status' })}`;
shot('queries', queries, 1180, 1100);

// A built, exported note
const lines = readFileSync(path.join(examples, '01-writing', 'callouts.md'), 'utf8').split('\n');
const prepared = prepareExport(buildNote(lines).lines);
const blocks = renderWidgets(prepared.widgets, {});
const doc = finalizeHtml(documentHtml(parse(prepared.source, 'gfm'), { css, render: { softBreaks: 'newline' }, readOnly: false, footer: '', titlePage: false, toc: false }), blocks)
  .replace(/src="\.\.\/assets\//g, `src="${pathToFileURL(path.join(examples, 'assets')).toString()}/`);
const docFile = path.join(tmp, 'export.html');
writeFileSync(docFile, doc);
execFileSync(CHROME, ['--headless=new', '--disable-gpu', '--hide-scrollbars', '--window-size=1000,1100', '--virtual-time-budget=3000', `--screenshot=${path.join(out, 'export.png')}`, pathToFileURL(docFile).toString()], { stdio: 'ignore' });
console.log('wrote docs/images/export.png');
