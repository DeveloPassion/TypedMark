import { expect, test } from "bun:test";
import { Lexer } from "marked";
import { createNoteLinkLexer } from "../src/markdown-inline-lexer";

test.each([
  '[label](N\\(part\\).md "ti\\*tle")',
  '![alt](N\\!part.md "ti\\!tle")',
  '[![alt](I\\(x\\).png "i\\!mage")](Outer\\(x\\).md "outer\\!title")',
])("retains tokenizer unescaping outside the mask phase: %s", (source) => {
  expect(createNoteLinkLexer().inlineTokens(source)).toEqual(Lexer.lexInline(source, { gfm: false }));
});

test("scoped masking and unescaping do not mutate shared masking patterns", () => {
  const rules = Lexer.rules.inline.normal;
  const punctuation = rules.anyPunctuation, blocks = rules.blockSkip;
  const punctuationIndex = punctuation.lastIndex, blockIndex = blocks.lastIndex;
  try {
    punctuation.lastIndex = 7;
    blocks.lastIndex = 9;
    createNoteLinkLexer().inlineTokens('[label](N\\!part.md "ti\\!tle")');
    expect(rules.anyPunctuation).toBe(punctuation);
    expect(rules.blockSkip).toBe(blocks);
    expect(punctuation.lastIndex).toBe(7);
    expect(blocks.lastIndex).toBe(9);
  } finally {
    punctuation.lastIndex = punctuationIndex;
    blocks.lastIndex = blockIndex;
  }
});
