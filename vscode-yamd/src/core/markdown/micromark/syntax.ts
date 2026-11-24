/**
 * micromark syntax extensions for YAMD's own syntax on top of GFM.
 *
 * Most constructs capture their source as one token ("raw spans"); the adapter turns that text into
 * YAMD nodes, re-parsing inline content where a construct can contain formatting.
 */
import { markdownLineEnding, markdownLineEndingOrSpace, unicodeWhitespace } from 'micromark-util-character';
import { codes, types } from 'micromark-util-symbol';
import type { Code, Construct, Effects, Extension, State, TokenizeContext } from 'micromark-util-types';
import { parseAttrs } from '../attrs';

declare module 'micromark-util-types' {
  interface TokenTypeMap {
    yamdAttributes: 'yamdAttributes';
    yamdAttributesFlow: 'yamdAttributesFlow';
    yamdWikilink: 'yamdWikilink';
    yamdTag: 'yamdTag';
    yamdMathText: 'yamdMathText';
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

/** `{#id .class key=value flag}` */
const attributes: Construct = rawSpan('yamdAttributes', '{', '}', {
  forbid: '{',
  previous: notOpenBrace,
  validate: (c) => parseAttrs(c) !== null,
});

/** `[[target#anchor|label]]` */
const wikilink: Construct = rawSpan('yamdWikilink', '[[', ']]', { forbid: '[', nonEmpty: true });

const notAfterSpace = (prev: Code) => prev !== null && !isWhitespace(prev);

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

/**
 * `yamd` is the full syntax, used inside widget blocks (tags, `{key=value}` attributes, variables…).
 * `gfm` is for ordinary prose, where only Markdown's own syntax applies, plus `[[wikilinks]]`.
 */
export type Dialect = 'yamd' | 'gfm';

export function yamdSyntax(dialect: Dialect = 'yamd'): Extension {
  if (dialect === 'gfm') return { text: { [codes.leftSquareBracket]: [wikilink] } };
  return {
    flow: { [codes.leftCurlyBrace]: attributesFlow },
    text: {
      [codes.leftCurlyBrace]: [attributes],
      [codes.leftSquareBracket]: [wikilink],
      [codes.numberSign]: tag,
      [codes.dollarSign]: mathText,
    },
  };
}
