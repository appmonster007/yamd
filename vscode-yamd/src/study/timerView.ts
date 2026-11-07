import * as vscode from 'vscode';
import { nonce } from '../extension/shared/webviewShell';
import type { StudyTimer } from './timer';

/** Settings the sidebar may change, by the message field that names them. */
const SETTINGS: Record<string, { key: string; kind: 'number' | 'boolean' }> = {
  focus: { key: 'pomodoroMinutes', kind: 'number' },
  short: { key: 'shortBreakMinutes', kind: 'number' },
  long: { key: 'longBreakMinutes', kind: 'number' },
  every: { key: 'sessionsBeforeLongBreak', kind: 'number' },
  goal: { key: 'dailyGoalMinutes', kind: 'number' },
  autoBreaks: { key: 'autoStartBreaks', kind: 'boolean' },
  autoFocus: { key: 'autoStartFocus', kind: 'boolean' },
  sound: { key: 'timerSound', kind: 'boolean' },
};

const CSS = `
body{font-family:var(--vscode-font-family);color:var(--vscode-foreground);padding:8px 12px;font-size:var(--vscode-font-size)}
.ring{position:relative;width:160px;height:160px;margin:8px auto}
.ring svg{transform:rotate(-90deg)}
.ring .t{position:absolute;inset:0;display:flex;flex-direction:column;align-items:center;justify-content:center}
.clock{font-size:2em;font-variant-numeric:tabular-nums;font-weight:600}
.phase{opacity:.75}
.row{display:flex;gap:6px;justify-content:center;margin:8px 0;flex-wrap:wrap}
button{background:var(--vscode-button-background);color:var(--vscode-button-foreground);border:0;padding:4px 12px;cursor:pointer;border-radius:2px}
button.s{background:var(--vscode-button-secondaryBackground);color:var(--vscode-button-secondaryForeground)}
button:hover{opacity:.9}
button:disabled{opacity:.4;cursor:default}
.dots{text-align:center;letter-spacing:4px;min-height:1.2em}
.meta{text-align:center;opacity:.75;margin:4px 0}
.bar{height:4px;background:var(--vscode-progressBar-background);opacity:.25;border-radius:2px}
.bar i{display:block;height:100%;background:var(--vscode-progressBar-background);border-radius:2px}
details{margin-top:12px}summary{cursor:pointer;opacity:.85}
label{display:flex;justify-content:space-between;align-items:center;margin:6px 0;gap:8px}
input[type=number],select{background:var(--vscode-input-background);color:var(--vscode-input-foreground);border:1px solid var(--vscode-input-border,transparent);padding:2px 4px;width:70px}
select{width:120px}`;

/** The Focus Timer in the YAMD sidebar: a pomodoro dial with controls and its settings. */
export class TimerView implements vscode.WebviewViewProvider, vscode.Disposable {
  private view: vscode.WebviewView | undefined;
  private readonly subs: vscode.Disposable[] = [];

  constructor(
    private readonly timer: StudyTimer,
    private readonly courses: () => string[],
  ) {
    this.subs.push(
      timer.onChange.event(() => this.push()),
      timer.onPhaseEnd.event(() => void this.view?.webview.postMessage({ type: 'chime' })),
    );
  }

  resolveWebviewView(view: vscode.WebviewView): void {
    this.view = view;
    view.webview.options = { enableScripts: true };
    const n = nonce();
    view.webview.html = this.html(n);
    view.webview.onDidReceiveMessage((m: { type: string; field?: string; value?: unknown; course?: string }) => void this.onMessage(m));
    view.onDidChangeVisibility(() => view.visible && this.push());
    view.onDidDispose(() => (this.view = undefined));
    this.push();
  }

  private async onMessage(m: { type: string; field?: string; value?: unknown; course?: string }): Promise<void> {
    switch (m.type) {
      case 'ready':
        this.push();
        break;
      case 'start':
        if (m.course !== undefined) this.timer.setCourse(m.course);
        await this.timer.start();
        break;
      case 'toggle':
        this.timer.toggle();
        break;
      case 'skip':
        await this.timer.skip();
        break;
      case 'finish':
        await this.timer.finish();
        break;
      case 'reset':
        this.timer.reset();
        break;
      case 'course':
        this.timer.setCourse(typeof m.course === 'string' ? m.course : '');
        break;
      case 'set': {
        const s = m.field ? SETTINGS[m.field] : undefined;
        if (!s || typeof m.value !== s.kind) break;
        await vscode.workspace.getConfiguration('yamd.study').update(s.key, m.value, vscode.ConfigurationTarget.Global);
        break;
      }
    }
  }

  private push(): void {
    if (!this.view?.visible) return;
    void this.view.webview.postMessage({ type: 'state', state: this.timer.state(), courses: this.courses() });
  }

  dispose(): void {
    this.subs.forEach((d) => d.dispose());
  }

  private html(n: string): string {
    return `<!DOCTYPE html><html lang="en"><head><meta charset="UTF-8"><meta http-equiv="Content-Security-Policy" content="default-src 'none'; style-src 'unsafe-inline'; script-src 'nonce-${n}'"><style>${CSS}</style></head><body>
<div class="ring"><svg width="160" height="160" viewBox="0 0 160 160"><circle cx="80" cy="80" r="70" fill="none" stroke="var(--vscode-progressBar-background)" stroke-opacity=".2" stroke-width="8"/><circle id="arc" cx="80" cy="80" r="70" fill="none" stroke="var(--vscode-progressBar-background)" stroke-width="8" stroke-linecap="round" stroke-dasharray="439.8" stroke-dashoffset="439.8"/></svg><div class="t"><div class="clock" id="clock">25:00</div><div class="phase" id="phase">Focus</div></div></div>
<div class="dots" id="dots" title="Focus blocks done in this round"></div>
<div class="row"><button id="go">Start</button><button class="s" id="skip" title="Skip to the next phase">Skip</button><button class="s" id="finish" title="Stop and log the focus time">Finish</button><button class="s" id="reset" title="Cancel without logging and clear the round">Reset</button></div>
<label>Course <select id="course"></select></label>
<div class="meta" id="today"></div><div class="bar" id="goalbar" hidden><i id="goalfill"></i></div>
<details><summary>Customise</summary>
<label>Focus (min)<input type="number" min="1" max="240" data-f="focus"></label>
<label>Short break (min)<input type="number" min="1" max="60" data-f="short"></label>
<label>Long break (min)<input type="number" min="1" max="120" data-f="long"></label>
<label>Blocks before long break<input type="number" min="2" max="12" data-f="every"></label>
<label>Daily goal (min, 0 = off)<input type="number" min="0" max="1440" data-f="goal"></label>
<label>Start breaks automatically<input type="checkbox" data-f="autoBreaks"></label>
<label>Start focus automatically<input type="checkbox" data-f="autoFocus"></label>
<label>Chime when a phase ends<input type="checkbox" data-f="sound"></label>
</details>
<script nonce="${n}">
const v = acquireVsCodeApi(); const $ = (id) => document.getElementById(id); let last;
function chime(){ try { const c = new AudioContext(); [660, 880].forEach((f, i) => { const o = c.createOscillator(), g = c.createGain(); o.frequency.value = f; o.connect(g); g.connect(c.destination); const t = c.currentTime + i * 0.25; g.gain.setValueAtTime(0.15, t); g.gain.exponentialRampToValueAtTime(0.001, t + 0.22); o.start(t); o.stop(t + 0.25); }); } catch {} }
function render(m){
  const s = m.state; last = s;
  $('clock').textContent = s.clock; $('phase').textContent = s.label + (s.active && !s.running ? ' (paused)' : '');
  $('arc').setAttribute('stroke-dashoffset', String(439.8 * (1 - s.progress)));
  $('go').textContent = s.running ? 'Pause' : s.active ? 'Resume' : 'Start';
  $('skip').disabled = $('finish').disabled = !s.active;
  $('dots').textContent = Array.from({ length: s.every }, (_, i) => i < s.done ? '●' : '○').join(' ');
  const sel = $('course'); sel.disabled = s.active && s.phase === 'focus';
  if (document.activeElement !== sel) { sel.innerHTML = ''; for (const c of ['', ...m.courses]) { const o = document.createElement('option'); o.value = c; o.textContent = c || '(no course)'; if (c === s.course) o.selected = true; sel.appendChild(o); } }
  const g = s.config.goal; $('today').textContent = 'Today: ' + s.todayMinutes + ' min' + (g ? ' of ' + g : '');
  $('goalbar').hidden = !g; $('goalfill').style.width = g ? Math.min(100, (100 * s.todayMinutes) / g) + '%' : '0';
  document.querySelectorAll('[data-f]').forEach((el) => { if (document.activeElement === el) return; const val = s.config[el.dataset.f]; if (el.type === 'checkbox') el.checked = !!val; else el.value = val; });
}
window.addEventListener('message', (e) => { if (e.data.type === 'state') render(e.data); else if (e.data.type === 'chime' && last && last.config.sound) chime(); });
$('go').onclick = () => v.postMessage(last && last.active ? { type: 'toggle' } : { type: 'start', course: $('course').value });
$('skip').onclick = () => v.postMessage({ type: 'skip' });
$('finish').onclick = () => v.postMessage({ type: 'finish' });
$('reset').onclick = () => v.postMessage({ type: 'reset' });
$('course').onchange = (e) => v.postMessage({ type: 'course', course: e.target.value });
document.querySelectorAll('[data-f]').forEach((el) => el.addEventListener('change', () => { const value = el.type === 'checkbox' ? el.checked : Number(el.value); if (el.type !== 'checkbox' && !Number.isFinite(value)) return; v.postMessage({ type: 'set', field: el.dataset.f, value }); }));
v.postMessage({ type: 'ready' });
</script></body></html>`;
  }
}
