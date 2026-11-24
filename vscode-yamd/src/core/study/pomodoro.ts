/** Pomodoro cycles: focus blocks separated by short breaks, with a long break after a few of them. */
export type Phase = 'focus' | 'short' | 'long';

export interface PomodoroConfig {
  focus: number;
  short: number;
  long: number;
  /** Focus blocks before a long break. */
  every: number;
  autoBreaks: boolean;
  autoFocus: boolean;
  sound: boolean;
  /** Daily focus goal in minutes; 0 turns it off. */
  goal: number;
}

export const DEFAULTS: PomodoroConfig = { focus: 25, short: 5, long: 15, every: 4, autoBreaks: true, autoFocus: false, sound: true, goal: 0 };

function num(v: unknown, d: number, min: number, max: number): number {
  const n = typeof v === 'number' && Number.isFinite(v) ? Math.round(v) : d;
  return Math.min(max, Math.max(min, n));
}

function bool(v: unknown, d: boolean): boolean {
  return typeof v === 'boolean' ? v : d;
}

/** Fills gaps and clamps every value to a sensible range. */
export function normalize(raw: Partial<Record<keyof PomodoroConfig, unknown>> = {}): PomodoroConfig {
  return {
    focus: num(raw.focus, DEFAULTS.focus, 1, 240),
    short: num(raw.short, DEFAULTS.short, 1, 60),
    long: num(raw.long, DEFAULTS.long, 1, 120),
    every: num(raw.every, DEFAULTS.every, 2, 12),
    autoBreaks: bool(raw.autoBreaks, DEFAULTS.autoBreaks),
    autoFocus: bool(raw.autoFocus, DEFAULTS.autoFocus),
    sound: bool(raw.sound, DEFAULTS.sound),
    goal: num(raw.goal, DEFAULTS.goal, 0, 1440),
  };
}

export function phaseMinutes(cfg: PomodoroConfig, phase: Phase): number {
  return cfg[phase];
}

/** The phase after `phase` ends, and how many focus blocks of the current round are done. */
export function nextPhase(cfg: PomodoroConfig, phase: Phase, done: number): { phase: Phase; done: number } {
  if (phase !== 'focus') return { phase: 'focus', done: phase === 'long' ? 0 : done };
  const n = done + 1;
  return n >= cfg.every ? { phase: 'long', done: n } : { phase: 'short', done: n };
}

export function formatClock(ms: number): string {
  const total = Math.max(0, Math.ceil(ms / 1000));
  return `${String(Math.floor(total / 60)).padStart(2, '0')}:${String(total % 60).padStart(2, '0')}`;
}
