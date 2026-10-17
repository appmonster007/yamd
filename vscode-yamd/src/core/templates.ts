/**
 * Date formatting for daily notes and `{{@...}}` template placeholders.
 * Tokens: YYYY, MM, DD, HH, mm. Everything else is copied as written.
 */
const pad = (n: number) => String(n).padStart(2, '0');

export function formatDate(date: Date, format: string): string {
  return format.replace(/YYYY|MM|DD|HH|mm/g, (token) => {
    switch (token) {
      case 'YYYY':
        return String(date.getFullYear());
      case 'MM':
        return pad(date.getMonth() + 1);
      case 'DD':
        return pad(date.getDate());
      case 'HH':
        return pad(date.getHours());
      default:
        return pad(date.getMinutes());
    }
  });
}

/** Parses a file name written with `format` back into a date, or returns null. */
export function parseDate(text: string, format: string): Date | null {
  const order: string[] = [];
  const pattern = format.replace(/[.*+?^${}()|[\]\\]/g, '\\$&').replace(/YYYY|MM|DD|HH|mm/g, (token) => {
    order.push(token);
    return token === 'YYYY' ? '(\\d{4})' : '(\\d{2})';
  });
  const m = new RegExp(`^${pattern}$`).exec(text);
  if (!m) return null;
  const parts: Record<string, number> = { YYYY: 1970, MM: 1, DD: 1, HH: 0, mm: 0 };
  order.forEach((token, i) => (parts[token] = Number(m[i + 1])));
  const date = new Date(parts['YYYY'] ?? 1970, (parts['MM'] ?? 1) - 1, parts['DD'] ?? 1, parts['HH'] ?? 0, parts['mm'] ?? 0);
  return Number.isNaN(date.getTime()) || formatDate(date, format) !== text ? null : date;
}

/** A YAML scalar for a title: plain when that reads back as the same string, quoted otherwise. */
function yamlString(s: string): string {
  const plain = /^[\p{L}\p{N}][\p{L}\p{N} _.,()'-]*$/u.test(s) && !/^(true|false|null|yes|no|on|off|~|[\d.:+-]+)$/i.test(s);
  return plain ? s : JSON.stringify(s);
}

/** The text of a new note: front matter with its title, today's date and language, then the title as H1. */
export function newNoteText(title: string, now: Date, lang: string): string {
  return `---\ntitle: ${yamlString(title)}\ndate: ${formatDate(now, 'YYYY-MM-DD')}\nlang: ${lang}\n---\n\n# {{ title }}\n\n`;
}

export interface Expanded {
  text: string;
  /** Offset where `{{@cursor}}` was, if the template had one. */
  cursor?: number;
}

/** Expands `{{@date}}`, `{{@date:FORMAT}}`, `{{@time}}`, `{{@title}}` and removes `{{@cursor}}`. */
export function expandPlaceholders(template: string, context: { now: Date; title: string }): Expanded {
  let cursor: number | undefined;
  let text = '';
  let last = 0;
  for (const m of template.matchAll(/\{\{@(\w+)(?::([^}]*))?\}\}/g)) {
    text += template.slice(last, m.index);
    last = m.index + m[0].length;
    const [whole, name, format] = m;
    switch (name) {
      case 'date':
        text += formatDate(context.now, format ?? 'YYYY-MM-DD');
        break;
      case 'time':
        text += formatDate(context.now, format ?? 'HH:mm');
        break;
      case 'title':
        text += context.title;
        break;
      case 'cursor':
        cursor ??= text.length;
        break;
      default:
        text += whole;
    }
  }
  text += template.slice(last);
  return cursor === undefined ? { text } : { text, cursor };
}
