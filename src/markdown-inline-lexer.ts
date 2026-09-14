import { Hooks, Lexer, Tokenizer, type MarkedOptions, type Token } from "marked";

class NoteLinkTokenizer extends Tokenizer {
  // Emphasis never excludes note links. Keeping its delimiters as text avoids
  // letting a rendering-only mask change actual link or code-span boundaries.
  override emStrong(): undefined { return undefined; }
}

class NoteLinkLexer extends Lexer {
  #masking = false;

  constructor(extensions?: MarkedOptions["extensions"]) {
    const tokenizer = new NoteLinkTokenizer({ gfm: false });
    const hooks = new Hooks({ gfm: false });
    super({ gfm: false, extensions, tokenizer, hooks });
    const rules = tokenizer.rules;
    // Extensions start at built-in text boundaries; no suffix rescans needed.
    if (["a[[note]]", "a![[note]]", "a<html>"].some((source) => rules.inline.text.exec(source)?.[0] !== "a")) {
      throw new Error("Marked's inline text boundary contract changed");
    }
    const clone = (pattern: RegExp) => new RegExp(pattern.source, pattern.flags);
    const punctuation = clone(rules.inline.anyPunctuation);
    const blocks = clone(rules.inline.blockSkip);
    const references = clone(rules.inline.reflinkSearch);
    const disabled = /(?!)/g;
    const lexer = this;
    // These patterns are also used by tokenizers (notably href/title
    // unescaping). Suppress them only during the rendering-mask phase.
    // https://github.com/markedjs/marked/blob/v18.0.5/src/Lexer.ts
    // https://marked.js.org/using_pro#hooks
    tokenizer.rules = { ...rules, inline: { ...rules.inline,
      get anyPunctuation() { return lexer.#masking ? disabled : punctuation; },
      get blockSkip() { return lexer.#masking ? disabled : blocks; },
      get reflinkSearch() { return lexer.#masking ? disabled : references; },
    } };
    hooks.emStrongMask = (source: string): string => {
      this.#masking = false;
      return source;
    };
  }

  override inlineTokens(source: string, tokens: Token[] = []): Token[] {
    const priorPhase = this.#masking;
    this.#masking = true;
    try {
      const result = super.inlineTokens(source, tokens);
      if (this.#masking) throw new Error("Marked's inline mask hook contract changed");
      return result;
    } finally {
      this.#masking = priorPhase;
    }
  }
}

/** Extraction-only lexer: emphasis stays text; link/code tokenization is intact. */
export function createNoteLinkLexer(extensions?: MarkedOptions["extensions"]): Lexer {
  return new NoteLinkLexer(extensions);
}
