import { existsSync, mkdirSync, writeFileSync } from 'node:fs';
import * as path from 'node:path';
import { extensionFor, linkText, recordingName, uniqueName } from '../../core/audio/audio';

export interface SavedRecording {
  /** Absolute path of the file written. */
  file: string;
  /** The path as the note links to it, relative to the note. */
  relativePath: string;
  /** The Markdown link to insert. */
  link: string;
}

/** Writes a recording into `folder` next to the note (created if needed) and returns the link to it. */
export function saveRecording(options: { noteFile: string; folder: string; bytes: Uint8Array; mime: string; now?: Date; label?: string }): SavedRecording {
  const now = options.now ?? new Date();
  const folder = options.folder.replace(/^[/\\]+|[/\\]+$/g, '') || 'audio';
  const dir = path.resolve(path.dirname(options.noteFile), folder);
  // Never write outside the note's folder tree through a setting like "../../x".
  if (path.relative(path.dirname(options.noteFile), dir).startsWith('..')) throw new Error(`The audio folder "${options.folder}" must be inside the note's folder.`);
  mkdirSync(dir, { recursive: true });
  const name = uniqueName(recordingName(now, extensionFor(options.mime), options.label), (n) => existsSync(path.join(dir, n)));
  const file = path.join(dir, name);
  writeFileSync(file, options.bytes);
  const relativePath = `${folder.split(path.sep).join('/')}/${name}`;
  return { file, relativePath, link: linkText(relativePath, now) };
}
