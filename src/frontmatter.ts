import { parseDocument } from "yaml";

export interface MarkdownDocument {
  data: Record<string, unknown>;
  body: string;
  hasFrontmatter: boolean;
}

export class FrontmatterError extends Error {
  constructor(message: string, readonly body = "") { super(message); }
}

export function parseMarkdown(source: string): MarkdownDocument {
  const normalized = source.replace(/^\uFEFF/, "");
  if (!normalized.startsWith("---\n") && !normalized.startsWith("---\r\n")) {
    return { data: {}, body: normalized, hasFrontmatter: false };
  }

  const lines = normalized.split(/\r?\n/);
  const end = lines.findIndex((line, index) => index > 0 && (line === "---" || line === "..."));
  if (end < 0) throw new FrontmatterError("frontmatter is missing its closing delimiter", normalized);
  const body = lines.slice(end + 1).join("\n");

  const document = parseDocument(lines.slice(1, end).join("\n"), { uniqueKeys: true });
  if (document.errors.length > 0) {
    throw new FrontmatterError(document.errors.map((error) => error.message).join("; "), body);
  }
  const value = document.toJS();
  if (value !== null && (typeof value !== "object" || Array.isArray(value))) {
    throw new FrontmatterError("frontmatter must be a mapping", body);
  }
  return {
    data: (value ?? {}) as Record<string, unknown>,
    body,
    hasFrontmatter: true,
  };
}
