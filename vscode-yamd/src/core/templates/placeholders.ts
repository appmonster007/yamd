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

export interface Expanded {
  text: string;
  /** Offset where `{{@cursor}}` was, if the template had one. */
  cursor?: number;
}

/**
 * Expands `{{@date}}`, `{{@date:FORMAT}}`, `{{@time}}`, `{{@title}}`, any name given in `vars`
 * (for example `{{@course}}`), and removes `{{@cursor}}`. Unknown names are left as written.
 */
export function expandPlaceholders(template: string, context: { now: Date; title: string; vars?: Record<string, string> }): Expanded {
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
        text += name !== undefined && context.vars && Object.hasOwn(context.vars, name) ? context.vars[name] : whole;
    }
  }
  text += template.slice(last);
  return cursor === undefined ? { text } : { text, cursor };
}
