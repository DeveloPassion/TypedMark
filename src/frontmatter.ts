import { parseDocument } from "yaml";

export interface MarkdownDocument {
  data: Record<string, unknown>;
  body: string;
  hasFrontmatter: boolean;
}

export class FrontmatterError extends Error {}

export function parseMarkdown(source: string): MarkdownDocument {
  const normalized = source.replace(/^\uFEFF/, "");
  if (!normalized.startsWith("---\n") && !normalized.startsWith("---\r\n")) {
    return { data: {}, body: normalized, hasFrontmatter: false };
  }

  const lines = normalized.split(/\r?\n/);
  const end = lines.indexOf("---", 1);
  if (end < 0) throw new FrontmatterError("frontmatter is missing its closing delimiter");

  const document = parseDocument(lines.slice(1, end).join("\n"), { uniqueKeys: true });
  if (document.errors.length > 0) {
    throw new FrontmatterError(document.errors.map((error) => error.message).join("; "));
  }
  const value = document.toJS();
  if (value !== null && (typeof value !== "object" || Array.isArray(value))) {
    throw new FrontmatterError("frontmatter must be a mapping");
  }
  return {
    data: (value ?? {}) as Record<string, unknown>,
    body: lines.slice(end + 1).join("\n"),
    hasFrontmatter: true,
  };
}
