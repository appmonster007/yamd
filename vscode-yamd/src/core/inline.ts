import type { InlineNode } from './types';

export const KNOWN_INLINE_DIRECTIVES = new Set(['kbd', 'abbr', 'query']);

/**
 * Concatenated visible text of inline nodes, used for alt text, slugs and link checks.
 * `resolve` substitutes variables; without it they appear as written.
 */
export function plainText(nodes: InlineNode[], resolve?: (path: string) => string | undefined): string {
  const recurse = (children: InlineNode[]) => plainText(children, resolve);
  let out = '';
  for (const n of nodes) {
    switch (n.type) {
      case 'text':
      case 'code':
      case 'math':
        out += n.value;
        break;
      case 'break':
        out += ' ';
        break;
      case 'variable':
        out += resolve?.(n.path) ?? n.raw;
        break;
      case 'image':
        out += n.alt;
        break;
      case 'tag':
        out += `#${n.name}`;
        break;
      case 'embed':
        out += n.target;
        break;
      case 'reviewSubstitute':
        out += recurse(n.to);
        break;
      case 'emphasis':
      case 'link':
      case 'span':
      case 'review':
      case 'reviewHighlight':
      case 'directive':
        if (!(n.type === 'review' && n.kind === 'delete')) out += recurse(n.children);
        break;
      default:
        break;
    }
  }
  return out;
}
