import type { FieldDefinition } from "./field-values";
import type { ValidationReport, ValidationResult } from "./types";
import type { SchemaIssue, SchemaSource } from "./reuse";
type Data = Record<string, any>;

export interface CollectionNote {
  path: string;
  stored: Data;
  body: string;
  candidates?: string[];
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
  schemaIssues?: Map<string, SchemaIssue>;
  schemaSources?: Map<string, SchemaSource[]>;
}

export const CORE_FIELDS: Record<string, Data> = {
  note_type: { type: "text", nullable: false },
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
