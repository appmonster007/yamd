/** The once-a-day reminder: how many cards are due and which deadlines fall today or are overdue. */
export interface ReminderFacts {
  dueCards: number;
  overdue: number;
  dueToday: number;
}

const plural = (n: number, word: string) => `${n} ${word}${n === 1 ? '' : 's'}`;

/** The reminder text, or undefined when there is nothing to remind about. */
export function reminderMessage(f: ReminderFacts): string | undefined {
  const parts: string[] = [];
  if (f.dueCards > 0) parts.push(`${plural(f.dueCards, 'card')} to review`);
  if (f.dueToday > 0) parts.push(`${plural(f.dueToday, 'deadline')} today`);
  if (f.overdue > 0) parts.push(`${f.overdue} overdue`);
  return parts.length ? `YAMD: ${parts.join(', ')}.` : undefined;
}

/** True when the reminder has not been shown on `today` yet. */
export const shouldRemind = (lastShown: string | undefined, today: string) => lastShown !== today;
