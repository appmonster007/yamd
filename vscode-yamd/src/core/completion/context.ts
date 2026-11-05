/**
 * What the cursor is in, for completion and hover: a widget type after a fence, a callout type, a
 * citation or reference key, a data file or column in a query header, or a marker name.
 */
import { scanFences } from '../widgets/fences';

export type CompletionContext =
  | { kind: 'widget-type'; prefix: string }
  | { kind: 'callout-type'; prefix: string }
  | { kind: 'reference'; prefix: string }
  | { kind: 'marker'; prefix: string }
  | { kind: 'header-value'; attr: 'source' | 'view' | 'type' | 'group' | 'x' | 'y'; prefix: string }
  | { kind: 'header-attr'; prefix: string }
  | { kind: 'sql-body'; prefix: string; blockLine: number };

/** What is being typed at `character` on `line`, or undefined when no completion applies. */
export function completionContext(lines: string[], line: number, character: number): CompletionContext | undefined {
  const text = (lines[line] ?? '').slice(0, character);

  const fenceOpen = /^[ \t>]*(?:[-*+][ \t]+)?(?:`{3,}|~{3,})([A-Za-z]*)$/.exec(text);
  if (fenceOpen) return { kind: 'widget-type', prefix: fenceOpen[1] as string };

  const callout = /^[ \t]*>[ \t]*\[!([A-Za-z-]*)$/.exec(text);
  if (callout) return { kind: 'callout-type', prefix: callout[1] as string };

  const marker = /<!--\s*(\/?)yamd:([\w:-]*)$/.exec(text);
  if (marker && !marker[1]) return { kind: 'marker', prefix: marker[2] as string };

  const reference = /\[@([\w:.-]*)$/.exec(text) ?? /;\s*@([\w:.-]*)$/.exec(text);
  if (reference) return { kind: 'reference', prefix: reference[1] as string };

  // Inside a ```sql block: the first line is the attribute header, the rest is the query.
  const fence = scanFences(lines).find((f) => f.type === 'sql' && f.bodyStartLine <= line && line <= f.bodyEndLine);
  if (fence) {
    if (line === fence.bodyStartLine && /^\s*--/.test(lines[line] ?? '')) {
      const value = /\b(source|view|type|group|x|y)="([^"]*)$/.exec(text);
      if (value) return { kind: 'header-value', attr: value[1] as 'source', prefix: value[2] as string };
      const attr = /(?:^|\s)([a-z]*)$/.exec(text);
      if (attr && /^\s*--/.test(text) && /\s$|--\s*[a-z]*$/.test(text.replace(/[a-z]+$/, ' '))) return { kind: 'header-attr', prefix: attr[1] as string };
      return undefined;
    }
    const word = /[\w]*$/.exec(text)?.[0] ?? '';
    return { kind: 'sql-body', prefix: word, blockLine: fence.startLine };
  }
  return undefined;
}
