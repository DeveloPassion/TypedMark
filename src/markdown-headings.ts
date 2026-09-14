import { Parser, type Node } from "commonmark";

type BlockParser = Parser & { processInlines(block: Node): void };
type SourceNode = Node & { _string_content?: unknown };

/** RHT-56 uses block-parser inline source, not rendered or decoded inline text. */
export function extractHeadings(body: string): Array<{ depth: number; text: string }> {
  // Deliberately isolated internal seam, pinned to commonmark 0.31.2. Parsing
  // inline nodes discards the raw Markdown required by the TypedMark contract.
  // https://github.com/commonmark/commonmark.js/blob/0.31.2/lib/blocks.js
  // See docs/decisions/001-commonmark-heading-source.md before upgrading.
  const parser = new Parser() as BlockParser;
  if (typeof parser.processInlines !== "function") throw new Error("Unsupported CommonMark block-parser API");
  parser.processInlines = () => {};
  const walker = parser.parse(body).walker();
  const headings: Array<{ depth: number; text: string }> = [];
  for (let event = walker.next(); event; event = walker.next()) {
    if (!event.entering || event.node.type !== "heading") continue;
    const node = event.node as SourceNode;
    if (typeof node._string_content !== "string" || typeof node.level !== "number") {
      throw new Error("CommonMark heading source is unavailable");
    }
    headings.push({ depth: node.level, text: node._string_content.replace(/\r\n?|\n/g, " ").trim() });
  }
  return headings;
}
