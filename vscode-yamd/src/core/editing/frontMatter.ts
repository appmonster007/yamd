import { extractFrontMatter } from '../markdown/frontmatter';

/** Sets `key: value` in a note's front matter, replacing an existing line for the key or creating the block. */
export function setFrontMatterKey(lines: string[], key: string, value: string): string[] {
  const fm = extractFrontMatter(lines);
  const entry = `${key}: ${value}`;
  if (!fm) return ['---', entry, '---', '', ...lines];
  const existing = lines.findIndex((l, i) => i > 0 && i < fm.endLine && new RegExp(`^${key}\\s*:`).test(l));
  const out = [...lines];
  if (existing >= 0) out[existing] = entry;
  else out.splice(fm.endLine, 0, entry);
  return out;
}
