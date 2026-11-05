/**
 * Sanitizes raw HTML from YAMD source with GitHub's allow-list (as published in hast-util-sanitize's
 * default schema). Works tag by tag: every allowed tag is rebuilt from its parsed name and
 * allowed attributes, so nothing outside the allow-list can reach the output.
 */

const ALLOWED_TAGS = new Set(
  (
    'a b blockquote br code dd del details div dl dt em h1 h2 h3 h4 h5 h6 hr i img input ins kbd li ol p ' +
    'picture pre q rp rt ruby s samp section source span strike strong sub summary sup table tbody td ' +
    'tfoot th thead tr tt ul var caption figure figcaption abbr cite dfn mark small time wbr center'
  ).split(' '),
);

/** Tags removed together with their content. */
const DROP_WITH_CONTENT = new Set(
  'script style textarea title xmp iframe noembed noframes plaintext noscript template object embed'.split(' '),
);

const GLOBAL_ATTRS = new Set(
  (
    'abbr accept accept-charset accesskey action align alt axis border cellpadding cellspacing char charoff ' +
    'charset checked clear colspan color cols compact coords datetime dir enctype frame hspace headers height ' +
    'hreflang for id ismap itemprop label lang maxlength media method multiple name nohref noshade nowrap open ' +
    'prompt readonly rev rowspan rows rules scope selected shape size span start summary tabindex title usemap ' +
    'valign value width'
  ).split(' '),
);

const TAG_ATTRS: Record<string, string[]> = {
  a: ['href', 'aria-describedby', 'aria-label', 'aria-labelledby'],
  blockquote: ['cite'],
  del: ['cite'],
  ins: ['cite'],
  q: ['cite'],
  div: ['itemscope', 'itemtype'],
  img: ['src', 'longdesc', 'aria-describedby', 'aria-label', 'aria-labelledby'],
  source: ['srcset'],
  ol: ['aria-describedby', 'aria-label', 'aria-labelledby'],
  ul: ['aria-describedby', 'aria-label', 'aria-labelledby'],
  dl: ['aria-describedby', 'aria-label', 'aria-labelledby'],
  table: ['aria-describedby', 'aria-label', 'aria-labelledby'],
  summary: ['aria-describedby', 'aria-label', 'aria-labelledby'],
};

const URL_ATTRS: Record<string, string[]> = {
  href: ['http', 'https', 'mailto', 'irc', 'ircs', 'xmpp'],
  src: ['http', 'https'],
  cite: ['http', 'https'],
  longdesc: ['http', 'https'],
};

/** Attributes whose values could clash with the page's own IDs. */
const CLOBBER = new Set(['id', 'name']);
const CLOBBER_PREFIX = 'user-content-';

const VOID = new Set('area base br col embed hr img input link meta source track wbr'.split(' '));

const TOKEN =
  /<!--[\s\S]*?(?:-->|$)|<!\[CDATA\[[\s\S]*?(?:\]\]>|$)|<![^>]*>?|<\?[\s\S]*?(?:\?>|$)|<\/([A-Za-z][A-Za-z0-9-]*)\s*>|<([A-Za-z][A-Za-z0-9-]*)((?:\s+[^\s"'>/=]+(?:\s*=\s*(?:"[^"]*"|'[^']*'|[^\s"'=<>`]+))?)*)\s*(\/?)>/g;
const ATTR = /([^\s"'>/=]+)(?:\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s"'=<>`]+)))?/g;

function escapeText(s: string): string {
  return s.replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

function escapeAttr(s: string): string {
  return s.replace(/&(?![#\w]+;)/g, '&amp;').replace(/"/g, '&quot;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

/** Decodes character references enough to see the real URL scheme (`java&#115;cript:` etc.). */
function decodeForCheck(value: string): string {
  return value
    .replace(/&#x([0-9a-f]+);?/gi, (_m, h: string) => String.fromCodePoint(parseInt(h, 16)))
    .replace(/&#(\d+);?/g, (_m, d: string) => String.fromCodePoint(Number(d)))
    .replace(/&colon;/gi, ':')
    .replace(/&(tab|newline);/gi, '')
    .replace(/[\u0000- \u007f-\u009f]/g, '');
}

function urlAllowed(attr: string, value: string): boolean {
  const decoded = decodeForCheck(value);
  const scheme = /^([a-z][a-z0-9+.-]*):/i.exec(decoded)?.[1]?.toLowerCase();
  if (scheme === undefined) return true;
  return (URL_ATTRS[attr] ?? []).includes(scheme);
}

function rebuildTag(name: string, attrText: string, selfClosing: string): string {
  const kept: string[] = [];
  const allowedHere = TAG_ATTRS[name] ?? [];
  ATTR.lastIndex = 0;
  let m: RegExpExecArray | null;
  const seen = new Set<string>();
  while ((m = ATTR.exec(attrText))) {
    const attr = (m[1] ?? '').toLowerCase();
    if (seen.has(attr)) continue;
    seen.add(attr);
    const value = m[2] ?? m[3] ?? m[4];
    if (name === 'input') {
      if (attr === 'type' && value?.toLowerCase() === 'checkbox') kept.push('type="checkbox"');
      else if (attr === 'checked') kept.push('checked=""');
      continue;
    }
    if (name === 'code' && attr === 'class') {
      if (value && /^language-[\w+#.-]+$/.test(value)) kept.push(`class="${escapeAttr(value)}"`);
      continue;
    }
    if (!GLOBAL_ATTRS.has(attr) && !allowedHere.includes(attr)) continue;
    if (attr in URL_ATTRS && value !== undefined && !urlAllowed(attr, value)) continue;
    if (value === undefined) {
      kept.push(`${attr}=""`);
      continue;
    }
    const v = CLOBBER.has(attr) && !value.startsWith(CLOBBER_PREFIX) ? CLOBBER_PREFIX + value : value;
    kept.push(`${attr}="${escapeAttr(v)}"`);
  }
  if (name === 'input') {
    // GitHub only allows disabled checkboxes.
    if (!kept.includes('type="checkbox"')) return '';
    kept.push('disabled=""');
  }
  const attrs = kept.length ? ` ${kept.join(' ')}` : '';
  return `<${name}${attrs}${selfClosing && VOID.has(name) ? ' /' : ''}>`;
}

/** Sanitizes an HTML fragment. With `trust`, returns it unchanged. */
export function sanitizeHtml(html: string, trust = false): string {
  if (trust) return html;
  let out = '';
  let last = 0;
  let dropping: string | null = null;
  TOKEN.lastIndex = 0;
  let m: RegExpExecArray | null;
  while ((m = TOKEN.exec(html))) {
    if (dropping === null) out += escapeText(html.slice(last, m.index));
    last = TOKEN.lastIndex;
    const [, endName, startName, attrText = '', selfClosing = ''] = m;
    if (endName) {
      const name = endName.toLowerCase();
      if (dropping !== null) {
        if (name === dropping) dropping = null;
        continue;
      }
      if (ALLOWED_TAGS.has(name) && !VOID.has(name)) out += `</${name}>`;
      continue;
    }
    if (dropping !== null) continue;
    if (startName) {
      const name = startName.toLowerCase();
      if (DROP_WITH_CONTENT.has(name)) {
        if (!selfClosing) dropping = name;
        continue;
      }
      if (ALLOWED_TAGS.has(name)) out += rebuildTag(name, attrText, selfClosing);
    }
    // Comments, doctypes, CDATA and processing instructions are dropped.
  }
  if (dropping === null) out += escapeText(html.slice(last));
  return out;
}
