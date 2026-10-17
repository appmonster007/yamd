/**
 * Study-aid blocks (§6.3): `:::definition`, `:::theorem` and friends. They are numbered per kind,
 * can be cross-referenced, and can be collected from every note into a cheat sheet.
 */
import { attrString } from '../attrs';
import { plainText } from '../inline';
import { walkBlocks } from '../parser';
import type { ContainerBlock, YamdDocument } from '../types';

export interface StudyKind {
  name: string;
  label: string;
  /** Numbered blocks can be cross-referenced as `[@id]`. */
  numbered: boolean;
}

export const STUDY_KINDS: StudyKind[] = [
  { name: 'definition', label: 'Definition', numbered: true },
  { name: 'theorem', label: 'Theorem', numbered: true },
  { name: 'lemma', label: 'Lemma', numbered: true },
  { name: 'proof', label: 'Proof', numbered: false },
  { name: 'example', label: 'Example', numbered: true },
  { name: 'question', label: 'Question', numbered: true },
  { name: 'remark', label: 'Remark', numbered: false },
  { name: 'summary', label: 'Summary', numbered: false },
];

export const STUDY_BY_NAME = new Map(STUDY_KINDS.map((k) => [k.name, k]));

export interface StudyBlock {
  kind: string;
  label: string;
  title?: string;
  /** Source of the body, without the `:::` lines. */
  body: string;
  path: string;
  line: number;
  /** The note's `course`. */
  course?: string;
  id?: string;
}

function bodyOf(doc: YamdDocument, b: ContainerBlock): string {
  const closed = /^\s*:{3,}\s*$/.test(doc.lines[b.endLine] ?? '');
  return doc.lines.slice(b.line + 1, closed ? b.endLine : b.endLine + 1).join('\n').trim();
}

export function collectStudyBlocks(doc: YamdDocument, path: string): StudyBlock[] {
  const out: StudyBlock[] = [];
  const course = typeof doc.frontMatter?.data['course'] === 'string' ? (doc.frontMatter.data['course'] as string) : undefined;
  walkBlocks(doc.blocks, (b) => {
    if (b.type !== 'container') return;
    const kind = STUDY_BY_NAME.get(b.name);
    if (!kind) return;
    out.push({
      kind: kind.name,
      label: kind.label,
      title: attrString(b.attrs, 'title'),
      body: bodyOf(doc, b),
      path,
      line: b.line,
      course,
      id: b.attrs?.id,
    });
  });
  return out;
}

/** Plain-text name of a heading-like first line, used when a block has no `title`. */
export function firstLine(body: string): string {
  return plainText([{ type: 'text', value: body.split('\n')[0] ?? '', range: { start: 0, end: 0 } }]).slice(0, 80);
}

export interface CheatSheetOptions {
  /** Kinds to include, in order. Defaults to definitions, theorems, lemmas and summaries. */
  kinds?: string[];
  course?: string;
  title?: string;
  /** Today's date for the front matter. */
  date: string;
  /** Link to a block's note, relative to where the sheet will be saved. */
  link: (path: string) => string;
}

/** A new note that gathers study blocks from all notes, grouped by kind, each linked to its source. */
export function buildCheatSheet(blocks: StudyBlock[], options: CheatSheetOptions): string {
  const kinds = options.kinds ?? ['definition', 'theorem', 'lemma', 'summary'];
  const title = options.title ?? (options.course ? `${options.course} cheat sheet` : 'Cheat sheet');
  const out = [`---`, `title: ${JSON.stringify(title)}`, `date: ${options.date}`, ...(options.course ? [`course: ${JSON.stringify(options.course)}`] : []), `lang: en`, `---`, '', `# ${title}`, ''];
  for (const kind of kinds) {
    const info = STUDY_BY_NAME.get(kind);
    const picked = blocks.filter((b) => b.kind === kind && (!options.course || b.course === options.course));
    if (!info || picked.length === 0) continue;
    out.push(`## ${info.label.endsWith('y') ? `${info.label.slice(0, -1)}ies` : `${info.label}s`}`, '');
    for (const b of picked) {
      const heading = b.title ?? firstLine(b.body);
      out.push(`:::${kind} {title=${JSON.stringify(heading)}}`, b.body, ':::', '', `Source: [${b.path.split('/').pop()?.replace(/\.yamd$/, '') ?? b.path}](${options.link(b.path)})`, '');
    }
  }
  if (out.length <= 10 && out[out.length - 1] === '') out.push('No matching study blocks were found.', '');
  return out.join('\n');
}
