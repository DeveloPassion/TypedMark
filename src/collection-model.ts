import type { FieldDefinition, ValueFailure } from "./field-values";
import type { ValidationReport, ValidationResult } from "./types";
import type { SchemaIssue, SchemaSource } from "./reuse";
type Data = Record<string, any>;

export interface CollectionNote {
  path: string;
  stored: Data;
  body: string;
  candidates?: string[];
  hasFrontmatter?: boolean;
  frontmatterValid?: boolean;
}
export interface ManagedNote extends CollectionNote {
  noteType: string;
  values: Data;
  fields: Record<string, FieldDefinition>;
  problems: ValidationResult[];
}
export interface CollectionModel {
  report: ValidationReport;
  config: Data;
  schemas: Map<string, Data>;
  documents: CollectionNote[];
  notes: ManagedNote[];
  assets: Set<string>;
  // Association availability is independent of diagnostic severity/suppression.
  associationIssue?: string;
  configurationIssue?: string;
  schemaIssues?: Map<string, SchemaIssue>;
  schemaSources?: Map<string, SchemaSource[]>;
}

export const CORE_FIELDS: Record<string, Data> = {
  note_type: { type: "text", nullable: false },
  // Null models the no-identifier fallback; an explicitly stored null is invalid.
  id: { type: "text", format: "slug", nullable: true },
  deleted: { type: "checkbox", nullable: false, default_value: false },
  archived: { type: "checkbox", nullable: false, default_value: false },
  aliases: { type: "list", items: { type: "text" }, nullable: false, default_value: [] },
  tags: { type: "tags", nullable: false, default_value: [] },
  title: { type: "text", nullable: true },
  description: { type: "text", nullable: true },
  created_at: { type: "datetime", nullable: true, generated: "now" },
  updated_at: { type: "datetime", nullable: true, generated: "now_on_write" },
};

export function noteFieldDefinitions(schema: Data): Record<string, FieldDefinition> {
  const fields: Record<string, FieldDefinition> = {};
  for (const [name, definition] of Object.entries(CORE_FIELDS)) fields[name] = { ...definition, ...(schema.frontmatter?.[name] ?? {}) };
  for (const [name, definition] of Object.entries(schema.frontmatter ?? {})) fields[name] = { ...(fields[name] ?? {}), ...(definition as Data) };
  return fields;
}

// These intrinsic alias constraints remain in force when a schema customizes
// the list or supplies a default; they are not replaceable field declarations.
export function aliasValueFailure(value: unknown): ValueFailure | undefined {
  if (!Array.isArray(value) || !value.every((alias) => typeof alias === "string")) return undefined;
  const normalized = value.map((alias) => alias.normalize("NFC"));
  if (normalized.some((alias) => alias.length === 0) || new Set(normalized).size !== normalized.length) {
    return { rule: "MN-35", message: "aliases must contain unique non-empty text values" };
  }
  if (normalized.some((alias) => /[/\\#^|\r\n]/u.test(alias))) return { rule: "MN-82", message: "aliases cannot contain path separators, link metacharacters, or line breaks" };
}
