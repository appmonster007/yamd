/** Helpers for exports that carry everything in one file. */
const MIME: Record<string, string> = { png: 'image/png', jpg: 'image/jpeg', jpeg: 'image/jpeg', gif: 'image/gif', webp: 'image/webp', svg: 'image/svg+xml', avif: 'image/avif' };

export const imageMime = (file: string) => MIME[file.split('.').pop()?.toLowerCase() ?? ''];

/** Replaces local image links with data URIs. `read` returns the file's bytes, or undefined when it can't be read. */
export function inlineImages(lines: string[], read: (relative: string) => Uint8Array | undefined, toBase64: (b: Uint8Array) => string): { lines: string[]; missing: string[] } {
  const missing: string[] = [];
  let inFence = false;
  const out = lines.map((line) => {
    if (/^\s*(```|~~~)/.test(line)) inFence = !inFence;
    if (inFence) return line;
    return line.replace(/(!\[[^\]]*\]\()([^)\s]+)((?:\s+"[^"]*")?\))/g, (whole, a: string, raw: string, c: string) => {
      const path = raw.replace(/^<|>$/g, '');
      const mime = imageMime(path);
      if (!mime || /^([a-z][a-z0-9+.-]*:|\/\/)/i.test(path)) return whole;
      const bytes = read(decodeURI(path));
      if (!bytes) {
        missing.push(path);
        return whole;
      }
      return `${a}data:${mime};base64,${toBase64(bytes)}${c}`;
    });
  });
  return { lines: out, missing };
}
