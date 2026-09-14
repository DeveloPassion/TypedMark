import { lstatSync, readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { frontmatterFailureRule, parseMarkdown, type MarkdownDocument } from "./frontmatter";
import { isTemplatePlaceholder, validateTemplateValue, type FieldDefinition, type ValueFailure, type Vocabularies } from "./field-values";
import { aliasValueFailure, noteFieldDefinitions } from "./collection-model";

export interface TemplateSchema {
  abstract?: boolean;
  frontmatter?: Record<string, FieldDefinition>;
  template?: { file: string };
  headings?: { required_h2?: string[] };
  mandatory_tags?: string[];
}
export interface TemplateContext {
  mandatory_tags?: string[];
  timezone?: string;
  vocabularies?: Vocabularies;
  extensions?: Record<string, string>;
}
export type TemplateResolution =
  | { kind: "derived"; path: string }
  | { kind: "file"; path: string; document: MarkdownDocument }
  | { kind: "invalid"; path: string; rule: string; message: string };

/** Read a template from a caller-owned stable snapshot; never derive clock/random values. */
export function resolveTemplate(root: string, metadataDirectory: string, noteType: string, schema: TemplateSchema, overrideFile?: string, blockedPaths?: ReadonlySet<string>): TemplateResolution {
  const name = overrideFile ?? schema.template?.file ?? `${noteType}.md`;
  const explicit = overrideFile !== undefined || schema.template?.file !== undefined;
  const parts = name.split("/").filter((part) => part && part !== ".");
  const path = `${metadataDirectory}/templates/${parts.join("/")}`;
  const invalid = (rule: string, message: string): TemplateResolution => ({ kind: "invalid", path, rule, message });
  const missing = (): TemplateResolution => explicit ? invalid("RHT-73", `Explicit template ${name} is missing`) : { kind: "derived", path };
  if (/[\\]/u.test(name) || name.startsWith("/") || /^[A-Za-z]:/u.test(name) || parts.some((part) => part === "..")
    || parts[0] === "templates" || parts[0]?.normalize("NFC") === metadataDirectory.normalize("NFC")) {
    return invalid("NTS-45", "Template path must be relative to the templates directory");
  }
  if (!name.endsWith(".md")) return invalid("NTS-47", "Template path must end in .md");
  if ([...blockedPaths ?? []].some((blocked) => path.normalize("NFC") === blocked || path.normalize("NFC").startsWith(`${blocked}/`))) {
    return invalid("RHT-73", "Template path traverses a symbolic link omitted from the snapshot");
  }
  let current = root;
  const segments = [metadataDirectory, "templates", ...parts];
  // lstat does not follow the final link; inspect every ancestor before reading.
  // https://nodejs.org/docs/latest-v22.x/api/fs.html#fslstatsyncpath-options
  for (const [index, segment] of segments.entries()) {
    const parent = lstatSync(current);
    if (parent.isSymbolicLink() || !parent.isDirectory()) return invalid("RHT-73", "Template ancestors must be ordinary directories");
    const matches = readdirSync(current).filter((entry) => entry.normalize("NFC") === segment.normalize("NFC"));
    if (!matches.length) return missing();
    if (matches.length !== 1) return invalid("RHT-73", "Template path is ambiguous under NFC comparison");
    current = join(current, matches[0]!);
    const entry = lstatSync(current);
    if (entry.isSymbolicLink()) return invalid("RHT-73", "Template path must not traverse a symbolic link");
    if (index === segments.length - 1 && !entry.isFile()) return invalid("RHT-73", "Template must be an ordinary file");
  }
  try {
    const document = parseMarkdown(readFileSync(current), { preserveBodyLineEndings: true });
    if (![null, Object.prototype].includes(Object.getPrototypeOf(document.data))) return invalid("RHT-67", "Template frontmatter must be a mapping");
    return { kind: "file", path, document };
  } catch (error) {
    return invalid(frontmatterFailureRule(error, "RHT-67"), error instanceof Error ? error.message : String(error));
  }
}

export function mandatoryTags(schema: TemplateSchema, config: TemplateContext): string[] {
  const seen = new Set<string>();
  return [...config.mandatory_tags ?? [], ...schema.mandatory_tags ?? []].filter((tag) => {
    const normalized = tag.normalize("NFC");
    if (seen.has(normalized)) return false;
    seen.add(normalized); return true;
  });
}

/** Derive unresolved starter state, not a conforming managed note. */
export function deriveStarter(schema: TemplateSchema, config: TemplateContext, document?: MarkdownDocument): { data: Record<string, unknown>; body: string } {
  const data: Record<string, unknown> = Object.fromEntries(Object.keys(schema.frontmatter ?? {}).map((name) => [name, null]));
  const tags = mandatoryTags(schema, config);
  if (tags.length) data.tags = tags;
  return {
    data: { ...data, ...structuredClone(document?.data ?? {}) },
    body: document?.body ?? (schema.headings?.required_h2 ?? []).map((heading) => `## ${heading}\n`).join("\n"),
  };
}

/** Validate authored template values, before any scaffold values can mask errors. */
export function validateTemplateFields(data: Record<string, unknown>, schema: TemplateSchema, config: TemplateContext, noteType: string): Array<ValueFailure & { field: string }> {
  const failures: Array<ValueFailure & { field: string }> = [];
  const unknown = (field: string) => failures.push({ rule: "RHT-76", field, message: `Template field ${field} is undeclared` });
  const nested = (value: unknown, definition: FieldDefinition, path: string) => {
    if (definition.type === "list" && definition.items && Array.isArray(value)) value.forEach((item, index) => nested(item, definition.items!, `${path}.${index}`));
    if (definition.type !== "object" || !value || typeof value !== "object" || Array.isArray(value)) return;
    for (const [name, child] of Object.entries(value)) {
      if (!Object.hasOwn(definition.fields ?? {}, name)) unknown(`${path}.${name}`);
      else nested(child, definition.fields![name]!, `${path}.${name}`);
    }
  };
  const definitions = noteFieldDefinitions(schema);
  for (const [field, value] of Object.entries(data)) {
    if (!Object.hasOwn(definitions, field)) {
      if (!(field === "template_regions" && config.extensions?.["typedmark:template-tracking"])) unknown(field);
      continue;
    }
    const definition = definitions[field]!;
    if (isTemplatePlaceholder(value, definition)) continue;
    const failure = validateTemplateValue(value, definition, config.timezone ?? "UTC", config.vocabularies)
      ?? (field === "aliases" && Array.isArray(value) ? aliasValueFailure(value.filter((alias) => !isTemplatePlaceholder(alias, definition.items!))) : undefined)
      ?? (field === "note_type" && value !== noteType ? { message: "Template note_type differs from its referencing concrete type" } : undefined);
    if (failure) failures.push({ rule: "RHT-80", field, message: failure.message });
    nested(value, definition, field);
  }
  return failures;
}
