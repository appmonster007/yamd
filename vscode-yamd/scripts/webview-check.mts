// Drives the real panel script (dist/preview.js) in headless Chrome with a stubbed VS Code API and checks
// what it posts back for clicks, drags, keys and forms. Usage: node --import tsx scripts/webview-check.mts
import { execFileSync } from 'node:child_process';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import * as path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { parse, render } from '../src/core/markdown';
import { scanWidgets } from '../src/core/widgets/fences';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const examples = path.resolve(root, '..', 'examples');
const tmp = path.resolve(process.env['TMPDIR'] ?? '/tmp', 'yamd-webcheck');
mkdirSync(tmp, { recursive: true });
const CHROME = [process.env['CHROME'], '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome', '/usr/bin/google-chrome', '/usr/bin/google-chrome-stable', '/usr/bin/chromium', '/usr/bin/chromium-browser'].find((c) => c && existsSync(c)) ?? (console.error('Chrome not found. Set CHROME to its executable.'), process.exit(2));
const css = readFileSync(path.join(root, 'media', 'preview.css'), 'utf8');
const script = readFileSync(path.join(root, 'dist', 'preview.js'), 'utf8').replace(/<\/script/gi, '<\\/script');

function widget(file: string, id: string, today: string): string {
  const lines = readFileSync(path.join(examples, file), 'utf8').split('\n');
  const w = scanWidgets(lines).find((b) => b.id === id)!;
  const dir = path.dirname(path.join(examples, file));
  const resolveImage = (src: string) => pathToFileURL(path.resolve(dir, src.split(/[?#]/)[0] ?? src)).toString();
  return render(parse(`:::${w.type}\n${lines.slice(w.bodyStartLine, w.bodyEndLine + 1).join('\n')}\n:::`), { interactive: true, today, resolveImage });
}

/** Runs `body` (which may use `check`, `posts`, `show`, `sleep`) against a page showing `html`; returns the checks. */
function run(name: string, html: string, body: string): { name: string; ok: boolean; detail: string }[] {
  const file = path.join(tmp, `${name}.html`);
  writeFileSync(
    file,
    `<!doctype html><html><head><meta charset="utf-8"><style>body{margin:0;padding:20px;width:1100px}${css}</style></head><body class="vscode-dark"><div id="root"></div>
<script>window.__posts=[];window.acquireVsCodeApi=()=>({postMessage(m){window.__posts.push(m)},getState(){return undefined},setState(){}});</script>
<script>${script}</script>
<script>
const results=[];const sleep=(ms)=>new Promise(r=>setTimeout(r,ms));
const check=(n,c,d)=>results.push({name:n,ok:!!c,detail:c?'':String(d??'')});
const posts=()=>window.__posts.splice(0);
const show=async()=>{window.postMessage({type:'update',html:${JSON.stringify(html)},full:true},'*');await sleep(60)};
const $=(s,r=document)=>r.querySelector(s);const $$=(s,r=document)=>Array.from(r.querySelectorAll(s));
const drag=(el,type,opts={})=>el.dispatchEvent(new DragEvent(type,{bubbles:true,cancelable:true,dataTransfer:new DataTransfer(),...opts}));
(async()=>{try{await show();${body}}catch(e){check('script ran to the end',false,e&&e.stack||e)}const out=document.createElement('pre');out.id='result';out.textContent=JSON.stringify(results);document.body.append(out)})();
</script></body></html>`,
  );
  const dom = execFileSync(CHROME, [...(process.env['CI'] ? ['--no-sandbox'] : []), '--headless=new', '--disable-gpu', '--window-size=1180,1000', '--virtual-time-budget=8000', '--dump-dom', pathToFileURL(file).toString()], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] });
  const m = /<pre id="result">([\s\S]*?)<\/pre>/.exec(dom);
  if (!m) return [{ name: `${name}: page produced no result`, ok: false, detail: 'no #out' }];
  return JSON.parse((m[1] as string).replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&amp;/g, '&')) as { name: string; ok: boolean; detail: string }[];
}

const all: { name: string; ok: boolean; detail: string }[] = [];

all.push(...run('kanban', widget('02-widgets/kanban.md', 'sprint-12', '2026-11-06'), `
  const card = $$('.kanban-card').find(c => c.textContent.includes('Export a board as CSV'));
  const doing = $$('.kanban-column')[2];
  // Drag a card into the Doing column, above its first card.
  const firstDoing = $('.kanban-card', doing);
  const y = firstDoing.getBoundingClientRect().top - 4;
  drag(card, 'dragstart');
  drag($('.kanban-cards', doing), 'dragover', {clientY: y});
  drag($('.kanban-cards', doing), 'drop', {clientY: y});
  drag(card, 'dragend');
  let p = posts().filter(m => m.type === 'boardEdit');
  check('drag to another column posts a kanban move', p.length === 1 && p[0].kind === 'kanban' && p[0].op === 'move' && p[0].args.toColumn === 2 && p[0].args.toIndex === 0 && p[0].card && p[0].card.hash, JSON.stringify(p));
  check('the card moved in the page at once', $$('.kanban-card', doing)[0].textContent.includes('Export a board as CSV'));

  await show();
  const c2 = $$('.kanban-card').find(c => c.textContent.includes('Dark mode for the widgets'));
  c2.dispatchEvent(new KeyboardEvent('keydown', {key: 'ArrowRight', altKey: true, bubbles: true}));
  p = posts().filter(m => m.type === 'boardEdit');
  check('Alt+Right moves a card to the next column', p.length === 1 && p[0].op === 'move' && p[0].args.toColumn === 2, JSON.stringify(p));

  await show();
  const box = $('.task-toggle');
  box.checked = true; box.dispatchEvent(new Event('change', {bubbles: true}));
  p = posts().filter(m => m.type === 'boardEdit');
  check('ticking a task posts task toggle', p.length === 1 && p[0].kind === 'task' && p[0].op === 'toggle' && p[0].args.done === true && p[0].card.hash, JSON.stringify(p));

  await show();
  const form = $$('.kanban-add')[1]; const input = $('.kanban-add-input', form);
  input.value = 'New thing'; form.dispatchEvent(new Event('submit', {bubbles: true, cancelable: true}));
  p = posts().filter(m => m.type === 'boardEdit');
  check('adding a card posts kanban add with the column and text', p.length === 1 && p[0].op === 'add' && p[0].args.column === 1 && p[0].args.text === 'New thing', JSON.stringify(p));

  await show();
  const titled = $$('.kanban-card').find(c => c.textContent.includes('Keyboard shortcut cheat sheet'));
  titled.querySelector('.kanban-card-text').dispatchEvent(new MouseEvent('dblclick', {bubbles: true}));
  const edit = $('.kanban-title-input');
  check('double-clicking a title opens an input with the title', edit && edit.value === 'Keyboard shortcut cheat sheet', edit && edit.value);
  edit.value = 'Shortcut sheet';
  edit.dispatchEvent(new KeyboardEvent('keydown', {key: 'Enter', bubbles: true}));
  p = posts().filter(m => m.type === 'boardEdit');
  check('Enter posts a rename', p.length === 1 && p[0].op === 'rename' && p[0].args.title === 'Shortcut sheet', JSON.stringify(p));

  await show();
  const col = $$('.kanban-column')[0];
  $('.kanban-collapse', col).click();
  check('a column collapses', col.classList.contains('collapsed'));
  $('.kanban-collapse', col).click();
  check('and expands again', !col.classList.contains('collapsed'));

  await show();
  const target = $$('.kanban-card').find(c => c.textContent.includes('Fix login on Safari'));
  $('.card-edit', target).click();
  const f = $('.details-form');
  check('the pencil opens the details form with the current values', f && f.querySelector('input[name=owner]').value === 'ada' && f.querySelector('input[name=due]').value === '2026-12-10' && f.querySelector('textarea').value.includes('Users get logged out'), f && f.outerHTML.slice(0, 300));
  f.querySelector('input[name=owner]').value = 'grace';
  f.querySelector('input[name=tags]').value = '#bug urgent';
  f.querySelector('textarea').value = 'Changed note';
  f.dispatchEvent(new Event('submit', {bubbles: true, cancelable: true}));
  p = posts().filter(m => m.type === 'boardEdit');
  check('saving the form posts the details', p.length === 1 && p[0].op === 'details' && p[0].args.owner === 'grace' && p[0].args.tags === '#bug urgent' && p[0].args.body === 'Changed note' && p[0].args.due === '2026-12-10', JSON.stringify(p));
  check('the form closes after saving', !$('.details-form'));
  $('.card-edit', target).click();
  $('.details-form').dispatchEvent(new KeyboardEvent('keydown', {key: 'Escape', bubbles: true}));
  check('Escape closes the form without posting', !$('.details-form') && posts().filter(m => m.type === 'boardEdit').length === 0);

  await show();
  const filter = $('.board-filter');
  const visible = () => $$('.kanban-card').filter(c => !c.classList.contains('filtered-out')).length;
  const total = $$('.kanban-card').length;
  filter.value = '@ada'; filter.dispatchEvent(new Event('input'));
  const adaCards = $$('.kanban-card').filter(c => c.dataset.owner === 'ada').length;
  check('@owner filter shows only that owner', adaCards > 0 && visible() === adaCards, visible() + ' of ' + total + ' visible, ' + adaCards + ' by ada');
  filter.value = 'login'; filter.dispatchEvent(new Event('input'));
  check('a text filter matches card text', visible() === 1, visible());
  filter.value = '@ada login'; filter.dispatchEvent(new Event('input'));
  check('terms combine', visible() === 1, visible());
  filter.value = '#nothing'; filter.dispatchEvent(new Event('input'));
  check('a tag that nothing has hides everything', visible() === 0, visible());
  filter.value = '@ada'; filter.dispatchEvent(new Event('input'));
  await show();
  check('the filter text survives a refresh of the page', $('.board-filter').value === '@ada' && visible() === adaCards, $('.board-filter').value + ' / ' + visible());
  $('.board-filter').value = ''; $('.board-filter').dispatchEvent(new Event('input'));
  check('clearing the filter shows everything', visible() === total);
`));

all.push(...run('calendar', widget('02-widgets/calendar.md', 'december', '2026-12-10'), `
  check('opens on December 2026', $('.db-month-title').textContent.includes('December 2026'), $('.db-month-title').textContent);
  $('.db-month-nav[data-delta="1"]').click();
  let p = posts().filter(m => m.type === 'calendarMonth');
  check('next month asks the extension for 2027-01', p.length === 1 && p[0].month === '2027-01', JSON.stringify(p));
  $('.db-month-nav[data-delta="-1"]').click();
  p = posts().filter(m => m.type === 'calendarMonth');
  check('previous month asks for 2026-11', p.length === 1 && p[0].month === '2026-11', JSON.stringify(p));
  const event = $$('.db-day .db-event').find(e => e.textContent.includes('Team sync'));
  const day = $('.db-day[data-date="2026-12-15"]');
  drag(event, 'dragstart');
  drag(day, 'dragover');
  drag(day, 'drop');
  drag(event, 'dragend');
  const moved = posts().filter(m => m.type === 'boardEdit');
  check('dragging an event to another day posts a calendar move with the date', moved.length === 1 && moved[0].kind === 'calendar' && moved[0].op === 'move' && moved[0].args.toDate === '2026-12-15', JSON.stringify(moved));
  event.dispatchEvent(new KeyboardEvent('keydown', {key: 'ArrowRight', altKey: true, bubbles: true}));
  const nudged = posts().filter(m => m.type === 'boardEdit');
  check('Alt+Right moves an event one day later', nudged.length === 1 && nudged[0].args.toDate === '2026-12-09', JSON.stringify(nudged));
  const agendaEvent = $('.db-agenda .db-event[data-details]');
  check('agenda events carry details and a pencil', agendaEvent && $('.card-edit', agendaEvent));
  $('.card-edit', agendaEvent).click();
  check('the pencil opens the form on a calendar', $('.details-form') && !$('.details-form input[name=start]'));
  check('a past, unfinished event is overdue', $$('.db-event.overdue').length > 0);
`));

all.push(...run('timeline', widget('02-widgets/timeline.md', 'q1-roadmap', '2026-02-10'), `
  const item = $('.db-timeline-item[data-details]');
  check('timeline items carry details', item && $('.card-edit', item));
  $('.card-edit', item).click();
  const f = $('.details-form');
  check('the timeline form has a Start field with the date', f && f.querySelector('input[name=start]') && /^\\d{4}-\\d{2}-\\d{2}$/.test(f.querySelector('input[name=start]').value), f && f.outerHTML.slice(0, 200));
  f.querySelector('input[name=owner]').value = 'zed';
  f.dispatchEvent(new Event('submit', {bubbles: true, cancelable: true}));
  const p = posts().filter(m => m.type === 'boardEdit');
  check('saving posts a timeline details edit', p.length === 1 && p[0].kind === 'timeline' && p[0].op === 'details' && p[0].args.owner === 'zed' && p[0].args.start, JSON.stringify(p));
  check('bars past their end are overdue', $$('.db-timeline-bar.overdue').length > 0 && $$('.db-timeline-bar:not(.overdue)').length > 0);
`));

all.push(...run('gallery', widget('02-widgets/gallery.md', 'sketches', '2026-11-06'), `
  const img = $('.db-card img');
  img.click();
  const box = $('.lightbox');
  check('clicking an image enlarges it', box && $('img', box).src === img.src, box && box.outerHTML.slice(0, 120));
  document.dispatchEvent(new KeyboardEvent('keydown', {key: 'Escape'}));
  check('Escape closes the enlarged view', !$('.lightbox'));
  img.click(); $('.lightbox').click();
  check('clicking the enlarged view closes it', !$('.lightbox'));
  $('.gallery-pick').click();
  check('Choose images asks the extension for the picker', posts().some(m => m.type === 'pickImage'));
  const cards = $$('.db-card');
  const gal = $('.db-gallery');
  const last = cards[cards.length - 1].getBoundingClientRect();
  drag(cards[0], 'dragstart');
  drag(gal, 'dragover', {clientX: last.right + 10, clientY: last.bottom + 10});
  drag(gal, 'drop', {clientX: last.right + 10, clientY: last.bottom + 10});
  drag(cards[0], 'dragend');
  const p = posts().filter(m => m.type === 'boardEdit');
  check('dragging an image to the end posts a gallery move', p.length === 1 && p[0].kind === 'gallery' && p[0].op === 'move' && p[0].args.toIndex === cards.length - 1, JSON.stringify(p));
  const form = $('.gallery-add');
  $('.gallery-add-image', form).value = 'new.png'; $('.gallery-add-caption', form).value = 'New';
  form.dispatchEvent(new Event('submit', {bubbles: true, cancelable: true}));
  const q = posts().filter(m => m.type === 'boardEdit');
  check('adding an image posts the path and caption', q.length === 1 && q[0].op === 'add' && q[0].args.image === 'new.png' && q[0].args.caption === 'New', JSON.stringify(q));
`));

let failed = 0;
for (const r of all) {
  if (!r.ok) failed++;
  console.log(`${r.ok ? 'ok  ' : 'FAIL'} ${r.name}${r.ok ? '' : `\n       ${r.detail}`}`);
}
console.log(`\n${all.length - failed} of ${all.length} panel checks passed`);
process.exit(failed ? 1 : 0);
