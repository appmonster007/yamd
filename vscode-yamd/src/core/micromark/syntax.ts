/**
 * micromark syntax extensions for YAMD's own syntax on top of GFM.
 *
 * Most constructs capture their source as one token ("raw spans"); the adapter turns that text into
 * YAMD nodes, re-parsing inline content where a construct can contain formatting.
 */
import { markdownLineEnding, markdownLineEndingOrSpace, unicodeWhitespace } from 'micromark-util-character';
import { splice } from 'micromark-util-chunked';
import { classifyCharacter } from 'micromark-util-classify-character';
import { resolveAll } from 'micromark-util-resolve-all';
import { codes, constants, types } from 'micromark-util-symbol';
import type { Code, Construct, Effects, Event, Extension, Resolver, State, Token, TokenizeContext } from 'micromark-util-types';
import { parseAttrs } from '../attrs';

declare module 'micromark-util-types' {
  interface TokenTypeMap {
    yamdVariable: 'yamdVariable';
    yamdCritic: 'yamdCritic';
    yamdAttributes: 'yamdAttributes';
    yamdComment: 'yamdComment';
    yamdAttributesFlow: 'yamdAttributesFlow';
    yamdCitation: 'yamdCitation';
    yamdWikilink: 'yamdWikilink';
    yamdEmbed: 'yamdEmbed';
    yamdTag: 'yamdTag';
    yamdBlockId: 'yamdBlockId';
    yamdScript: 'yamdScript';
    yamdInlineFootnote: 'yamdInlineFootnote';
    yamdTextDirective: 'yamdTextDirective';
    yamdMathText: 'yamdMathText';
    yamdMark: 'yamdMark';
    yamdMarkText: 'yamdMarkText';
    yamdMarkSequence: 'yamdMarkSequence';
    yamdMarkSequenceTemporary: 'yamdMarkSequenceTemporary';
    yamdIns: 'yamdIns';
    yamdInsText: 'yamdInsText';
    yamdInsSequence: 'yamdInsSequence';
    yamdInsSequenceTemporary: 'yamdInsSequenceTemporary';
  }
}

type TokenName = keyof import('micromark-util-types').TokenTypeMap;

const cp = (s: string) => s.codePointAt(0) as number;
const charOf = (code: Code) => (code === null || code < 0 ? '' : String.fromCodePoint(code));
const isWhitespace = (code: Code) => code === null || markdownLineEndingOrSpace(code) || unicodeWhitespace(code);

/** A partial construct that matches an exact character sequence. */
function sequence(chars: string): Construct {
  const list = [...chars].map(cp);
  return {
    partial: true,
    tokenize(effects, ok, nok) {
      let i = 0;
      const step: State = (code) => {
        if (code !== list[i]) return nok(code);
        effects.consume(code);
        i++;
        return i === list.length ? ok : step;
      };
      return step;
    },
  };
}

interface RawSpanOptions {
  /** May the content contain line endings? */
  eol?: boolean;
  /** Characters that may not appear in the content. */
  forbid?: string;
  /** Require at least one content character. */
  nonEmpty?: boolean;
  /** Track nesting of these brackets; the close sequence only matches at depth 0. */
  balance?: [string, string];
  /** Check the character before the construct. */
  previous?: (code: Code) => boolean;
  /** Validate the content when the close sequence is found. */
  validate?: (content: string) => boolean;
}

/** A construct that captures `open ... close` as one token of type `type`. */
function rawSpan(type: TokenName, open: string, close: string, options: RawSpanOptions = {}): Construct {
  const closeConstruct = sequence(close);
  const closeFirst = cp(close);
  const [balOpen, balClose] = options.balance ? options.balance.map(cp) : [undefined, undefined];
  return {
    name: type,
    tokenize(this: TokenizeContext, effects: Effects, ok: State, nok: State): State {
      const self = this;
      const openCodes = [...open].map(cp);
      let i = 0;
      let content = '';
      let depth = 0;

      const start: State = (code) => {
        if (options.previous && !options.previous(self.previous)) return nok(code);
        effects.enter(type);
        return openSeq(code);
      };
      const openSeq: State = (code) => {
        if (code !== openCodes[i]) return nok(code);
        effects.consume(code);
        i++;
        return i === openCodes.length ? inside : openSeq;
      };
      const inside: State = (code) => {
        if (code === codes.eof) return nok(code);
        if (markdownLineEnding(code) && !options.eol) return nok(code);
        if (code === closeFirst && depth === 0 && !(options.nonEmpty && content === '')) {
          return effects.attempt(closeConstruct, after, one)(code);
        }
        return one(code);
      };
      const one: State = (code) => {
        if (code === codes.eof) return nok(code);
        if (markdownLineEnding(code) && !options.eol) return nok(code);
        const ch = charOf(code);
        if (options.forbid?.includes(ch)) return nok(code);
        if (code === balOpen) depth++;
        else if (code === balClose) {
          if (depth === 0) return nok(code);
          depth--;
        }
        content += markdownLineEnding(code) ? '\n' : ch;
        effects.consume(code);
        return code === codes.backslash ? escaped : inside;
      };
      // Keep an escaped character from closing the span.
      const escaped: State = (code) => {
        if (code === codes.eof || markdownLineEnding(code)) return inside(code);
        content += charOf(code);
        effects.consume(code);
        return inside;
      };
      const after: State = (code) => {
        if (options.validate && !options.validate(content)) return nok(code);
        effects.exit(type);
        return ok(code);
      };
      return start;
    },
  };
}

const notOpenBrace = (prev: Code) => prev !== codes.leftCurlyBrace;

/** `{{ path }}` (a variable) or `{{@name}}` / `{{@name:FORMAT}}` (a template placeholder, §4.12). */
const variable: Construct = rawSpan('yamdVariable', '{{', '}}', {
  forbid: '{}',
  previous: notOpenBrace,
  validate: (c) => /^\s*(@[A-Za-z_][\w.-]*(:[^{}]*)?|[A-Za-z_][\w.-]*)\s*$/.test(c),
});

/** Review markup. Content may span lines and contain formatting. */
const critic: Construct[] = [
  rawSpan('yamdCritic', '{++', '++}', { eol: true }),
  rawSpan('yamdCritic', '{--', '--}', { eol: true }),
  rawSpan('yamdCritic', '{~~', '~~}', { eol: true, validate: (c) => c.includes('~>') }),
  rawSpan('yamdCritic', '{==', '==}', { eol: true }),
  rawSpan('yamdCritic', '{>>', '<<}', { eol: true }),
];

/** `{#id .class key=value flag}` */
const attributes: Construct = rawSpan('yamdAttributes', '{', '}', {
  forbid: '{',
  previous: notOpenBrace,
  validate: (c) => !/^[+\-~=>]/.test(c) && parseAttrs(c) !== null,
});

/** `%% comment %%`, inside a paragraph. */
const comment: Construct = rawSpan('yamdComment', '%%', '%%', { eol: true });

/** `[@key]`, `[@a; @b, p. 4]` */
const citation: Construct = rawSpan('yamdCitation', '[@', ']', { forbid: '[', nonEmpty: true });

/** `[[target#anchor|label]]` */
const wikilink: Construct = rawSpan('yamdWikilink', '[[', ']]', { forbid: '[', nonEmpty: true });

/** `![[target]]` */
const embed: Construct = rawSpan('yamdEmbed', '![[', ']]', { forbid: '[', nonEmpty: true });

/** `^[inline footnote]` */
const inlineFootnote: Construct = rawSpan('yamdInlineFootnote', '^[', ']', {
  eol: true,
  nonEmpty: true,
  balance: ['[', ']'],
});

const notAfterSpace = (prev: Code) => prev !== null && !isWhitespace(prev);

/** `x^{2}` and `H_{2}O` */
const supBraces: Construct = rawSpan('yamdScript', '^{', '}', { nonEmpty: true, balance: ['{', '}'], previous: notAfterSpace });
const subBraces: Construct = rawSpan('yamdScript', '_{', '}', { nonEmpty: true, balance: ['{', '}'], previous: notAfterSpace });

/** `x^2`, `10^-3`: digits only. */
const supDigits: Construct = {
  name: 'yamdScriptDigits',
  tokenize(this: TokenizeContext, effects, ok, nok) {
    const self = this;
    let digits = 0;
    const start: State = (code) => {
      if (!notAfterSpace(self.previous)) return nok(code);
      effects.enter('yamdScript');
      effects.consume(code);
      return sign;
    };
    const sign: State = (code) => {
      if (code === codes.dash) {
        effects.consume(code);
        return digit;
      }
      return digit(code);
    };
    const digit: State = (code) => {
      if (code !== null && code >= codes.digit0 && code <= codes.digit9) {
        effects.consume(code);
        digits++;
        return digit;
      }
      if (digits === 0) return nok(code);
      effects.exit('yamdScript');
      return ok(code);
    };
    return start;
  },
};

const TAG_CHAR = /[\p{L}\p{N}_/-]/u;

/** `#tag`, `#area/topic` after whitespace, `(` or the start of the line. */
const tag: Construct = {
  name: 'yamdTag',
  tokenize(this: TokenizeContext, effects, ok, nok) {
    const self = this;
    let size = 0;
    let nonDigit = false;
    const start: State = (code) => {
      const prev = self.previous;
      if (!(prev === null || isWhitespace(prev) || prev === codes.leftParenthesis)) return nok(code);
      effects.enter('yamdTag');
      effects.consume(code);
      return name;
    };
    const name: State = (code) => {
      const ch = charOf(code);
      if (ch && TAG_CHAR.test(ch)) {
        if (!/\d/.test(ch)) nonDigit = true;
        size++;
        effects.consume(code);
        return name;
      }
      if (size === 0 || !nonDigit) return nok(code);
      effects.exit('yamdTag');
      return ok(code);
    };
    return start;
  },
};

/** ` ^block-id` at the end of a line. */
const blockId: Construct = {
  name: 'yamdBlockId',
  tokenize(this: TokenizeContext, effects, ok, nok) {
    const self = this;
    let size = 0;
    const start: State = (code) => {
      if (self.previous !== codes.space && self.previous !== codes.horizontalTab) return nok(code);
      effects.enter('yamdBlockId');
      effects.consume(code);
      return id;
    };
    const id: State = (code) => {
      const ch = charOf(code);
      if (ch && /[A-Za-z0-9-]/.test(ch)) {
        size++;
        effects.consume(code);
        return id;
      }
      if (size === 0) return nok(code);
      effects.exit('yamdBlockId');
      return end(code);
    };
    const end: State = (code) => {
      if (code === codes.eof || markdownLineEnding(code)) return ok(code);
      if (code === codes.space || code === codes.horizontalTab) return effects.check(trailingSpace, ok, nok)(code);
      return nok(code);
    };
    return start;
  },
};

const trailingSpace: Construct = {
  partial: true,
  tokenize(effects, ok, nok) {
    const step: State = (code) => {
      if (code === codes.space || code === codes.horizontalTab) {
        effects.consume(code);
        return step;
      }
      return code === codes.eof || markdownLineEnding(code) ? ok(code) : nok(code);
    };
    return step;
  },
};

/** `:name[content]{attrs}` after whitespace, `(` or the start of the line. */
const textDirective: Construct = {
  name: 'yamdTextDirective',
  tokenize(this: TokenizeContext, effects, ok, nok) {
    const self = this;
    let nameSize = 0;
    let depth = 0;
    let attrs = '';
    const start: State = (code) => {
      const prev = self.previous;
      if (!(prev === null || isWhitespace(prev) || prev === codes.leftParenthesis)) return nok(code);
      effects.enter('yamdTextDirective');
      effects.consume(code);
      return name;
    };
    const name: State = (code) => {
      const ch = charOf(code);
      if (nameSize === 0 ? /[A-Za-z]/.test(ch) : /[\w-]/.test(ch)) {
        nameSize++;
        effects.consume(code);
        return name;
      }
      if (nameSize === 0 || code !== codes.leftSquareBracket) return nok(code);
      effects.consume(code);
      return label;
    };
    const label: State = (code) => {
      if (code === codes.eof || markdownLineEnding(code)) return nok(code);
      if (code === codes.backslash) {
        effects.consume(code);
        return labelEscape;
      }
      if (code === codes.leftSquareBracket) depth++;
      if (code === codes.rightSquareBracket) {
        if (depth === 0) {
          effects.consume(code);
          return afterLabel;
        }
        depth--;
      }
      effects.consume(code);
      return label;
    };
    const labelEscape: State = (code) => {
      if (code === codes.eof || markdownLineEnding(code)) return label(code);
      effects.consume(code);
      return label;
    };
    const afterLabel: State = (code) => {
      if (code === codes.leftCurlyBrace) return effects.attempt(attrsConstruct, done, done)(code);
      return done(code);
    };
    const attrsConstruct: Construct = {
      partial: true,
      tokenize(eff, okA, nokA) {
        const open: State = (code) => {
          eff.consume(code);
          return body;
        };
        const body: State = (code) => {
          if (code === codes.eof || markdownLineEnding(code) || code === codes.leftCurlyBrace) return nokA(code);
          if (code === codes.rightCurlyBrace) {
            if (parseAttrs(attrs) === null) return nokA(code);
            eff.consume(code);
            return okA;
          }
          attrs += charOf(code);
          eff.consume(code);
          return body;
        };
        return open;
      },
    };
    const done: State = (code) => {
      effects.exit('yamdTextDirective');
      return ok(code);
    };
    return start;
  },
};

/**
 * `$math$`: the opening `$` is followed by a non-space, and the first unescaped `$` after it must
 * close: preceded by a non-space and not followed by a digit. So `$5 and $10` stays text.
 */
const mathText: Construct = {
  name: 'yamdMathText',
  tokenize(this: TokenizeContext, effects, ok, nok) {
    const self = this;
    let last: Code = null;
    const start: State = (code) => {
      if (self.previous === codes.dollarSign) return nok(code);
      effects.enter('yamdMathText');
      effects.consume(code);
      return first;
    };
    const first: State = (code) => {
      if (code === codes.dollarSign || isWhitespace(code)) return nok(code);
      return inside(code);
    };
    const inside: State = (code) => {
      if (code === codes.eof || markdownLineEnding(code)) return nok(code);
      if (code === codes.dollarSign) {
        if (isWhitespace(last)) return nok(code);
        effects.consume(code);
        return close;
      }
      last = code;
      effects.consume(code);
      return code === codes.backslash ? escaped : inside;
    };
    const escaped: State = (code) => {
      if (code === codes.eof || markdownLineEnding(code)) return inside(code);
      last = code;
      effects.consume(code);
      return inside;
    };
    const close: State = (code) => {
      if (code !== null && code >= codes.digit0 && code <= codes.digit9) return nok(code);
      effects.exit('yamdMathText');
      return ok(code);
    };
    return start;
  },
};

/**
 * Two-character delimiter runs (`==mark==`, `++ins++`) following CommonMark's flanking rules.
 * Adapted from micromark-extension-gfm-strikethrough (MIT).
 */
function attention(marker: number, base: 'yamdMark' | 'yamdIns'): Construct {
  const temporary = `${base}SequenceTemporary` as TokenName;
  const sequenceType = `${base}Sequence` as TokenName;
  const textType = `${base}Text` as TokenName;

  const resolveAllAttention: Resolver = (events, context) => {
    let index = -1;
    while (++index < events.length) {
      const closer = events[index] as Event;
      if (closer[0] === 'enter' && closer[1].type === temporary && closer[1]._close) {
        let open = index;
        while (open--) {
          const opener = events[open] as Event;
          if (opener[0] === 'exit' && opener[1].type === temporary && opener[1]._open) {
            closer[1].type = sequenceType;
            opener[1].type = sequenceType;
            const group: Token = { type: base, start: { ...opener[1].start }, end: { ...closer[1].end } };
            const text: Token = { type: textType, start: { ...opener[1].end }, end: { ...closer[1].start } };
            const next: Event[] = [
              ['enter', group, context],
              ['enter', opener[1], context],
              ['exit', opener[1], context],
              ['enter', text, context],
            ];
            const insideSpan = context.parser.constructs.insideSpan.null;
            if (insideSpan) splice(next, next.length, 0, resolveAll(insideSpan, events.slice(open + 1, index), context));
            splice(next, next.length, 0, [
              ['exit', text, context],
              ['enter', closer[1], context],
              ['exit', closer[1], context],
              ['exit', group, context],
            ]);
            splice(events, open - 1, index - open + 3, next);
            index = open + next.length - 2;
            break;
          }
        }
      }
    }
    for (const event of events) {
      if (event[1].type === temporary) event[1].type = types.data;
    }
    return events;
  };

  return {
    name: base,
    resolveAll: resolveAllAttention,
    tokenize(this: TokenizeContext, effects, ok, nok) {
      const previous = this.previous;
      const events = this.events;
      let size = 0;
      const start: State = (code) => {
        const lastEvent = events[events.length - 1];
        if (previous === marker && lastEvent?.[1].type !== types.characterEscape) return nok(code);
        effects.enter(temporary);
        return more(code);
      };
      const more: State = (code) => {
        const before = classifyCharacter(previous);
        if (code === marker) {
          if (size > 1) return nok(code);
          effects.consume(code);
          size++;
          return more;
        }
        if (size < 2) return nok(code);
        const token = effects.exit(temporary);
        const after = classifyCharacter(code);
        token._open = !after || (after === constants.attentionSideAfter && Boolean(before));
        token._close = !before || (before === constants.attentionSideAfter && Boolean(after));
        return ok(code);
      };
      return start;
    },
  };
}

const mark = attention(codes.equalsTo, 'yamdMark');
const ins = attention(codes.plusSign, 'yamdIns');

/** A line holding only `{attributes}`, which apply to the next block. */
const attributesFlow: Construct = {
  name: 'yamdAttributesFlow',
  tokenize(effects, ok, nok) {
    let body = '';
    const start: State = (code) => {
      effects.enter('yamdAttributesFlow');
      effects.consume(code);
      return first;
    };
    const first: State = (code) => {
      if (code === codes.leftCurlyBrace || code === codes.plusSign || code === codes.dash || code === codes.tilde || code === codes.equalsTo || code === codes.greaterThan) {
        return nok(code);
      }
      return inside(code);
    };
    const inside: State = (code) => {
      if (code === codes.eof || markdownLineEnding(code) || code === codes.leftCurlyBrace) return nok(code);
      if (code === codes.rightCurlyBrace) {
        if (parseAttrs(body) === null) return nok(code);
        effects.consume(code);
        return after;
      }
      body += charOf(code);
      effects.consume(code);
      return inside;
    };
    const after: State = (code) => {
      if (code === codes.space || code === codes.horizontalTab) {
        effects.consume(code);
        return after;
      }
      if (code !== codes.eof && !markdownLineEnding(code)) return nok(code);
      effects.exit('yamdAttributesFlow');
      return ok(code);
    };
    return start;
  },
};

export function yamdSyntax(): Extension {
  return {
    flow: { [codes.leftCurlyBrace]: attributesFlow },
    text: {
      [codes.leftCurlyBrace]: [variable, ...critic, attributes],
      [codes.percentSign]: comment,
      [codes.leftSquareBracket]: [wikilink, citation],
      [codes.exclamationMark]: embed,
      [codes.caret]: [inlineFootnote, supBraces, supDigits, blockId],
      [codes.underscore]: subBraces,
      [codes.numberSign]: tag,
      [codes.colon]: textDirective,
      [codes.dollarSign]: mathText,
      [codes.equalsTo]: mark,
      [codes.plusSign]: ins,
    },
    insideSpan: { null: [mark, ins] },
    attentionMarkers: { null: [codes.equalsTo, codes.plusSign] },
  };
}
