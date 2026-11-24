import type { CompileContext, Extension, Token } from 'mdast-util-from-markdown';

/** Token types captured as one raw node whose `value` is the token's source text. */
const RAW = [
  'yamdAttributes',
  'yamdAttributesFlow',
  'yamdWikilink',
  'yamdTag',
  'yamdMathText',
] as const;

export function yamdFromMarkdown(): Extension {
  const enter: Record<string, (this: CompileContext, token: Token) => undefined> = {};
  const exit: Record<string, (this: CompileContext, token: Token) => undefined> = {};
  for (const type of RAW) {
    enter[type] = function (token) {
      this.enter({ type, value: '' } as never, token);
    };
    exit[type] = function (token) {
      const node = this.stack[this.stack.length - 1] as unknown as { value: string };
      node.value = this.sliceSerialize(token);
      this.exit(token);
    };
  }
  return { enter, exit } as Extension;
}
