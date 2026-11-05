/** Transcripts of recordings: finding the audio link, running a user-chosen tool and placing the text under the link. */
const AUDIO = /\.(webm|ogg|oga|mp3|m4a|wav|flac|opus|aac)$/i;
const LINK = /\[[^\]]*\]\(([^)\s]+)\)/g;
export const TRANSCRIPT_TITLE = 'Transcript';

/** Audio files linked on a line: their path as written (decoded) and the line number. */
export function audioLinks(lines: string[]): { line: number; path: string }[] {
  const out: { line: number; path: string }[] = [];
  let fenced = false;
  lines.forEach((text, line) => {
    if (/^\s*(```|~~~)/.test(text)) fenced = !fenced;
    if (fenced) return;
    for (const m of text.matchAll(LINK)) {
      const raw = m[1] as string;
      if (/^[a-z][a-z0-9+.-]*:/i.test(raw)) continue;
      let path = raw;
      try {
        path = decodeURI(raw);
      } catch {
        /* keep as written */
      }
      if (AUDIO.test(path.split(/[?#]/)[0] ?? '')) out.push({ line, path });
    }
  });
  return out;
}

/** Splits a command line into words, honouring double and single quotes, and fills in `{file}`. */
export function commandWords(template: string, file: string): string[] {
  const words: string[] = [];
  for (const m of template.trim().matchAll(/"([^"]*)"|'([^']*)'|(\S+)/g)) words.push((m[1] ?? m[2] ?? m[3] ?? '').split('{file}').join(file));
  return words;
}

/** Plain text from a tool's output: drops `[00:00.000 --> 00:02.000]` timestamps and blank lines. */
export function cleanTranscript(output: string): string {
  return output
    .split('\n')
    .map((l) => l.replace(/^\s*\[[0-9:.,]+\s*-->\s*[0-9:.,]+\]\s*/, '').trim())
    .filter(Boolean)
    .join(' ')
    .replace(/\s+/g, ' ')
    .trim();
}

export const transcriptCallout = (text: string): string[] => ['> [!note] ' + TRANSCRIPT_TITLE, ...text.split(/(?<=[.!?])\s+(?=[A-Z])/).map((s) => `> ${s}`)];

/** Puts the transcript right under the link's line, replacing one that is already there. */
export function placeTranscript(lines: string[], linkLine: number, text: string): string[] {
  const callout = transcriptCallout(text);
  let start = linkLine + 1;
  while (start < lines.length && (lines[start] ?? '').trim() === '' && start === linkLine + 1) start++;
  let end = linkLine;
  if (new RegExp(`^>\\s*\\[!note\\]\\s+${TRANSCRIPT_TITLE}\\s*$`, 'i').test(lines[start] ?? '')) {
    end = start;
    while (end + 1 < lines.length && /^\s*>/.test(lines[end + 1] ?? '')) end++;
    return [...lines.slice(0, linkLine + 1), '', ...callout, ...lines.slice(end + 1)];
  }
  return [...lines.slice(0, linkLine + 1), '', ...callout, ...(lines[linkLine + 1]?.trim() === '' || linkLine + 1 >= lines.length ? [] : ['']), ...lines.slice(linkLine + 1)];
}
