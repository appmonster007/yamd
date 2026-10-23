import { isNotePath, relativeHref, resolveNote, selectEmbed, stripNoteExt } from './notes';
import type { NoteLookup } from './notes';
import { parse } from './parser';
import { render } from './render';
import type { RenderOptions, ResolvedEmbed } from './render';
import { slugify } from './slug';
import { posix } from 'node:path';

/** Embeds nest at most this many levels deep. */
export const MAX_EMBED_DEPTH = 5;

/**
 * Builds `resolveEmbed` for rendering the note at `fromPath`. `optionsFor` gives the render options
 * for each note (image paths resolve from that note's folder). Embedded notes render with their own
 * front matter and their own resolver, tracking the chain of notes to stop cycles and deep nesting.
 */
export function embedResolver(
  lookup: NoteLookup,
  fromPath: string,
  optionsFor: (path: string) => RenderOptions,
  chain: string[] = [fromPath],
): NonNullable<RenderOptions['resolveEmbed']> {
  return (t) => {
    const r = resolveNote(lookup, t.file, fromPath);
    // An ambiguous match is never auto-resolved — the lint pass already reports Y709 (error),
    // and embedding the shortest-path guess here would silently show different content from
    // what that error describes, or repoint if some other note's path happens to get shorter.
    if (!r || r.candidates.length > 1 || !isNotePath(r.path)) return 'missing';
    const whole = t.heading === undefined && t.blockId === undefined;
    // A note embedding a part of itself is fine; embedding a note already in the chain is a cycle.
    if ((whole || r.path !== fromPath) && chain.includes(r.path)) return 'cycle';
    if (chain.length > MAX_EMBED_DEPTH) return 'cycle';
    const text = lookup.read(r.path);
    if (text === undefined) return 'missing';
    const doc = parse(text);
    const blocks = selectEmbed(doc, t.heading, t.blockId);
    if (!blocks) return 'missing';
    const html = render(
      { ...doc, blocks },
      {
        ...optionsFor(r.path),
        sourcePath: r.path,
        resolveEmbed: embedResolver(lookup, r.path, optionsFor, [...chain, r.path]),
      },
    );
    const anchor = t.blockId ? `#^${t.blockId}` : t.heading ? `#${slugify(t.heading)}` : '';
    const name = stripNoteExt(posix.basename(r.path));
    const title = t.heading !== undefined ? `${name} › ${t.heading}` : t.blockId ? `${name} › ^${t.blockId}` : name;
    const embed: ResolvedEmbed = { path: r.path, href: relativeHref(fromPath, r.path) + anchor, title, html };
    return embed;
  };
}
