import { Lexer, type Token } from "marked";

export interface ExpansionMarker { descriptor: unknown; region: string; line: number }
export interface MarkerFailure { rule: string; message: string; expansion?: string }

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

/** Recognize source-line markers, excluding CommonMark fenced/indented code. */
export function parseExpansions(body: string): { used: boolean; expansions: ExpansionMarker[]; failures: MarkerFailure[] } {
  const source = body.replace(/\r\n?|\n/g, "\n");
  const lines = source.split("\n");
  const excluded = new Set<number>();
  codeLines(Lexer.lex(source, { gfm: false }), 0, excluded);
  const expansions: ExpansionMarker[] = [];
  const failures: MarkerFailure[] = [];
  const open: Array<{ line: number; descriptor?: unknown }> = [];
  const ids = new Set<string>();
  let used = false;
  const fail = (rule: string, message: string, id?: unknown) => failures.push({ rule, message, ...(typeof id === "string" && /^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(id) ? { expansion: id } : {}) });
  for (let line = 0; line < lines.length; line++) {
    if (excluded.has(line)) continue;
    const text = lines[line]!;
    if (text.includes("<!-- typedmark:expansion")) {
      used = true;
      if (open.length) fail("RHT-100", "Content expansions cannot be nested");
      const entry: { line: number; descriptor?: unknown } = { line }; open.push(entry);
      const marker = /^ {0,3}<!-- typedmark:expansion (\{.*\}) -->(?![\s\S])/u.exec(text);
      if (!marker) { fail("RHT-95", "Invalid expansion start marker"); continue; }
      if (marker[1]!.includes("--")) { fail("RHT-175", "Expansion descriptor contains a double hyphen"); continue; }
      try { entry.descriptor = JSON.parse(marker[1]!); }
      catch { fail("RHT-95", "Expansion descriptor is not a JSON object"); continue; }
      const id = (entry.descriptor as { id?: unknown }).id;
      if (typeof id === "string") {
        if (ids.has(id)) fail("RHT-103", "Duplicate expansion identifier", id);
        ids.add(id);
      }
    } else if (text.includes("<!-- /typedmark:expansion")) {
      used = true;
      if (!/^ {0,3}<!-- \/typedmark:expansion -->(?![\s\S])/u.test(text)) fail("RHT-96", "Invalid expansion closing marker");
      const entry = open.pop();
      if (!entry) { fail("RHT-102", "Expansion closing marker has no start"); continue; }
      if (entry.descriptor !== undefined && open.length === 0) expansions.push({ descriptor: entry.descriptor, region: lines.slice(entry.line + 1, line).join("\n"), line: entry.line });
    }
  }
  for (const entry of open) fail("RHT-101", "Expansion start marker has no closing marker", (entry.descriptor as { id?: unknown } | undefined)?.id);
  return { used, expansions, failures };
}
