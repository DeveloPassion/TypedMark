import { Parser, type Node } from "commonmark";

export interface MarkdownBlockSource {
  kind: "inline" | "html";
  text: string;
  /** UTF-16 offsets into the caller's body; -1 denotes a synthetic newline. */
  offsets: number[];
}

type SourceNode = Node & { _string_content?: string | null };
type SourceParser = Parser & {
  addLine(): void;
  processInlines(block: Node): void;
  tip: SourceNode;
  currentLine: string;
  lineNumber: number;
  offset: number;
  column: number;
  partiallyConsumedTab: boolean;
};
interface CapturedSource { chunks: string[]; length: number; offsets: number[] }

/** Capture source positions while CommonMark removes block-container prefixes. */
export function markdownBlockSources(body: string): MarkdownBlockSource[] {
  const lines: Array<{ start: number; text: string }> = [];
  let start = 0;
  for (const ending of body.matchAll(/\r\n|\r|\n/g)) {
    lines.push({ start, text: body.slice(start, ending.index) });
    start = ending.index + ending[0].length;
  }
  lines.push({ start, text: body.slice(start) });

  const parser = new Parser() as SourceParser;
  if (typeof parser.addLine !== "function" || typeof parser.processInlines !== "function") {
    throw new Error("CommonMark block-source capture is unavailable");
  }
  // Setext replacement retains the same sourcepos array. Keying by that object
  // also survives the parser's later removal of reference-definition prefixes.
  // https://github.com/commonmark/commonmark.js/blob/0.31.2/lib/blocks.js
  const captured = new WeakMap<object, CapturedSource>();
  const addLine = parser.addLine;
  parser.addLine = () => {
    const node = parser.tip;
    if (node.type !== "paragraph" && node.type !== "html_block") { addLine.call(parser); return; }
    const line = lines[parser.lineNumber - 1];
    const before = node._string_content?.length;
    const offset = parser.offset;
    const padding = parser.partiallyConsumedTab ? 4 - parser.column % 4 : 0;
    if (!line || before === undefined || line.text.length !== parser.currentLine.length) {
      throw new Error("CommonMark line-source capture changed");
    }
    const record = captured.get(node.sourcepos) ?? { chunks: [], length: 0, offsets: [] };
    // A setext candidate may remove leading reference definitions and then
    // continue this same paragraph when no heading content remains.
    if (record.length !== before) {
      const previous = record.chunks.join("");
      const shift = record.length - before;
      if (shift < 0 || previous.slice(shift) !== node._string_content) {
        throw new Error("CommonMark block-source prefix removal changed");
      }
      record.chunks = before ? [previous.slice(shift)] : [];
      record.offsets = record.offsets.slice(shift);
      record.length = before;
    }
    if (padding && line.text[offset] !== "\t") {
      throw new Error("CommonMark block-source append changed");
    }
    addLine.call(parser);
    const chunk = " ".repeat(padding) + parser.currentLine.slice(parser.offset) + "\n";
    if (node._string_content?.length !== before + chunk.length || !node._string_content.endsWith(chunk)) {
      throw new Error("CommonMark block-source append changed");
    }
    for (let index = 0; index < padding; index++) record.offsets.push(line.start + offset);
    for (let index = parser.offset; index < line.text.length; index++) record.offsets.push(line.start + index);
    const newline = line.start + line.text.length;
    record.offsets.push(newline < body.length ? newline : -1);
    record.chunks.push(chunk);
    record.length += chunk.length;
    captured.set(node.sourcepos, record);
  };
  // Inline parsing discards _string_content and normalizes some label escapes.
  // Link extraction consumes the retained block source independently.
  parser.processInlines = () => {};
  const walker = parser.parse(body).walker();
  const blocks: MarkdownBlockSource[] = [];
  for (let event = walker.next(); event; event = walker.next()) {
    if (!event.entering || !["paragraph", "heading", "html_block"].includes(event.node.type)) continue;
    const node = event.node as SourceNode;
    const html = node.type === "html_block";
    const content = html ? node.literal : node._string_content;
    if (typeof content !== "string") throw new Error("CommonMark block source is unavailable");
    if (!content) continue;
    const record = captured.get(node.sourcepos);
    let offsets: number[];
    if (record) {
      const appended = record.chunks.join("");
      // HTML finalization removes its last newline; paragraph/setext handling
      // can remove leading reference definitions, but not arbitrary interiors.
      const shift = html ? 0 : appended.length - content.length;
      if (shift < 0 || appended.slice(shift, shift + content.length) !== content) {
        throw new Error("CommonMark block-source finalization changed");
      }
      offsets = record.offsets.slice(shift, shift + content.length);
    } else {
      // ATX headings set their content directly instead of calling addLine.
      const line = lines[node.sourcepos[0][0] - 1];
      const column = node.sourcepos[0][1] - 1;
      const normalized = line?.text.replaceAll("\0", "\uFFFD");
      const marker = normalized?.slice(column).match(/^#{1,6}(?:[ \t]+|$)/u);
      const begin = column + (marker?.[0].length ?? 0);
      if (node.type !== "heading" || !line || !marker || normalized?.slice(begin, begin + content.length) !== content) {
        throw new Error("CommonMark heading-source capture changed");
      }
      offsets = Array.from({ length: content.length }, (_, index) => line.start + begin + index);
    }
    const leading = html ? 0 : content.length - content.trimStart().length;
    let text = html ? content : content.trim();
    offsets = offsets.slice(leading, leading + text.length);
    // FND-94 selects block structure. Keep original link characters for NL-8's
    // shared direct/body parser instead of coercing an authored NUL to U+FFFD.
    text = text.replace(/\uFFFD/gu, (character, index: number) => body[offsets[index]!] === "\0" ? "\0" : character);
    blocks.push({ kind: html ? "html" : "inline", text, offsets });
  }
  return blocks;
}
