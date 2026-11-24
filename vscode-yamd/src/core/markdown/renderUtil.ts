/** Small helpers shared by the renderer and its board renderers. */
const NEEDS_ESCAPE = /[&<>"']/;
const ESCAPES: Record<string, string> = { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' };

/** Most strings have nothing to escape, so they are returned as they are; the rest take one pass. */
export function escapeHtml(s: string): string {
  return NEEDS_ESCAPE.test(s) ? s.replace(/[&<>"']/g, (c) => ESCAPES[c] as string) : s;
}

/** Applies the URL scheme allow-list from yamd-spec.md section 9. Returns null if the URL is unsafe. */
export function sanitizeUrl(url: string, forImage = false): string | null {
  const u = url.trim();
  const scheme = /^([a-z][a-z0-9+.-]*):/i.exec(u.replace(/[\u0000- ]/g, ''))?.[1]?.toLowerCase();
  if (scheme === undefined) return u;
  if (['http', 'https', 'mailto', 'tel'].includes(scheme)) return u;
  if (forImage && /^data:image\/(png|gif|jpe?g|webp|svg\+xml);/i.test(u)) return u;
  return null;
}

export function today(): string {
  const d = new Date();
  const p = (n: number) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`;
}

/** ISO 8601 week number (weeks start Monday; week 1 is the one containing the year's first Thursday). */
export function isoWeek(iso: string): number {
  const d = new Date(`${iso}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() - ((d.getUTCDay() + 6) % 7) + 3);
  const firstThursday = new Date(Date.UTC(d.getUTCFullYear(), 0, 4));
  firstThursday.setUTCDate(firstThursday.getUTCDate() - ((firstThursday.getUTCDay() + 6) % 7) + 3);
  return 1 + Math.round((d.getTime() - firstThursday.getTime()) / (7 * 86400000));
}
