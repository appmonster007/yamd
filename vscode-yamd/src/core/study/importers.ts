/**
 * Importing notes from other tools (§6.7): Obsidian vaults, Notion exports, and HTML from Google
 * Docs or OneNote. Each function turns one file's text into YAMD.
 */
import { stringify } from 'yaml';
import { convertFromMarkdown } from '../convert';

// ---- Obsidian ----

const CALLOUT_KIND: Record<string, string> = {
  note: 'note', info: 'note', abstract: 'note', summary: 'note', tldr: 'note', todo: 'note', quote: 'note', cite: 'note', example: 'note',
  tip: 'tip', hint: 'tip', important: 'tip', success: 'tip', check: 'tip', done: 'tip',
  warning: 'warning', caution: 'warning', attention: 'warning', question: 'warning', help: 'warning', faq: 'warning',
  danger: 'danger', error: 'danger', failure: 'danger', fail: 'danger', missing: 'danger', bug: 'danger',
};

const IMAGE_EXT = /\.(png|jpe?g|gif|webp|svg|avif|bmp)$/i;

/**
 * Obsidian's syntax is close to YAMD's already (wikilinks, `![[embeds]]`, `==highlights==`, `%%comments%%`
 * and `^block-ids` are the same). Callouts become directives, and embedded images become images.
 */
export function obsidianToYamd(text: string): string {
  const lines = text.split(/\r?\n/);
  const out: string[] = [];
  let inFence = false;
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i] as string;
    if (/^\s*(```|~~~)/.test(line)) inFence = !inFence;
    if (inFence) {
      out.push(line);
      continue;
    }
    const callout = /^>\s*\[!([\w-]+)\][+-]?\s*(.*)$/.exec(line);
    if (callout) {
      const kind = CALLOUT_KIND[(callout[1] ?? '').toLowerCase()] ?? 'note';
      const title = callout[2]?.trim();
      const body: string[] = [];
      while (i + 1 < lines.length && /^>/.test(lines[i + 1] as string)) body.push((lines[++i] as string).replace(/^>\s?/, ''));
      const defaultTitle = (callout[1] ?? '').toLowerCase() === kind ? '' : (callout[1] ?? '').replace(/^./, (c) => c.toUpperCase());
      const heading = title || defaultTitle;
      out.push(`:::${kind}${heading ? ` {title=${JSON.stringify(heading)}}` : ''}`, ...body, ':::');
      continue;
    }
    out.push(
      line.replace(/!\[\[([^\]|#]+?)(?:\|([^\]]*))?\]\]/g, (m, file: string, size?: string) => {
        if (!IMAGE_EXT.test(file.trim())) return m;
        const name = file.trim();
        const alt = name.replace(/\.[^.]+$/, '').replace(/[-_]+/g, ' ');
        const width = size && /^\d+$/.test(size) ? `{width=${size}}` : '';
        return `![${size && !/^\d+(x\d+)?$/.test(size) ? size : alt}](${encodeURI(name)})${width}`;
      }),
    );
  }
  return out.join('\n');
}

// ---- Notion ----

const NOTION_ID = /[ -]?[0-9a-f]{32}(?=\.\w+$|\/|$|\)|#|\s|%20)/gi;

/** `Lecture 1 0123456789abcdef0123456789abcdef.md` → `Lecture 1.md`. */
export function cleanNotionName(name: string): string {
  return name.replace(/ [0-9a-f]{32}(?=\.|$)/gi, '');
}

/** Notion Markdown: relative links lose their IDs and point to `.yamd` files. */
export function notionToYamd(text: string): string {
  const fixed = text.replace(/(!?\[[^\]]*\])\(((?!https?:|mailto:|#)[^)\s]+)\)/g, (_m, label: string, href: string) => {
    let decoded = href;
    try {
      decoded = decodeURIComponent(href);
    } catch {
      // Keep as written.
    }
    const cleaned = decoded.split('/').map(cleanNotionName).join('/').replace(/\.md(?=#|$)/i, '.yamd');
    return `${label}(${cleaned.includes(' ') ? `<${cleaned}>` : cleaned})`;
  });
  return convertFromMarkdown(fixed.replace(NOTION_ID, '')).text;
}

// ---- CSV (Notion databases) ----

export function parseCsv(text: string): string[][] {
  const rows: string[][] = [];
  let row: string[] = [];
  let cell = '';
  let quoted = false;
  const src = text.replace(/^\uFEFF/, '');
  for (let i = 0; i < src.length; i++) {
    const c = src[i];
    if (quoted) {
      if (c === '"' && src[i + 1] === '"') {
        cell += '"';
        i++;
      } else if (c === '"') quoted = false;
      else cell += c;
    } else if (c === '"') quoted = true;
    else if (c === ',') {
      row.push(cell);
      cell = '';
    } else if (c === '\n' || c === '\r') {
      if (c === '\r' && src[i + 1] === '\n') i++;
      row.push(cell);
      rows.push(row);
      row = [];
      cell = '';
    } else cell += c;
  }
  if (cell !== '' || row.length) {
    row.push(cell);
    rows.push(row);
  }
  return rows.filter((r) => r.some((c) => c !== ''));
}

/** A `.ydb` text database from a CSV: the first column is the title; number and date columns are detected. */
export function csvToYdb(csv: string, name: string): string {
  const [header = [], ...body] = parseCsv(csv);
  const columns = header.map((h, i) => h.trim() || `Column ${i + 1}`);
  const type = (col: number): string => {
    if (col === 0) return 'title';
    const values = body.map((r) => (r[col] ?? '').trim()).filter(Boolean);
    if (values.length && values.every((v) => /^-?\d+(\.\d+)?$/.test(v))) return 'number';
    if (values.length && values.every((v) => /^\d{4}-\d{2}-\d{2}$/.test(v))) return 'date';
    return 'text';
  };
  const properties = Object.fromEntries(columns.map((c, i) => [c, type(i)]));
  const rows = body.map((r, n) => {
    const row: Record<string, unknown> = { id: `r${n + 1}` };
    columns.forEach((c, i) => {
      const v = (r[i] ?? '').trim();
      if (v === '') return;
      row[c] = properties[c] === 'number' ? Number(v) : v;
    });
    return row;
  });
  return `# Imported from CSV.\n${stringify({ yamdb: 0.1, name, properties, rows })}`;
}

// ---- HTML (Google Docs, OneNote, web pages) ----

interface El {
  tag: string;
  attrs: Record<string, string>;
  children: (El | string)[];
}

const VOID = new Set(['br', 'hr', 'img', 'meta', 'link', 'input']);
const SKIP = new Set(['script', 'style', 'head', 'title', 'svg', 'noscript']);

function decode(s: string): string {
  return s
    .replace(/&nbsp;|&#160;/g, ' ')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#39;|&apos;/g, "'")
    .replace(/&#x([0-9a-f]+);/gi, (_m, h: string) => String.fromCodePoint(parseInt(h, 16)))
    .replace(/&#(\d+);/g, (_m, d: string) => String.fromCodePoint(Number(d)))
    .replace(/&amp;/g, '&');
}

function parseHtml(html: string): El {
  const root: El = { tag: 'root', attrs: {}, children: [] };
  const stack: El[] = [root];
  const re = /<!--[\s\S]*?-->|<(\/?)([a-zA-Z][\w:-]*)((?:"[^"]*"|'[^']*'|[^>"'])*)>|([^<]+|<)/g;
  for (let m = re.exec(html); m; m = re.exec(html)) {
    const top = stack[stack.length - 1] as El;
    if (m[4] !== undefined) {
      top.children.push(m[4]);
    } else if (m[2]) {
      const tag = m[2].toLowerCase();
      if (m[1]) {
        const at = stack.map((e) => e.tag).lastIndexOf(tag);
        if (at > 0) stack.length = at;
      } else {
        const attrs: Record<string, string> = {};
        for (const a of (m[3] ?? '').matchAll(/([\w:-]+)\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s>]+))/g)) attrs[(a[1] ?? '').toLowerCase()] = decode(a[2] ?? a[3] ?? a[4] ?? '');
        const el: El = { tag, attrs, children: [] };
        // <li> and <p> left open are closed by the next one.
        if ((tag === 'li' || tag === 'p') && top.tag === tag && stack.length > 1) stack.pop();
        (stack[stack.length - 1] as El).children.push(el);
        if (!VOID.has(tag) && !/\/\s*$/.test(m[3] ?? '')) stack.push(el);
      }
    }
  }
  return root;
}

const escapeText = (s: string) => s.replace(/[\\`*_[\]{}<>|]/g, '\\$&').replace(/(^|\s)([#=+~^%])/g, '$1\\$2').replace(/:{2,}/g, (m) => m.replace(/:/g, '\\:'));

function wrap(mark: string, inner: string): string {
  const t = inner.trim();
  if (!t) return inner;
  const lead = /^\s*/.exec(inner)?.[0] ?? '';
  const trail = /\s*$/.exec(inner)?.[0] ?? '';
  return `${lead}${mark}${t}${mark}${trail}`;
}

function styleMarks(style: string | undefined): { b: boolean; i: boolean; u: boolean; s: boolean } {
  const st = (style ?? '').toLowerCase();
  return {
    b: /font-weight:\s*(bold|[6-9]00)/.test(st),
    i: /font-style:\s*italic/.test(st),
    u: /text-decoration[^;]*underline/.test(st) && !/text-decoration:\s*none/.test(st),
    s: /text-decoration[^;]*line-through/.test(st),
  };
}

function inlineMd(el: El | string): string {
  if (typeof el === 'string') return escapeText(decode(el).replace(/\s+/g, ' '));
  if (SKIP.has(el.tag)) return '';
  const inner = () => el.children.map(inlineMd).join('');
  switch (el.tag) {
    case 'br':
      return '\\\n';
    case 'strong':
    case 'b':
      return wrap('**', inner());
    case 'em':
    case 'i':
      return wrap('*', inner());
    case 'u':
      return wrap('++', inner());
    case 's':
    case 'del':
    case 'strike':
      return wrap('~~', inner());
    case 'mark':
      return wrap('==', inner());
    case 'sub':
      return `~${inner()}~`;
    case 'sup':
      return `^${inner()}^`;
    case 'code':
    case 'kbd':
    case 'tt':
      return `\`${el.children.map((c) => (typeof c === 'string' ? decode(c) : '')).join('')}\``;
    case 'a': {
      const href = el.attrs['href'];
      const text = inner();
      if (!href || href.startsWith('#') || !text.trim()) return text;
      const safe = /^(https?:|mailto:|tel:)/i.test(href) || !/^[a-z][a-z0-9+.-]*:/i.test(href);
      return safe ? `[${text.trim()}](${href.includes(' ') ? `<${href}>` : href})` : text;
    }
    case 'img': {
      const src = el.attrs['src'];
      if (!src || src.startsWith('data:')) return '';
      const alt = el.attrs['alt']?.trim();
      return alt ? `![${alt}](${src})` : `![](${src}){decorative}`;
    }
    case 'span': {
      const m = styleMarks(el.attrs['style']);
      let out = inner();
      if (m.s) out = wrap('~~', out);
      if (m.u) out = wrap('++', out);
      if (m.i) out = wrap('*', out);
      if (m.b) out = wrap('**', out);
      return out;
    }
    default:
      return inner();
  }
}

function blockMd(el: El | string, ctx: { depth: number; ordered?: boolean; n?: number } = { depth: 0 }): string {
  if (typeof el === 'string') {
    const t = decode(el).replace(/\s+/g, ' ').trim();
    return t ? `${escapeText(t)}\n\n` : '';
  }
  if (SKIP.has(el.tag)) return '';
  const kids = (c = ctx) => el.children.map((k) => blockMd(k, c)).join('');
  // A block's content is inline unless it contains block elements.
  const isBlockish = (c: El | string) => typeof c !== 'string' && /^(p|div|ul|ol|li|h[1-6]|table|pre|blockquote|hr|section|article|figure)$/.test(c.tag);
  const inlineText = () => el.children.map(inlineMd).join('').replace(/[ \t]+\n/g, '\n').trim();
  switch (el.tag) {
    case 'h1':
    case 'h2':
    case 'h3':
    case 'h4':
    case 'h5':
    case 'h6': {
      const t = inlineText().replace(/\s*\n\s*/g, ' ');
      return t ? `${'#'.repeat(Number(el.tag[1]))} ${t}\n\n` : '';
    }
    case 'p':
    case 'span':
    case 'a':
    case 'b':
    case 'strong':
    case 'i':
    case 'em':
    case 'u': {
      if (el.children.some(isBlockish)) return kids();
      const t = inlineMd(el).trim();
      return t ? `${t}\n\n` : '';
    }
    case 'ul':
    case 'ol': {
      let n = 1;
      const items = el.children.filter((c): c is El => typeof c !== 'string' && c.tag === 'li');
      const text = items.map((li) => blockMd(li, { depth: ctx.depth, ordered: el.tag === 'ol', n: n++ })).join('');
      return ctx.depth > 0 ? text : `${text}\n`;
    }
    case 'li': {
      const indent = '   '.repeat(ctx.depth);
      const marker = ctx.ordered ? `${ctx.n ?? 1}. ` : '- ';
      const nested = el.children.filter((c) => typeof c !== 'string' && (c.tag === 'ul' || c.tag === 'ol'));
      const content = el.children.filter((c) => !nested.includes(c));
      const checkbox = content.find((c): c is El => typeof c !== 'string' && c.tag === 'input' && c.attrs['type'] === 'checkbox');
      const text = content.map((c) => (typeof c !== 'string' && /^(p|div)$/.test(c.tag) ? c.children.map(inlineMd).join('') : inlineMd(c))).join('').replace(/\s*\n\s*/g, ' ').trim();
      const box = checkbox ? (checkbox.attrs['checked'] !== undefined ? '[x] ' : '[ ] ') : '';
      return `${indent}${marker}${box}${text}\n${nested.map((c) => blockMd(c, { depth: ctx.depth + 1 })).join('')}`;
    }
    case 'pre': {
      const code = el.children.map(function flat(c): string { return typeof c === 'string' ? decode(c) : c.tag === 'br' ? '\n' : c.children.map(flat).join(''); }).join('').replace(/\n$/, '');
      return `\`\`\`\n${code}\n\`\`\`\n\n`;
    }
    case 'blockquote':
      return `${kids()
        .trim()
        .split('\n')
        .map((l) => (l ? `> ${l}` : '>'))
        .join('\n')}\n\n`;
    case 'hr':
      return '---\n\n';
    case 'img': {
      const t = inlineMd(el);
      return t ? `${t}\n\n` : '';
    }
    case 'table': {
      const rows: El[] = [];
      const collect = (e: El) => e.children.forEach((c) => typeof c !== 'string' && (c.tag === 'tr' ? rows.push(c) : collect(c)));
      collect(el);
      const cells = rows.map((r) => r.children.filter((c): c is El => typeof c !== 'string' && (c.tag === 'td' || c.tag === 'th')).map((c) => c.children.map(inlineMd).join('').replace(/\s*\n\s*/g, ' ').replace(/\|/g, '\\|').trim()));
      if (!cells.length) return '';
      const width = Math.max(...cells.map((r) => r.length));
      const pad = (r: string[]) => `| ${Array.from({ length: width }, (_, i) => r[i] ?? '').join(' | ')} |`;
      return `${pad(cells[0] as string[])}\n| ${Array.from({ length: width }, () => '---').join(' | ')} |\n${cells.slice(1).map(pad).join('\n')}\n\n`;
    }
    case 'br':
      return '';
    default:
      return el.children.some(isBlockish) || !el.children.some((c) => typeof c !== 'string' || c.trim()) ? kids() : (() => { const t = inlineText(); return t ? `${t}\n\n` : ''; })();
  }
}

/** Converts HTML to YAMD. The title comes from `<title>` for the front matter. */
export function htmlToYamd(html: string, fallbackTitle: string): string {
  const title = decode(/<title[^>]*>([\s\S]*?)<\/title>/i.exec(html)?.[1] ?? '').trim() || fallbackTitle;
  const body = /<body[^>]*>([\s\S]*)<\/body>/i.exec(html)?.[1] ?? html;
  const md = blockMd(parseHtml(body)).replace(/\n{3,}/g, '\n\n').trim();
  const front = stringify({ title, lang: /<html[^>]*\blang=["']([\w-]+)/i.exec(html)?.[1] ?? 'en' });
  const hasH1 = /^# /m.test(md);
  return `---\n${front}---\n\n${hasH1 ? '' : `# ${escapeText(title)}\n\n`}${md}\n`;
}
