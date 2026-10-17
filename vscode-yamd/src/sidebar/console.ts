// Runs inside the SQL Console view.
export {};

interface VsCodeApi {
  postMessage(message: unknown): void;
  getState(): unknown;
  setState(state: unknown): void;
}
declare function acquireVsCodeApi(): VsCodeApi;

type ToView =
  | { type: 'state'; database: string | null; sqlite: boolean; history: string[]; trusted: boolean }
  | { type: 'result'; html?: string; summary?: string; error?: string; history?: string[] };

const vscode = acquireVsCodeApi();
const $ = <T extends HTMLElement>(id: string) => document.getElementById(id) as T;
const sql = $<HTMLTextAreaElement>('sql');
const run = $<HTMLButtonElement>('run');
const readOnly = $<HTMLInputElement>('ro');
const historySelect = $<HTMLSelectElement>('history');
const status = $('status');
const results = $('results');
const pickerName = $('db-name');
const pickerKind = $('db-kind');
const viewer = $<HTMLButtonElement>('viewer');

const mac = navigator.platform.toLowerCase().includes('mac');
$('run-shortcut').textContent = mac ? '⌘⏎' : 'Ctrl+Enter';

// Keep the draft and the read-only choice when the view is hidden and shown again.
const saved = (vscode.getState() as { sql?: string; readOnly?: boolean } | undefined) ?? {};
sql.value = saved.sql ?? '';
readOnly.checked = saved.readOnly ?? true;
const save = () => vscode.setState({ sql: sql.value, readOnly: readOnly.checked });
sql.addEventListener('input', save);
readOnly.addEventListener('change', () => {
  save();
  run.textContent = '';
  run.append(readOnly.checked ? 'Run' : 'Run (writes allowed)', ' ', Object.assign(document.createElement('span'), { className: 'shortcut', textContent: mac ? '⌘⏎' : 'Ctrl+Enter' }));
});

let history: string[] = [];
let at = -1;

function setStatus(text: string, kind: 'idle' | 'running' | 'error' = 'idle') {
  status.textContent = text;
  status.className = `status${kind === 'idle' ? '' : ` ${kind}`}`;
}

function execute() {
  if (!sql.value.trim()) {
    sql.focus();
    return;
  }
  setStatus('Running…', 'running');
  run.disabled = true;
  vscode.postMessage({ type: 'run', sql: sql.value, readOnly: readOnly.checked });
}

function setHistory(h: string[] | undefined) {
  history = h ?? [];
  historySelect.replaceChildren(new Option(history.length ? 'History' : 'No history', ''));
  for (const q of history) historySelect.add(new Option(q.replace(/\s+/g, ' ').slice(0, 60), q));
  historySelect.disabled = history.length === 0;
}

run.onclick = execute;
$('pick').onclick = () => vscode.postMessage({ type: 'pick' });
viewer.onclick = () => vscode.postMessage({ type: 'openViewer' });
historySelect.onchange = () => {
  if (historySelect.value) {
    sql.value = historySelect.value;
    save();
    sql.focus();
  }
  historySelect.value = '';
};

sql.addEventListener('keydown', (e) => {
  if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) {
    e.preventDefault();
    execute();
    return;
  }
  // Up and Down walk the history while the editor is empty or showing a history entry.
  const browsing = sql.value.trim() === '' || at >= 0;
  if (e.key === 'ArrowUp' && browsing && history.length) {
    e.preventDefault();
    at = Math.min(at + 1, history.length - 1);
    sql.value = history[at] ?? '';
  } else if (e.key === 'ArrowDown' && at >= 0) {
    e.preventDefault();
    at--;
    sql.value = at >= 0 ? (history[at] ?? '') : '';
  } else if (e.key === 'Tab' && !e.shiftKey) {
    e.preventDefault();
    sql.setRangeText('  ', sql.selectionStart, sql.selectionEnd, 'end');
  } else if (e.key.length === 1) at = -1;
});

window.addEventListener('message', (e: MessageEvent<ToView>) => {
  const m = e.data;
  if (m.type === 'state') {
    pickerName.textContent = m.database ?? 'Choose a database…';
    pickerName.classList.toggle('placeholder', !m.database);
    pickerName.title = m.database ?? '';
    pickerKind.textContent = m.database ? (m.sqlite ? 'SQLite' : 'text') : '';
    sql.placeholder = m.database ? 'SELECT * FROM table LIMIT 10' : 'Choose a database, then write SQL here.';
    viewer.hidden = !m.sqlite;
    setHistory(m.history);
    run.disabled = !m.trusted;
    if (!m.trusted) setStatus('The SQL console is disabled in Restricted Mode.', 'error');
  } else {
    run.disabled = false;
    if (m.error) setStatus(m.error, 'error');
    else setStatus(m.summary ?? '');
    results.innerHTML = m.html ?? '';
    if (m.history) setHistory(m.history);
    at = -1;
  }
});

vscode.postMessage({ type: 'ready' });
