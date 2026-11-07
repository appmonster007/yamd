import * as vscode from 'vscode';
import { formatMinutes, minutesByDay, parseLog, stringifyLog } from '../core/study/studylog';
import { formatClock, nextPhase, normalize, phaseMinutes } from '../core/study/pomodoro';
import type { Phase, PomodoroConfig } from '../core/study/pomodoro';
import { readData, todayIso, writeData } from './workspace';

const LOG = 'study-log.json';
const LABEL: Record<Phase, string> = { focus: 'Focus', short: 'Short break', long: 'Long break' };

export async function loadLog() {
  return parseLog(await readData(LOG));
}

async function recordSession(minutes: number, course?: string, when = new Date()): Promise<void> {
  const log = await loadLog();
  log.sessions.push({ date: todayIso(when), minutes, ...(course ? { course } : {}) });
  await writeData(LOG, stringifyLog(log));
}

export function readConfig(): PomodoroConfig {
  const c = vscode.workspace.getConfiguration('yamd.study');
  return normalize({
    focus: c.get('pomodoroMinutes'),
    short: c.get('shortBreakMinutes'),
    long: c.get('longBreakMinutes'),
    every: c.get('sessionsBeforeLongBreak'),
    autoBreaks: c.get('autoStartBreaks'),
    autoFocus: c.get('autoStartFocus'),
    sound: c.get('timerSound'),
    goal: c.get('dailyGoalMinutes'),
  });
}

export interface TimerState {
  active: boolean;
  running: boolean;
  phase: Phase;
  label: string;
  clock: string;
  /** Fraction of the phase that has passed, 0 to 1. */
  progress: number;
  course: string;
  /** Focus blocks done in the current round, and the round's length. */
  done: number;
  every: number;
  todayMinutes: number;
  config: PomodoroConfig;
}

/** A pomodoro timer: focus blocks and breaks, shown in the status bar and the sidebar. Focus time goes to the study log. */
export class StudyTimer implements vscode.Disposable {
  private readonly item = vscode.window.createStatusBarItem(vscode.StatusBarAlignment.Left, 50);
  private ticker: ReturnType<typeof setInterval> | undefined;
  private started = 0;
  /** Milliseconds spent in the current phase before the current run. */
  private banked = 0;
  private target = 0;
  private phase: Phase = 'focus';
  private done = 0;
  private course = '';
  private today = 0;
  private running = false;
  private active = false;
  readonly onChange = new vscode.EventEmitter<void>();
  /** Fired when a phase ends by itself, so the sidebar can chime. */
  readonly onPhaseEnd = new vscode.EventEmitter<void>();
  private readonly sub: vscode.Disposable;

  constructor() {
    this.item.command = 'yamd.studyTimerMenu';
    this.item.name = 'YAMD study timer';
    this.sub = vscode.workspace.onDidChangeConfiguration((e) => {
      if (!e.affectsConfiguration('yamd.study')) return;
      // A changed length applies to the next run, not to one under way.
      if (!this.active) this.target = phaseMinutes(readConfig(), this.phase) * 60_000;
      this.onChange.fire();
    });
    void this.refreshToday();
  }

  private async refreshToday(): Promise<void> {
    try {
      this.today = minutesByDay(await loadLog()).get(todayIso()) ?? 0;
    } catch {
      this.today = 0;
    }
    this.onChange.fire();
  }

  state(): TimerState {
    const config = readConfig();
    const target = this.active ? this.target : phaseMinutes(config, this.phase) * 60_000;
    const elapsed = this.active ? this.elapsed() : 0;
    return {
      active: this.active,
      running: this.running,
      phase: this.phase,
      label: LABEL[this.phase],
      clock: formatClock(target - elapsed),
      progress: target ? Math.min(1, elapsed / target) : 0,
      course: this.course,
      done: this.done,
      every: config.every,
      todayMinutes: this.today,
      config,
    };
  }

  setCourse(course: string) {
    this.course = course;
    this.onChange.fire();
  }

  /** Show a quick-pick menu for the status bar item click. */
  async menu(courseItems: string[] = []): Promise<void> {
    if (!this.active) {
      const dflt = readConfig().focus;
      const options: vscode.QuickPickItem[] = [
        { label: `$(play) Start ${dflt} min session`, description: courseItems[0] ? `(current course: ${courseItems[0]})` : '' },
        ...courseItems.map((c) => ({ label: `$(play) Start for ${c}`, description: c })),
        { label: '$(settings-gear) Change duration…' },
        { label: '$(gear) Timer settings…' },
      ];
      const pick = await vscode.window.showQuickPick(options, { placeHolder: 'Study timer' });
      if (!pick) return;
      if (pick.label.includes('Timer settings')) {
        void vscode.commands.executeCommand('workbench.action.openSettings', 'yamd.study');
      } else if (pick.label.includes('Change duration')) {
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
        { label: '$(debug-step-over) Skip to next phase' },
        { label: '$(check) Finish and log' },
        { label: '$(close) Cancel (no log)' },
      ];
      const pick = await vscode.window.showQuickPick(options, { placeHolder: `Study timer: ${LABEL[this.phase]}` });
      if (!pick) return;
      if (pick.label.includes('Pause') || pick.label.includes('Resume')) this.toggle();
      else if (pick.label.includes('Skip')) await this.skip();
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
    if (course !== undefined) this.course = course;
    if (this.phase !== 'focus') this.phase = 'focus';
    this.begin(this.phase, minutes);
    this.resume();
  }

  private begin(phase: Phase, minutes?: number) {
    this.phase = phase;
    this.target = (minutes ?? phaseMinutes(readConfig(), phase)) * 60_000;
    this.banked = 0;
    this.active = true;
    this.running = false;
    this.item.show();
    this.draw();
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
    if (this.elapsed() >= this.target) void this.advance(true);
    else this.draw();
  }

  private draw() {
    const left = Math.max(0, this.target - this.elapsed());
    const icon = this.phase === 'focus' ? (this.running ? 'watch' : 'debug-pause') : 'coffee';
    this.item.text = `$(${icon}) ${formatClock(left)}${this.course && this.phase === 'focus' ? ` ${this.course}` : ''}`;
    this.item.tooltip = `YAMD ${LABEL[this.phase].toLowerCase()}: click for options`;
    this.onChange.fire();
  }

  /** Ends the current phase, logging focus time, and moves on to the next one. */
  private async advance(completed: boolean): Promise<void> {
    if (!this.active) return;
    const cfg = readConfig();
    const was = this.phase;
    const minutes = Math.round(this.elapsed() / 60_000);
    clearInterval(this.ticker);
    this.running = false;
    if (was === 'focus' && minutes >= 1) {
      await recordSession(minutes, this.course || undefined);
      this.today += minutes;
    }
    // A focus block cut short does not count toward the long break.
    const cut = was === 'focus' && !completed;
    const next = nextPhase(cfg, was, this.done);
    const upcoming: Phase = cut ? 'short' : next.phase;
    if (!cut) this.done = next.done;
    if (completed) {
      this.onPhaseEnd.fire();
      const base =
        was === 'focus'
          ? `Focus done${minutes >= 1 ? `, ${formatMinutes(minutes)} logged` : ''}. Time for a ${upcoming === 'long' ? 'long' : 'short'} break.`
          : 'Break over. Ready to focus?';
      const goal = cfg.goal > 0 && was === 'focus' && this.today >= cfg.goal && this.today - minutes < cfg.goal ? ' Daily goal reached.' : '';
      void vscode.window.showInformationMessage(`YAMD: ${base}${goal}`);
    }
    this.begin(upcoming);
    const auto = upcoming === 'focus' ? cfg.autoFocus : cfg.autoBreaks;
    if (!completed || auto) this.resume();
    this.onChange.fire();
  }

  /** Skips to the next phase. A focus block is logged for the time spent. */
  async skip(): Promise<void> {
    await this.advance(false);
  }

  /** Stops the timer and logs the focused time (at least one minute). */
  async finish(): Promise<void> {
    if (!this.active) return;
    const minutes = this.phase === 'focus' ? Math.round(this.elapsed() / 60_000) : 0;
    clearInterval(this.ticker);
    this.active = this.running = false;
    this.item.hide();
    if (minutes >= 1) {
      await recordSession(minutes, this.course || undefined);
      this.today += minutes;
      void vscode.window.showInformationMessage(`YAMD: ${formatMinutes(minutes)} logged.`);
    }
    this.phase = 'focus';
    this.onChange.fire();
  }

  cancel() {
    clearInterval(this.ticker);
    this.active = this.running = false;
    this.phase = 'focus';
    this.item.hide();
    this.onChange.fire();
  }

  /** Back to the start: no timer running and the round counter cleared. */
  reset() {
    this.cancel();
    this.done = 0;
    this.onChange.fire();
  }

  get isActive(): boolean {
    return this.active;
  }

  get isRunning(): boolean {
    return this.running;
  }

  dispose() {
    clearInterval(this.ticker);
    this.sub.dispose();
    this.item.dispose();
    this.onChange.dispose();
    this.onPhaseEnd.dispose();
  }
}
