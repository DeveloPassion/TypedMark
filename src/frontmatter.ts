import { isMap, parseDocument } from "yaml";

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
export function parseMarkdown(source: string | Uint8Array, options: { preserveBodyLineEndings?: boolean } = {}): MarkdownDocument {
  let decoded: string;
  // Retain the decoded BOM here so the grammar below consumes it exactly once.
  // https://nodejs.org/api/util.html#new-textdecoderencoding-options
  try { decoded = typeof source === "string" ? source : new TextDecoder("utf-8", { fatal: true, ignoreBOM: true }).decode(source); }
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
  let body = lines.slice(end + 1).join("\n");
  if (options.preserveBodyLineEndings) {
    const endings = /\r\n|\r|\n/g;
    let found = true;
    for (let line = 0; line <= end; line++) if (!endings.exec(normalized)) { found = false; break; }
    body = found ? normalized.slice(endings.lastIndex) : "";
  }

  let value: unknown;
  try {
    // A version directive must not override FND-25's Core scalar resolution.
    // Explicit tags retain the ordinary Core-reader behavior, including aliases.
    // https://eemeli.org/yaml/#schema-options
    const document = parseDocument(lines.slice(1, end).join("\n"), {
      version: "1.2", schema: "core", resolveKnownTags: true, merge: false, uniqueKeys: true,
    });
    if (document.errors.length > 0) throw new Error(document.errors.map((error) => error.message).join("; "));
    // An empty document has no content node; an explicit null is a scalar.
    // https://eemeli.org/yaml/#parsing-documents
    if (document.contents !== null && !isMap(document.contents)) throw new Error("frontmatter must be a mapping");
    value = document.contents === null ? {} : document.toJS();
  } catch (error) {
    throw new FrontmatterError(error instanceof Error ? error.message : String(error), body);
  }
  if (value === null || typeof value !== "object" || Array.isArray(value)
    || ![null, Object.prototype].includes(Object.getPrototypeOf(value))) {
    throw new FrontmatterError("frontmatter must be a mapping", body);
  }
  return {
    data: (value ?? {}) as Record<string, unknown>,
    body,
    hasFrontmatter: true,
  };
}
