/**
 * Naming recordings, writing the link for one, and choosing where in a note the link goes. Pure
 * functions: the recorder, the file writing and the editor edit live in the extension.
 */
const EXTENSIONS: Record<string, string> = {
  'audio/webm': 'webm',
  'video/webm': 'webm',
  'audio/ogg': 'ogg',
  'audio/mp4': 'm4a',
  'audio/mpeg': 'mp3',
  'audio/wav': 'wav',
  'audio/x-wav': 'wav',
};

/** The file extension for a recorder's MIME type (`audio/webm;codecs=opus` gives `webm`). */
export function extensionFor(mime: string): string {
  return EXTENSIONS[mime.split(';')[0]?.trim().toLowerCase() ?? ''] ?? 'webm';
}

const pad = (n: number) => String(n).padStart(2, '0');
const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

/** `note-2026-11-05-1430.webm`, or `…-1430-standup.webm` with a label. */
export function recordingName(now: Date, ext: string, label?: string): string {
  const slug = (label ?? '')
    .toLowerCase()
    .replace(/[^\p{L}\p{N}]+/gu, '-')
    .replace(/^-|-$/g, '')
    .slice(0, 40);
  return `note-${now.getFullYear()}-${pad(now.getMonth() + 1)}-${pad(now.getDate())}-${pad(now.getHours())}${pad(now.getMinutes())}${slug ? `-${slug}` : ''}.${ext}`;
}

/** The name, or `name-2.ext`, `name-3.ext` … until `exists` says it is free. */
export function uniqueName(name: string, exists: (candidate: string) => boolean): string {
  if (!exists(name)) return name;
  const dot = name.lastIndexOf('.');
  const base = dot < 0 ? name : name.slice(0, dot);
  const ext = dot < 0 ? '' : name.slice(dot);
  for (let n = 2; ; n++) {
    const candidate = `${base}-${n}${ext}`;
    if (!exists(candidate)) return candidate;
  }
}

/** `[Recording 5 Nov, 14:30](audio/note-….webm)`, with the path URL-encoded. */
export function linkText(relativePath: string, now: Date, label?: string): string {
  const text = label?.trim() || `Recording ${now.getDate()} ${MONTHS[now.getMonth()]}, ${pad(now.getHours())}:${pad(now.getMinutes())}`;
  const path = relativePath.split('/').map(encodeURIComponent).join('/');
  return `[${text.replace(/[[\]]/g, '')}](${path})`;
}

export { placeBlock as placeLink } from '../editing/placeBlock';
export type { TextEditAt } from '../editing/placeBlock';

export interface ContentChange {
  rangeOffset: number;
  rangeLength: number;
  textLength: number;
}

/** Where `offset` ends up after the document changes (all described against the text before them). */
export function shiftOffset(offset: number, changes: ContentChange[]): number {
  let shifted = offset;
  for (const c of [...changes].sort((a, b) => a.rangeOffset - b.rangeOffset)) {
    if (c.rangeOffset + c.rangeLength <= offset) shifted += c.textLength - c.rangeLength;
    else if (c.rangeOffset < offset) shifted += c.rangeOffset + c.textLength - offset;
  }
  return shifted;
}
