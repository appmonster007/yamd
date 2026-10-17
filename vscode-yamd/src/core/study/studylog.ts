/** Study sessions (§6.5): a log of timed sessions, with totals, streaks and a heatmap. */
import { addDays, daysBetween } from './cards';

export interface Session {
  /** `YYYY-MM-DD` the session ended. */
  date: string;
  minutes: number;
  course?: string;
}

export interface StudyLog {
  version: 1;
  sessions: Session[];
}

export function parseLog(text: string | undefined): StudyLog {
  try {
    const data = text ? (JSON.parse(text) as Partial<StudyLog>) : undefined;
    if (data && Array.isArray(data.sessions)) {
      const sessions = data.sessions.filter((s): s is Session => !!s && typeof s.date === 'string' && typeof s.minutes === 'number' && s.minutes > 0);
      return { version: 1, sessions };
    }
  } catch {
    // A damaged log starts again.
  }
  return { version: 1, sessions: [] };
}

export function stringifyLog(log: StudyLog): string {
  return `${JSON.stringify(log, null, 1)}\n`;
}

export function minutesByDay(log: StudyLog): Map<string, number> {
  const map = new Map<string, number>();
  for (const s of log.sessions) map.set(s.date, (map.get(s.date) ?? 0) + s.minutes);
  return map;
}

export function minutesByCourse(log: StudyLog, since?: string): Map<string, number> {
  const map = new Map<string, number>();
  for (const s of log.sessions) {
    if (since && s.date < since) continue;
    const key = s.course ?? '(no course)';
    map.set(key, (map.get(key) ?? 0) + s.minutes);
  }
  return map;
}

/** Days in a row with a session, counting back from today (or from yesterday if today has none yet). */
export function streak(log: StudyLog, today: string): number {
  const days = new Set(log.sessions.map((s) => s.date));
  let day = days.has(today) ? today : addDays(today, -1);
  let n = 0;
  while (days.has(day)) {
    n++;
    day = addDays(day, -1);
  }
  return n;
}

export interface HeatCell {
  date: string;
  minutes: number;
  /** 0 (none) to 4 (most). */
  level: 0 | 1 | 2 | 3 | 4;
  future: boolean;
}

/** Weeks as columns of 7 days (Monday first), ending with the week of `today`. */
export function heatmap(log: StudyLog, today: string, weeks = 26): HeatCell[][] {
  const byDay = minutesByDay(log);
  const dow = (new Date(`${today}T00:00:00Z`).getUTCDay() + 6) % 7;
  const start = addDays(today, -dow - 7 * (weeks - 1));
  const level = (m: number): HeatCell['level'] => (m <= 0 ? 0 : m < 30 ? 1 : m < 60 ? 2 : m < 120 ? 3 : 4);
  return Array.from({ length: weeks }, (_, w) =>
    Array.from({ length: 7 }, (_, d) => {
      const date = addDays(start, w * 7 + d);
      const minutes = byDay.get(date) ?? 0;
      return { date, minutes, level: level(minutes), future: daysBetween(today, date) > 0 };
    }),
  );
}

/** The line added to the day's note: `- 14:05 · 25 min · CS101`. */
export function logLine(time: string, minutes: number, course?: string): string {
  return `- ${time} · ${minutes} min${course ? ` · ${course}` : ''}`;
}

export function formatMinutes(m: number): string {
  const h = Math.floor(m / 60);
  return h ? `${h}h ${m % 60}m` : `${m}m`;
}
