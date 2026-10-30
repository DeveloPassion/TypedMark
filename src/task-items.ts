import { Parser, type Node } from "commonmark";
import type { FieldDefinition } from "./field-values";

type BlockParser = Parser & { processInlines(block: Node): void };
type SourceNode = Node & { _string_content?: unknown };

export type ItemProperty = "text" | "status" | "checked" | "line" | "depth" | "parent_line" | "heading";
export interface TaskItem {
  text: string;
  status: string;
  checked: boolean;
  line: number;
  depth: number;
  parent_line: number | null;
  heading: string | null;
}

/** Item properties behave as fields of these types (ITM-15). */
export const ITEM_PROPERTIES: Record<ItemProperty, FieldDefinition> = {
  text: { type: "text", nullable: false },
  status: { type: "text", nullable: false },
  checked: { type: "checkbox", nullable: false },
  line: { type: "integer", nullable: false },
  depth: { type: "integer", nullable: false },
  parent_line: { type: "integer", nullable: true },
  heading: { type: "text", nullable: true },
};

// One status character in brackets, then a space, a tab, or the end of the line (ITM-6).
const MARKER = /^\[([^\]\r\n])\](?:[ \t]|$)/u;

/**
 * Task items of a note body in document order (ITM-6 to ITM-12). `bodyLine`
 * is the file line the body starts on, so `line` counts frontmatter lines.
 */
export function taskItems(body: string, bodyLine = 1): TaskItem[] {
  // Same pinned block-parser seam as extractHeadings: raw paragraph and heading source.
  const parser = new Parser() as BlockParser;
  if (typeof parser.processInlines !== "function") throw new Error("Unsupported CommonMark block-parser API");
  parser.processInlines = () => {};
  const walker = parser.parse(body).walker();
  const items: TaskItem[] = [];
  const open: Array<{ node: Node; line: number }> = [];
  let heading: string | null = null;
  for (let event = walker.next(); event; event = walker.next()) {
    const node = event.node;
    if (!event.entering) {
      if (open.at(-1)?.node === node) open.pop();
      continue;
    }
    if (node.type === "heading") {
      const source = (node as SourceNode)._string_content;
      if (typeof source !== "string") throw new Error("CommonMark heading source is unavailable");
      heading = source.replace(/\r\n?|\n/g, " ").trim();
      continue;
    }
    // Code and HTML blocks are leaves, so list-like lines inside them never become items (ITM-7).
    if (node.type !== "item") continue;
    const first = node.firstChild;
    const [[start]] = node.sourcepos as [[number, number], [number, number]];
    if (first?.type !== "paragraph" || (first.sourcepos as [[number, number], [number, number]])[0][0] !== start) continue;
    const content = (first as SourceNode)._string_content;
    if (typeof content !== "string") throw new Error("CommonMark paragraph source is unavailable");
    const firstLine = content.split(/\r\n?|\n/u)[0]!;
    const marker = MARKER.exec(firstLine);
    if (!marker) continue;
    const line = start + bodyLine - 1;
    items.push({
      text: firstLine
        .slice(marker[0].length)
        .replace(/^[ \t]+/u, "")
        .trimEnd(),
      status: marker[1]!,
      checked: marker[1] !== " ",
      line,
      depth: open.length,
      parent_line: open.at(-1)?.line ?? null,
      heading,
    });
    open.push({ node, line });
  }
  return items;
}
