// Generates syntaxes/yamd.tmLanguage.json. Regexes are written with String.raw so they read as-is.
import { writeFileSync } from 'node:fs';

const r = String.raw;

/** [embedded language id, info-string aliases, grammar scope] */
const FENCE_LANGUAGES = [
  ['javascript', 'js|javascript|mjs|cjs', 'source.js'],
  ['typescript', 'ts|typescript|mts|cts', 'source.ts'],
  ['tsx', 'tsx', 'source.tsx'],
  ['jsx', 'jsx', 'source.js.jsx'],
  ['python', 'py|python|py3', 'source.python'],
  ['shellscript', 'sh|bash|zsh|shell|shellscript', 'source.shell'],
  ['json', 'json|jsonc|json5', 'source.json'],
  ['yaml', 'yaml|yml', 'source.yaml'],
  ['html', 'html|htm', 'text.html.basic'],
  ['css', 'css', 'source.css'],
  ['scss', 'scss', 'source.css.scss'],
  ['java', 'java', 'source.java'],
  ['c', 'c|h', 'source.c'],
  ['cpp', r`cpp|c\+\+|cc|hpp`, 'source.cpp'],
  ['csharp', 'cs|csharp|c#', 'source.cs'],
  ['go', 'go|golang', 'source.go'],
  ['rust', 'rs|rust', 'source.rust'],
  ['ruby', 'rb|ruby', 'source.ruby'],
  ['php', 'php', 'source.php'],
  ['sql', 'sql', 'source.sql'],
  ['xml', 'xml|svg', 'text.xml'],
  ['markdown', 'md|markdown', 'text.html.markdown'],
  ['diff', 'diff|patch', 'source.diff'],
  ['dockerfile', 'dockerfile|docker', 'source.dockerfile'],
  ['powershell', 'ps1|powershell|pwsh', 'source.powershell'],
];

const fenceBegin = (aliases) => r`^(\s*)(\x60{3,}|~{3,})\s*(?i:(${aliases}))(?=[\s{]|$)([^\x60]*)$`;
const fenceEnd = r`^\s*(\2)[\x60~]*\s*$`;

const fenceCaptures = {
  2: { name: 'punctuation.definition.markdown' },
  3: { name: 'fenced_code.block.language.yamd' },
  4: { patterns: [{ include: '#attributes' }] },
};

const fencedLanguages = FENCE_LANGUAGES.map(([id, aliases, scope]) => ({
  name: `markup.fenced_code.block.yamd`,
  begin: fenceBegin(aliases),
  beginCaptures: fenceCaptures,
  end: fenceEnd,
  endCaptures: { 1: { name: 'punctuation.definition.markdown' } },
  patterns: [
    {
      begin: r`(^|\G)(\s*)(.*)`,
      while: r`(^|\G)(?!\s*([\x60~]{3,})\s*$)`,
      contentName: `meta.embedded.block.${id}`,
      patterns: [{ include: scope }],
    },
  ],
}));

const grammar = {
  $schema: 'https://raw.githubusercontent.com/martinring/tmlanguage/master/tmlanguage.json',
  name: 'YAMD',
  scopeName: 'text.yamd',
  patterns: [{ include: '#frontmatter' }, { include: '#block' }],
  repository: {
    frontmatter: {
      begin: r`\A(---)\s*$`,
      beginCaptures: { 1: { name: 'punctuation.definition.frontmatter.yamd' } },
      end: r`^(---|\.\.\.)\s*$`,
      endCaptures: { 1: { name: 'punctuation.definition.frontmatter.yamd' } },
      contentName: 'meta.embedded.block.frontmatter',
      patterns: [{ include: 'source.yaml' }],
    },

    block: {
      patterns: [
        { include: '#comment' },
        ...fencedLanguages.map((_, i) => ({ include: `#fence_${i}` })),
        { include: '#fence_plain' },
        { include: '#math_block' },
        { include: '#container' },
        { include: '#leaf_directive' },
        { include: '#heading' },
        { include: '#thematic_break' },
        { include: '#attribute_line' },
        { include: '#blockquote' },
        { include: '#table_separator' },
        { include: '#table_row' },
        { include: '#footnote_definition' },
        { include: '#reference_definition' },
        { include: '#list_item' },
        { include: '#inline' },
      ],
    },

    ...Object.fromEntries(fencedLanguages.map((rule, i) => [`fence_${i}`, rule])),

    fence_plain: {
      name: 'markup.fenced_code.block.yamd',
      begin: r`^(\s*)(\x60{3,}|~{3,})\s*([\w#+.-]*)([^\x60]*)$`,
      beginCaptures: fenceCaptures,
      end: fenceEnd,
      endCaptures: { 1: { name: 'punctuation.definition.markdown' } },
      contentName: 'markup.raw.block.yamd',
    },

    math_block: {
      begin: r`^\s*(\$\$)\s*(\{[^{}]*\})?\s*$`,
      beginCaptures: {
        1: { name: 'punctuation.definition.math.begin.yamd' },
        2: { patterns: [{ include: '#attributes' }] },
      },
      end: r`^\s*(\$\$)\s*$`,
      endCaptures: { 1: { name: 'punctuation.definition.math.end.yamd' } },
      contentName: 'string.other.math.block.yamd',
    },

    container: {
      name: 'meta.directive.container.yamd',
      begin: r`^\s*(:{3,})\s*([A-Za-z][\w-]*)(.*)$`,
      beginCaptures: {
        1: { name: 'punctuation.definition.directive.yamd' },
        2: { name: 'entity.name.tag.directive.yamd' },
        3: { patterns: [{ include: '#attributes' }] },
      },
      end: r`^\s*(\1)\s*$`,
      endCaptures: { 1: { name: 'punctuation.definition.directive.yamd' } },
      patterns: [{ include: '#block' }],
    },

    leaf_directive: {
      match: r`^\s*(::)([A-Za-z][\w-]*)(?:(\[)([^\]]*)(\]))?(\{[^{}]*\})?\s*$`,
      captures: {
        1: { name: 'punctuation.definition.directive.yamd' },
        2: { name: 'entity.name.tag.directive.yamd' },
        3: { name: 'punctuation.definition.directive.label.yamd' },
        4: { name: 'string.other.directive.label.yamd' },
        5: { name: 'punctuation.definition.directive.label.yamd' },
        6: { patterns: [{ include: '#attributes' }] },
      },
    },

    heading: {
      name: 'markup.heading.yamd',
      begin: r`^\s*(#{1,6})(?:\s+|$)`,
      beginCaptures: { 1: { name: 'punctuation.definition.heading.yamd' } },
      end: '$',
      contentName: 'entity.name.section.yamd',
      patterns: [{ include: '#attributes' }, { include: '#inline' }],
    },

    thematic_break: {
      match: r`^\s*(?:-{3,}|\*{3,}|_{3,})\s*$`,
      name: 'meta.separator.yamd',
    },

    attribute_line: {
      match: r`^\s*(\{(?![{+\-~=>])[^{}]*\})\s*$`,
      captures: { 1: { patterns: [{ include: '#attributes' }] } },
    },

    blockquote: {
      match: r`^\s*(>)(?:\s*(>))*`,
      captures: {
        1: { name: 'punctuation.definition.quote.begin.yamd' },
        2: { name: 'punctuation.definition.quote.begin.yamd' },
      },
      name: 'markup.quote.yamd',
    },

    table_separator: {
      match: r`^\s*\|(?:\s*:?-+:?\s*\|)+\s*$`,
      name: 'punctuation.separator.table.yamd',
    },

    table_row: {
      begin: r`^(?=\s*\|)`,
      end: '$',
      name: 'markup.table.yamd',
      patterns: [
        { match: r`(?<!\\)\|`, name: 'punctuation.separator.table.yamd' },
        { include: '#inline' },
      ],
    },

    footnote_definition: {
      match: r`^\s*(\[\^)([^\]\s]+)(\]:)`,
      captures: {
        1: { name: 'punctuation.definition.constant.yamd' },
        2: { name: 'constant.other.reference.footnote.yamd' },
        3: { name: 'punctuation.definition.constant.yamd' },
      },
    },

    reference_definition: {
      match: r`^\s*(\[)([^\]^@\[][^\]]*)(\]:)\s+(\S+)(?:\s+("[^"]*"|'[^']*'))?\s*$`,
      captures: {
        1: { name: 'punctuation.definition.constant.yamd' },
        2: { name: 'constant.other.reference.link.yamd' },
        3: { name: 'punctuation.separator.key-value.yamd' },
        4: { name: 'markup.underline.link.yamd' },
        5: { name: 'string.other.link.description.title.yamd' },
      },
    },

    list_item: {
      match: r`^\s*([-*+]|\d{1,9}[.)])(?=\s|$)(?:\s+(\[[ xX]\]))?`,
      captures: {
        1: { name: 'punctuation.definition.list.begin.yamd' },
        2: { name: 'constant.language.task.yamd' },
      },
      name: 'markup.list.yamd',
    },

    comment: {
      name: 'comment.block.yamd',
      begin: '%%',
      end: '%%',
    },

    attributes: {
      name: 'meta.attributes.yamd',
      begin: r`(\{)(?![{+\-~=>])(?=[^{}\n]*\})`,
      beginCaptures: { 1: { name: 'punctuation.definition.attributes.begin.yamd' } },
      end: r`\}`,
      endCaptures: { 0: { name: 'punctuation.definition.attributes.end.yamd' } },
      patterns: [
        { match: r`#[^\s{}]+`, name: 'entity.other.attribute-name.id.yamd' },
        { match: r`\.[\w-]+`, name: 'entity.other.attribute-name.class.yamd' },
        {
          match: r`([\w-]+)(=)("[^"]*"|'[^']*'|[^\s"'{}]+)`,
          captures: {
            1: { name: 'entity.other.attribute-name.yamd' },
            2: { name: 'punctuation.separator.key-value.yamd' },
            3: { name: 'string.unquoted.attribute-value.yamd' },
          },
        },
        { match: r`[\w-]+`, name: 'entity.other.attribute-name.yamd' },
      ],
    },

    inline: {
      patterns: [
        { include: '#comment' },
        { include: '#escape' },
        { include: '#code_span' },
        { include: '#math_inline' },
        { include: '#variable' },
        { include: '#review' },
        { include: '#image' },
        { include: '#wikilink' },
        { include: '#footnote_ref' },
        { include: '#citation' },
        { include: '#link' },
        { include: '#reference_link' },
        { include: '#span' },
        { include: '#autolink' },
        { include: '#inline_directive' },
        { include: '#attributes' },
        { include: '#bold_italic' },
        { include: '#bold' },
        { include: '#italic' },
        { include: '#underline' },
        { include: '#bold_underscore' },
        { include: '#italic_underscore' },
        { include: '#strikethrough' },
        { include: '#strikethrough_single' },
        { include: '#highlight' },
        { include: '#subscript' },
        { include: '#superscript' },
      ],
    },

    escape: {
      match: r`\\[!-/:-@\[-\x60{-~]`,
      name: 'constant.character.escape.yamd',
    },

    code_span: {
      match: r`(\x60+)(.+?)(?<!\x60)(\1)(?!\x60)`,
      captures: {
        1: { name: 'punctuation.definition.raw.yamd' },
        2: { name: 'markup.inline.raw.string.yamd' },
        3: { name: 'punctuation.definition.raw.yamd' },
      },
    },

    math_inline: {
      match: r`(?<!\\)(\$)(?=[^\s$])([^$]*?[^\s\\$])(\$)(?!\d)`,
      captures: {
        1: { name: 'punctuation.definition.math.begin.yamd' },
        2: { name: 'string.other.math.inline.yamd' },
        3: { name: 'punctuation.definition.math.end.yamd' },
      },
    },

    variable: {
      match: r`(\{\{)\s*([A-Za-z_][\w.-]*)\s*(\}\})`,
      captures: {
        1: { name: 'punctuation.definition.variable.begin.yamd' },
        2: { name: 'variable.other.yamd' },
        3: { name: 'punctuation.definition.variable.end.yamd' },
      },
    },

    review: {
      patterns: [
        { match: r`\{\+\+.*?\+\+\}`, name: 'markup.inserted.review.yamd' },
        { match: r`\{--.*?--\}`, name: 'markup.deleted.review.yamd' },
        {
          match: r`(\{~~)(.*?)(~>)(.*?)(~~\})`,
          captures: {
            1: { name: 'punctuation.definition.review.yamd' },
            2: { name: 'markup.deleted.review.yamd' },
            3: { name: 'punctuation.separator.review.yamd' },
            4: { name: 'markup.inserted.review.yamd' },
            5: { name: 'punctuation.definition.review.yamd' },
          },
        },
        { match: r`\{==.*?==\}`, name: 'markup.changed.review.yamd' },
        { match: r`\{>>.*?<<\}`, name: 'comment.line.review.yamd' },
      ],
    },

    image: {
      match: r`(!\[)((?:[^\[\]\\]|\\.)*)(\])(\()(\S*?)(\s+"[^"]*")?(\))`,
      captures: {
        1: { name: 'punctuation.definition.link.description.begin.yamd' },
        2: { name: 'string.other.link.description.yamd' },
        3: { name: 'punctuation.definition.link.description.end.yamd' },
        4: { name: 'punctuation.definition.metadata.yamd' },
        5: { name: 'markup.underline.link.image.yamd' },
        6: { name: 'string.other.link.description.title.yamd' },
        7: { name: 'punctuation.definition.metadata.yamd' },
      },
      name: 'meta.image.inline.yamd',
    },

    wikilink: {
      match: r`(\[\[)([^\]|]+)(?:(\|)([^\]]*))?(\]\])`,
      captures: {
        1: { name: 'punctuation.definition.link.begin.yamd' },
        2: { name: 'markup.underline.link.wiki.yamd' },
        3: { name: 'punctuation.separator.yamd' },
        4: { name: 'string.other.link.title.yamd' },
        5: { name: 'punctuation.definition.link.end.yamd' },
      },
      name: 'meta.link.wiki.yamd',
    },

    footnote_ref: {
      patterns: [
        {
          match: r`(\[\^)([^\]\s]+)(\])`,
          captures: {
            1: { name: 'punctuation.definition.constant.begin.yamd' },
            2: { name: 'constant.other.reference.footnote.yamd' },
            3: { name: 'punctuation.definition.constant.end.yamd' },
          },
        },
        {
          match: r`(\^\[)([^\]]*)(\])`,
          captures: {
            1: { name: 'punctuation.definition.constant.begin.yamd' },
            2: { name: 'string.other.footnote.inline.yamd' },
            3: { name: 'punctuation.definition.constant.end.yamd' },
          },
        },
      ],
    },

    citation: {
      match: r`(\[)(@[^\]]+)(\])`,
      captures: {
        1: { name: 'punctuation.definition.constant.begin.yamd' },
        2: { name: 'constant.other.reference.citation.yamd' },
        3: { name: 'punctuation.definition.constant.end.yamd' },
      },
    },

    link: {
      match: r`(\[)((?:[^\[\]\\]|\\.)*)(\])(\()(\S*?)(\s+"[^"]*")?(\))`,
      captures: {
        1: { name: 'punctuation.definition.link.title.begin.yamd' },
        2: { name: 'string.other.link.title.yamd' },
        3: { name: 'punctuation.definition.link.title.end.yamd' },
        4: { name: 'punctuation.definition.metadata.yamd' },
        5: { name: 'markup.underline.link.yamd' },
        6: { name: 'string.other.link.description.title.yamd' },
        7: { name: 'punctuation.definition.metadata.yamd' },
      },
      name: 'meta.link.inline.yamd',
    },

    reference_link: {
      match: r`(\[)((?:[^\[\]\\]|\\.)*)(\])(\[)([^\]]*)(\])`,
      captures: {
        1: { name: 'punctuation.definition.link.title.begin.yamd' },
        2: { name: 'string.other.link.title.yamd' },
        3: { name: 'punctuation.definition.link.title.end.yamd' },
        4: { name: 'punctuation.definition.constant.begin.yamd' },
        5: { name: 'constant.other.reference.link.yamd' },
        6: { name: 'punctuation.definition.constant.end.yamd' },
      },
      name: 'meta.link.reference.yamd',
    },

    span: {
      match: r`(\[)((?:[^\[\]\\]|\\.)*)(\])(?=\{(?![{+\-~=>]))`,
      captures: {
        1: { name: 'punctuation.definition.span.begin.yamd' },
        2: { name: 'markup.other.span.yamd' },
        3: { name: 'punctuation.definition.span.end.yamd' },
      },
    },

    autolink: {
      patterns: [
        { match: r`<(?:https?|mailto):[^\s<>]+>`, name: 'markup.underline.link.yamd' },
        {
          match: r`(?<![\p{L}\p{N}/_.-])(?:https?://|mailto:)[^\s<>]*[^\s<>.,;:!?'")\]*~]`,
          name: 'markup.underline.link.yamd',
        },
      ],
    },

    inline_directive: {
      match: r`(?<=^|[\s(])(:)([A-Za-z][\w-]*)(\[)([^\]]*)(\])`,
      captures: {
        1: { name: 'punctuation.definition.directive.yamd' },
        2: { name: 'entity.name.tag.directive.yamd' },
        3: { name: 'punctuation.definition.directive.label.yamd' },
        4: { name: 'string.other.directive.label.yamd' },
        5: { name: 'punctuation.definition.directive.label.yamd' },
      },
    },

    bold_italic: emphasis(r`\*\*\*`, r`(?<!\*)`, r`(?!\*)`, 'markup.bold.yamd markup.italic.yamd'),
    bold: emphasis(r`\*\*`, r`(?<!\*)`, r`(?!\*)`, 'markup.bold.yamd'),
    italic: emphasis(r`\*`, r`(?<!\*)`, r`(?!\*)`, 'markup.italic.yamd'),
    underline: emphasis(r`\+\+`, r`(?<!\+)`, r`(?!\+)`, 'markup.underline.yamd'),
    // GFM underscores don't work inside words.
    bold_underscore: underscore('__', 'markup.bold.yamd'),
    italic_underscore: underscore('_', 'markup.italic.yamd'),
    strikethrough: emphasis('~~', '(?<!~)', '(?!~)', 'markup.strikethrough.yamd'),
    strikethrough_single: emphasis('~', '(?<!~)', '(?!~)', 'markup.strikethrough.yamd'),
    highlight: emphasis('==', '(?<!=)', '(?!=)', 'markup.highlight.yamd'),
    // LaTeX-style scripts: `H_{2}O`, `x^{2}`, `x^2`, `e^-1`. They follow a non-space character.
    subscript: script('_', 'markup.other.subscript.yamd'),
    superscript: {
      patterns: [
        script(r`\^`, 'markup.other.superscript.yamd'),
        {
          match: r`(?<=\S)(\^)(-?\d+)`,
          captures: {
            1: { name: 'punctuation.definition.superscript.yamd' },
            2: { name: 'markup.other.superscript.yamd' },
          },
        },
      ],
    },
  },
};

/** GFM `_` emphasis, which can't open or close inside a word. */
function underscore(marker, name) {
  return {
    match: `(?<![\\p{L}\\p{N}_])(${marker})(?=[^\\s_])(.+?)(?<=[^\\s_])(${marker})(?![\\p{L}\\p{N}_])`,
    captures: {
      1: { name: 'punctuation.definition.emphasis.yamd' },
      2: { name, patterns: [{ include: '#inline' }] },
      3: { name: 'punctuation.definition.emphasis.yamd' },
    },
  };
}

/** A `marker{...}` script after a non-space character. */
function script(marker, name) {
  return {
    match: `(?<=\\S)(${marker}\\{)([^{}\\n]*)(\\})`,
    captures: {
      1: { name: 'punctuation.definition.script.yamd' },
      2: { name, patterns: [{ include: '#inline' }] },
      3: { name: 'punctuation.definition.script.yamd' },
    },
  };
}

/** An emphasis rule: the opener is followed by a non-space and the closer is preceded by one. */
function emphasis(marker, notBefore, notAfter, name) {
  const ch = marker.startsWith('\\') ? marker.slice(0, 2) : marker[0];
  return {
    match: `${notBefore}(${marker})${notAfter}(?=[^\\s${ch}])(.+?)(?<=[^\\s${ch}])(${marker})${notAfter}`,
    captures: {
      1: { name: 'punctuation.definition.emphasis.yamd' },
      2: { name, patterns: [{ include: '#inline' }] },
      3: { name: 'punctuation.definition.emphasis.yamd' },
    },
  };
}

writeFileSync(new URL('../syntaxes/yamd.tmLanguage.json', import.meta.url), `${JSON.stringify(grammar, null, 2)}\n`);
