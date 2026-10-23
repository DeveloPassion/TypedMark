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

export interface BodyBlock {
  kind: "heading" | "code";
  /** 1-based first and last source lines of the block. */
  startLine: number;
  endLine: number;
  depth?: number;
  text?: string;
  info?: string;
  literal?: string;
}

/** Top-level headings and fenced code blocks with their source lines, for writers that move body sections. */
export function locateBodyBlocks(body: string): BodyBlock[] {
  // Same pinned block-parser seam as extractHeadings; sourcepos is 1-based.
  // https://github.com/commonmark/commonmark.js/blob/0.31.2/lib/node.js
  const parser = new Parser() as BlockParser;
  if (typeof parser.processInlines !== "function") throw new Error("Unsupported CommonMark block-parser API");
  parser.processInlines = () => {};
  const document = parser.parse(body);
  const blocks: BodyBlock[] = [];
  for (let node = document.firstChild; node; node = node.next) {
    const [[startLine], [endLine]] = node.sourcepos as [[number, number], [number, number]];
    if (node.type === "heading") {
      const source = (node as SourceNode)._string_content;
      if (typeof source !== "string") throw new Error("CommonMark heading source is unavailable");
      blocks.push({ kind: "heading", startLine, endLine, depth: node.level, text: source.replace(/\r\n?|\n/g, " ").trim() });
    } else if (node.type === "code_block" && (node as Node & { _isFenced?: boolean })._isFenced) {
      blocks.push({ kind: "code", startLine, endLine, info: (node.info ?? "").trim(), literal: node.literal ?? "" });
    }
  }
  return blocks;
}
