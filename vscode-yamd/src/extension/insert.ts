/** Pure snippet builders for the "Insert…" commands, kept free of `vscode` so they can be unit-tested. */
import { slugify } from '../core/slug';

export function footnoteMarker(label: string): string {
  return `[^${label}]`;
}

export function footnoteDefinition(label: string): string {
  return `\n\n[^${label}]: `;
}

export const tagSnippet = (name: string): string => `#${name}`;

export const variableSnippet = (path: string): string => `{{ ${path} }}`;

/** Whether `text` already starts with a YAML front-matter block. */
export const hasFrontMatter = (text: string): boolean => /^---\r?\n/.test(text);

export function frontMatterBlock(fields: Record<string, string>): string {
  const body = Object.entries(fields)
    .map(([k, v]) => `${k}: ${v}`)
    .join('\n');
  return `---\n${body}${body ? '\n' : ''}---\n\n`;
}

export const wrapInAttributes = (selected: string, attrs: string): string => `${selected}{${attrs}}`;

export const TABLE_SNIPPET = '| Column 1 | Column 2 |\n| -------- | -------- |\n|          |          |\n';
export const MATH_BLOCK_SNIPPET = '$$\n\n$$';
export const DIAGRAM_BLOCK_SNIPPET = '```mermaid\n\n```';
export const COMMENT_SNIPPET = '%%  %%';
export const HORIZONTAL_RULE_SNIPPET = '\n---\n';
export const TOC_SNIPPET = '::toc';
export const QUERY_BLOCK_SNIPPET = '```query\n\n```';
export const FLASHCARD_BLOCK_SNIPPET = ':::card\nQ: \n\nA: \n:::';

export function wikiLink(target: string): string {
  return `[[${target}]]`;
}

export function embedLink(target: string): string {
  return `![[${target}]]`;
}

/** A block ID line suffix, e.g. appended to a paragraph: `text ^abc123`. */
export function blockIdSuffix(id: string): string {
  return ` ^${id}`;
}

/** A short, likely-unique block id derived from the current time. */
export function newBlockId(): string {
  return Date.now().toString(36).slice(-6);
}

/** Aliased link form, `[[target|alias]]` (§4.3/§4.12), or a plain wikilink when no alias is given. */
export function wikiLinkWithAlias(target: string, alias?: string): string {
  return alias ? `[[${target}|${alias}]]` : wikiLink(target);
}

export const CODE_LANGUAGES = [
  'javascript', 'typescript', 'python', 'bash', 'json', 'yaml', 'html', 'css',
  'sql', 'rust', 'go', 'c', 'cpp', 'java', 'plain',
] as const;

/** Fenced code block (§3.5), optionally with `{title=... lines=... highlight=...}` attributes after the language. */
export function codeBlockSnippet(lang: string, attrs?: string): { text: string; cursorOffset: number } {
  const info = attrs ? `${lang} {${attrs}}` : lang;
  const prefix = '```' + info + '\n';
  return { text: `${prefix}\n\`\`\``, cursorOffset: prefix.length };
}

/** A heading's `{#id}` anchor suffix (§5), or undefined if the heading already has one. */
export function headingAnchorSuffix(headingLine: string): string | undefined {
  if (/\{#[^}]+\}\s*$/.test(headingLine)) return undefined;
  return ` {#${slugify(headingLine.replace(/^#{1,6}\s*/, ''))}}`;
}

/** A block-attribute line placed directly above a paragraph/list block (§5). */
export function blockAttributesLine(attrs: string): string {
  return `{${attrs}}\n`;
}

export const CROSS_REF_KINDS = ['fig', 'tbl', 'eq', 'sec'] as const;

/** A cross-reference label attached to a block, `{#fig:name}` etc. (§4.7). */
export function crossRefLabel(kind: string, name: string): string {
  return `{#${kind}:${name}}`;
}

/** A reference to a cross-reference label or a citation key — both use `[@key]` (§4.7). */
export function crossRefOrCitation(key: string): string {
  return `[@${key}]`;
}

const LABEL_PATTERN = /\{#(fig|tbl|eq|sec):([\w-]+)\}/g;

/** Every cross-reference label (`{#fig:name}` etc.) found in `text` (§4.7). */
export function findCrossRefLabels(text: string): string[] {
  const out: string[] = [];
  for (const m of text.matchAll(LABEL_PATTERN)) out.push(`${m[1]}:${m[2]}`);
  return out;
}

/** Inline footnote shorthand, `^[text]` (§4.6), distinct from the reference-style `[^id]`. */
export function inlineFootnote(text: string): string {
  return `^[${text}]`;
}

/** Review markup (§7, CriticMarkup-based tracked changes). */
export const trackedInsertion = (text: string): string => `{++${text}++}`;
export const trackedDeletion = (text: string): string => `{--${text}--}`;
export const trackedSubstitution = (oldText: string, newText: string): string => `{~~${oldText}~>${newText}~~}`;
export const highlightWithComment = (text: string, comment: string): string => `{==${text}==}{>>${comment}<<}`;
export const reviewCommentSnippet = (comment: string): string => `{>>${comment}<<}`;
