import { parseDocument } from "yaml";

export interface MarkdownDocument {
  data: Record<string, unknown>;
  body: string;
  hasFrontmatter: boolean;
}

export class FrontmatterError extends Error {
  constructor(message: string, readonly body = "", readonly rule?: string) { super(message); }
}

export function frontmatterFailureRule(error: unknown, fallback: string): string {
  return error instanceof FrontmatterError ? error.rule ?? fallback : fallback;
}

// Filesystem consumers pass bytes so invalid UTF-8 cannot be silently replaced
// before parsing. String callers supply already-decoded text.
export function parseMarkdown(source: string | Uint8Array): MarkdownDocument {
  let decoded: string;
  try { decoded = typeof source === "string" ? source : new TextDecoder("utf-8", { fatal: true }).decode(source); }
  catch (error) {
    if (error instanceof TypeError) throw new FrontmatterError("Markdown is not valid UTF-8", "", "FND-28");
    throw error;
  }
  const normalized = decoded.replace(/^\uFEFF/, "");
  const lines = normalized.split(/\r\n?|\n/);
  if (lines[0] !== "---") {
    return { data: {}, body: normalized, hasFrontmatter: false };
  }

  const end = lines.findIndex((line, index) => index > 0 && (line === "---" || line === "..."));
  if (end < 0) return { data: {}, body: normalized, hasFrontmatter: false };
  const body = lines.slice(end + 1).join("\n");

  let value: unknown;
  try {
    const document = parseDocument(lines.slice(1, end).join("\n"), { uniqueKeys: true });
    if (document.errors.length > 0) throw new Error(document.errors.map((error) => error.message).join("; "));
    value = document.toJS();
  } catch (error) {
    throw new FrontmatterError(error instanceof Error ? error.message : String(error), body);
  }
  if (value !== null && (typeof value !== "object" || Array.isArray(value))) {
    throw new FrontmatterError("frontmatter must be a mapping", body);
  }
  return {
    data: (value ?? {}) as Record<string, unknown>,
    body,
    hasFrontmatter: true,
  };
}
