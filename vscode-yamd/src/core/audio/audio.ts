/**
 * Naming recordings, writing the link for one, and choosing where in a note the link goes. Pure
 * functions: the recorder, the file writing and the editor edit live in the extension.
 */
import { scanFences } from '../widgets/fences';

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

export interface TextEditAt {
  /** Where the change starts, as an offset into the note. */
  offset: number;
  /** How many characters it replaces. */
  remove: number;
  insert: string;
}

/**
 * Puts `link` on a line of its own, blank lines around it, at `offset`: on the blank line the cursor
 * is on, before the line it starts, or after the line it is inside (and after a code block that
 * contains it, so a fence is never split).
 */
export function placeLink(text: string, offset: number, link: string): TextEditAt {
  const lines = text.split('\n');
  const starts: number[] = [];
  let at = 0;
  for (const l of lines) {
    starts.push(at);
    at += l.length + 1;
  }
  const lineOf = (o: number) => {
    let i = starts.length - 1;
    while (i > 0 && (starts[i] as number) > o) i--;
    return i;
  };
  let line = lineOf(Math.max(0, Math.min(offset, text.length)));
  let column = Math.max(0, Math.min(offset, text.length)) - (starts[line] as number);

  const fence = scanFences(lines).find((f) => f.startLine <= line && line <= f.endLine);
  if (fence) {
    line = fence.endLine;
    column = (lines[line] as string).length;
  }
  const current = lines[line] as string;
  const prevBlank = line === 0 || (lines[line - 1] as string).trim() === '';
  const nextBlank = line + 1 >= lines.length || (lines[line + 1] as string).trim() === '';
  const lineStart = starts[line] as number;

  if (current.trim() === '') {
    return { offset: lineStart, remove: current.length, insert: `${prevBlank ? '' : '\n'}${link}${nextBlank ? '' : '\n'}` };
  }
  if (column === 0 && !fence) {
    return { offset: lineStart, remove: 0, insert: `${prevBlank ? '' : '\n'}${link}\n\n` };
  }
  return { offset: lineStart + current.length, remove: 0, insert: `\n\n${link}${nextBlank ? '' : '\n'}` };
}

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
