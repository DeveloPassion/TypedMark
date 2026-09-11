import { Lexer, type Token } from "marked";

export interface BodyRegion { descriptor: unknown; region: string; line: number; endLine: number }
export interface RegionFailure { rule: string; message: string; id?: string }
export interface RegionRange { line: number; endLine: number }
type Kind = "expansion" | "template-region";
const rules = {
  expansion: { start: "RHT-95", end: "RHT-96", nested: "RHT-100", duplicate: "RHT-103", unmatchedStart: "RHT-101", unmatchedEnd: "RHT-102", hyphen: "RHT-175" },
  "template-region": { start: "RHT-181", end: "RHT-182", nested: "RHT-190", duplicate: "RHT-189", unmatchedStart: "RHT-187", unmatchedEnd: "RHT-188", hyphen: "RHT-185" },
};

function codeLines(tokens: Token[], start: number, excluded: Set<number>): void {
  let line = start;
  for (const token of tokens) {
    const lines = token.raw.split("\n").length - 1;
    if (token.type === "code") for (let index = line; index < line + lines + (token.raw.endsWith("\n") ? 0 : 1); index++) excluded.add(index);
    else if (token.type === "blockquote") codeLines(token.tokens ?? [], line, excluded);
    else if (token.type === "list") {
      let itemLine = line;
      for (const item of token.items) { codeLines(item.tokens, itemLine, excluded); itemLine += item.raw.split("\n").length - 1; }
    }
    line += lines;
  }
}

/** Shared source-line extraction; descriptor semantics remain with each contract. */
export function parseBodyRegions(body: string, kind: Kind) {
  const source = body.replace(/\r\n?/g, "\n");
  const lines = source.split("\n");
  const excluded = new Set<number>();
  codeLines(Lexer.lex(source, { gfm: false }), 0, excluded);
  const regions: BodyRegion[] = [];
  const ranges: RegionRange[] = [];
  const failures: RegionFailure[] = [];
  const open: Array<{ line: number; descriptor?: { id?: unknown } }> = [];
  const ids = new Set<string>();
  const rule = rules[kind];
  const startPattern = new RegExp(`^ {0,3}<!-- typedmark:${kind} (\\{.*\\}) -->(?![\\s\\S])`, "u");
  const endPattern = new RegExp(`^ {0,3}<!-- /typedmark:${kind} -->(?![\\s\\S])`, "u");
  let used = false;
  const fail = (rule: string, message: string, id?: unknown) => failures.push({ rule, message, ...(typeof id === "string" && /^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(id) ? { id } : {}) });
  for (let line = 0; line < lines.length; line++) {
    if (excluded.has(line)) continue;
    const text = lines[line]!;
    if (text.includes(`<!-- typedmark:${kind}`)) {
      used = true;
      if (open.length) fail(rule.nested, `${kind} regions cannot be nested`, kind === "template-region" ? open.at(-1)?.descriptor?.id : undefined);
      const entry: { line: number; descriptor?: { id?: unknown } } = { line }; open.push(entry);
      const marker = startPattern.exec(text);
      if (!marker) { fail(rule.start, `Invalid ${kind} start marker`); continue; }
      if (marker[1]!.includes("--")) { fail(rule.hyphen, "Region descriptor contains a double hyphen"); continue; }
      try { entry.descriptor = JSON.parse(marker[1]!); }
      catch { fail(rule.start, "Region descriptor is not a JSON object"); continue; }
      const id = entry.descriptor?.id;
      if (kind === "template-region" && open.length > 1) fail(rule.nested, `${kind} regions cannot be nested`, id);
      if (typeof id === "string") { if (ids.has(id)) fail(rule.duplicate, "Duplicate region identifier", id); ids.add(id); }
    } else if (text.includes(`<!-- /typedmark:${kind}`)) {
      used = true;
      const entry = open.pop();
      if (!endPattern.test(text)) fail(rule.end, `Invalid ${kind} closing marker`, kind === "template-region" ? entry?.descriptor?.id : undefined);
      if (!entry) { fail(rule.unmatchedEnd, "Region closing marker has no start"); continue; }
      ranges.push({ line: entry.line, endLine: line });
      if (entry.descriptor !== undefined && open.length === 0) regions.push({ descriptor: entry.descriptor, region: lines.slice(entry.line + 1, line).join("\n"), line: entry.line, endLine: line });
    }
  }
  for (const entry of open) { fail(rule.unmatchedStart, "Region start marker has no closing marker", entry.descriptor?.id); ranges.push({ line: entry.line, endLine: lines.length }); }
  return { used, regions, ranges, failures };
}
