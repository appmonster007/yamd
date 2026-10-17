import * as vscode from 'vscode';
import { formatMinutes, logLine, parseLog, stringifyLog } from '../core/study/studylog';
import { appendToDailyNote } from '../workspace/daily';
import { readData, todayIso, writeData } from './workspace';

const LOG = 'study-log.json';

export async function loadLog() {
  return parseLog(await readData(LOG));
}

export async function recordSession(minutes: number, course?: string, when = new Date()): Promise<void> {
  const log = await loadLog();
  log.sessions.push({ date: todayIso(when), minutes, ...(course ? { course } : {}) });
  await writeData(LOG, stringifyLog(log));
  const time = `${String(when.getHours()).padStart(2, '0')}:${String(when.getMinutes()).padStart(2, '0')}`;
  if (vscode.workspace.getConfiguration('yamd.study').get<boolean>('logToDailyNote', true)) {
    await appendToDailyNote(when, 'Study log', logLine(time, minutes, course));
  }
}

/** A focus timer in the status bar. A finished or stopped session is added to the study log. */
export class StudyTimer implements vscode.Disposable {
  private readonly item = vscode.window.createStatusBarItem(vscode.StatusBarAlignment.Left, 50);
  private ticker: ReturnType<typeof setInterval> | undefined;
  private started = 0;
  /** Milliseconds of focus time before the current run. */
  private banked = 0;
  private target = 0;
  private course: string | undefined;
  private running = false;
  private active = false;
  readonly onChange = new vscode.EventEmitter<void>();

  constructor() {
    this.item.command = 'yamd.studyTimerMenu';
    this.item.name = 'YAMD study timer';
  }

  /** Show a quick-pick menu for the status bar item click. */
  async menu(courseItems: string[] = []): Promise<void> {
    if (!this.active) {
      const cfg = vscode.workspace.getConfiguration('yamd.study');
      const dflt = cfg.get<number>('pomodoroMinutes', 25);
      const options: vscode.QuickPickItem[] = [
        { label: `$(play) Start ${dflt} min session`, description: courseItems[0] ? `(current course: ${courseItems[0]})` : '' },
        ...courseItems.map((c) => ({ label: `$(play) Start for ${c}`, description: c })),
        { label: '$(settings-gear) Change duration…' },
      ];
      const pick = await vscode.window.showQuickPick(options, { placeHolder: 'Study timer' });
      if (!pick) return;
      if (pick.label.includes('Change duration')) {
        const input = await vscode.window.showInputBox({ prompt: 'Session length (minutes)', value: String(dflt) });
        if (!input) return;
        const m = parseInt(input, 10);
        if (m > 0) await this.start(undefined, m);
      } else if (pick.description && courseItems.includes(pick.description)) {
        await this.start(pick.description);
      } else {
        await this.start();
      }
    } else {
      const options: vscode.QuickPickItem[] = [
        this.running ? { label: '$(debug-pause) Pause' } : { label: '$(play) Resume' },
        { label: '$(check) Finish and log' },
        { label: '$(close) Cancel (no log)' },
      ];
      const pick = await vscode.window.showQuickPick(options, { placeHolder: 'Study timer' });
      if (!pick) return;
      if (pick.label.includes('Pause') || pick.label.includes('Resume')) this.toggle();
      else if (pick.label.includes('Finish')) await this.finish();
      else this.cancel();
    }
  }

  private elapsed(): number {
    return this.banked + (this.running ? Date.now() - this.started : 0);
  }

  async start(course?: string, minutes?: number): Promise<void> {
    if (this.active) {
      void vscode.window.showInformationMessage('YAMD: A study timer is already running.');
      return;
    }
    const cfg = vscode.workspace.getConfiguration('yamd.study');
    this.target = (minutes ?? cfg.get<number>('pomodoroMinutes', 25)) * 60_000;
    this.course = course;
    this.banked = 0;
    this.active = true;
    this.resume();
    this.item.show();
  }

  private resume() {
    this.started = Date.now();
    this.running = true;
    clearInterval(this.ticker);
    this.ticker = setInterval(() => this.tick(), 1000);
    this.tick();
  }

  pause() {
    if (!this.running) return;
    this.banked = this.elapsed();
    this.running = false;
    clearInterval(this.ticker);
    this.draw();
  }

  toggle() {
    if (!this.active) return;
    if (this.running) this.pause();
    else this.resume();
  }

  private tick() {
    if (this.elapsed() >= this.target) void this.finish(true);
    else this.draw();
  }

  private draw() {
    const left = Math.max(0, this.target - this.elapsed());
    const m = Math.floor(left / 60_000);
    const s = Math.floor((left % 60_000) / 1000);
    this.item.text = `$(${this.running ? 'watch' : 'debug-pause'}) ${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}${this.course ? ` ${this.course}` : ''}`;
    this.item.tooltip = 'YAMD study timer: click for options';
  }

  /** Stops the timer and logs the focused time (at least one minute). */
  async finish(completed = false): Promise<void> {
    if (!this.active) return;
    const minutes = Math.round(this.elapsed() / 60_000);
    clearInterval(this.ticker);
    this.active = this.running = false;
    this.item.hide();
    if (minutes >= 1) {
      await recordSession(minutes, this.course);
      void vscode.window.showInformationMessage(completed ? `YAMD: Session done. ${formatMinutes(minutes)} logged. Take a break.` : `YAMD: ${formatMinutes(minutes)} logged.`);
    }
    this.onChange.fire();
  }

  cancel() {
    clearInterval(this.ticker);
    this.active = this.running = false;
    this.item.hide();
  }

  get isActive(): boolean {
    return this.active;
  }

  get isRunning(): boolean {
    return this.running;
  }

  dispose() {
    clearInterval(this.ticker);
    this.item.dispose();
    this.onChange.dispose();
  }
}
