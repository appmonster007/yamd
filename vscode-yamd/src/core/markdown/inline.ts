import type { InlineNode } from './types';

/**
 * Concatenated visible text of inline nodes, used for alt text, slugs and link checks.
 */
export function plainText(nodes: InlineNode[]): string {
  const recurse = (children: InlineNode[]) => plainText(children);
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
      case 'image':
        out += n.alt;
        break;
      case 'tag':
        out += `#${n.name}`;
        break;
      case 'emphasis':
      case 'link':
      case 'span':
        out += recurse(n.children);
        break;
      default:
        break;
    }
  }
  return out;
}
