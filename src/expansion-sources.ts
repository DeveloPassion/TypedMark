import { posix } from "node:path";
import type { CollectionModel, CollectionNote, ManagedNote } from "./collection-model";
import { parseNoteLink, resolveNoteLink, buildRelationshipGraph, type RelationshipGraph } from "./note-links";
import { evaluateQueryWithColumns, parseQuery, QueryError, requireSchemaModel } from "./query-engine";
import { matchesNoteType } from "./reuse";
import { compareUnicodeCodePoints } from "./order";
import type { FieldDefinition } from "./field-values";
import type { SchemaRegistry } from "./schema-registry";
import type { TabularSource } from "./views";

type Data = Record<string, any>;
export class ExpansionError extends Error {
  constructor(readonly rule: string, message: string) { super(message); }
}

export function expansionValues(value: unknown, definition?: FieldDefinition): string[] {
  if (value === null || value === undefined) return [];
  const scalar = (value: unknown, definition?: FieldDefinition): string => {
    if (typeof value === "string") return value;
    if (typeof value === "boolean") return String(value);
    if (typeof value === "number" && Number.isFinite(value)) return (definition?.type === "integer" || (!definition && Number.isInteger(value))) ? BigInt(value).toString() : String(value);
    throw new ExpansionError("RHT-120", "Expansion values must be scalars or flat non-null scalar lists");
  };
  return Array.isArray(value) ? value.map((item) => scalar(item, definition?.items)) : [scalar(value, definition)];
}

export function relationshipLink(path: string): string {
  const label = posix.basename(path, ".md").replace(/[\\\[\]]/g, "\\$&");
  const destination = [...new TextEncoder().encode(path.normalize("NFC"))].map((byte) => /[A-Za-z0-9._~/-]/.test(String.fromCharCode(byte)) ? String.fromCharCode(byte) : `%${byte.toString(16).toUpperCase().padStart(2, "0")}`).join("");
  return `[${label}](/${destination})`;
}

export function validateSourceContract(source: Data, version: string, tables: Map<string, TabularSource>): void {
  if (source.kind === "query") {
    if (source.query.specification_version !== version) throw new ExpansionError("RHT-247", "Query version differs from inherited expansion version");
    if (source.query.select.filter((column: Data) => column.as === source.column).length !== 1) throw new ExpansionError("RHT-249", "Source column must resolve to one query projection");
  } else if (source.kind === "dataset" || source.kind === "view") {
    const table = tables.get(`${source.kind}:${source[source.kind]}`);
    if (table && table.version !== version) throw new ExpansionError(source.kind === "view" ? "RHT-260" : "RHT-275", "Source and expansion specification versions differ");
  }
}

export function expansionSources(model: CollectionModel, registry: SchemaRegistry, tables: Map<string, TabularSource>) {
  const notes = new Map(model.notes.map((note) => [note.path, note]));
  let graph: RelationshipGraph | undefined;
  const requireContract = (extension: string) => {
    if (!model.report.evaluated_extensions[extension]) throw new QueryError("RHT-163", `Required source contract ${extension} is unavailable`, { extension });
  };
  const fieldValues = (document: CollectionNote, field: string, rule: string): string[] => {
    const note = notes.get(document.path);
    if (note) {
      requireSchemaModel(model, note.noteType);
      if (!Object.hasOwn(note.fields, field)) throw new ExpansionError(rule, `Undeclared source field ${field}`);
    }
    return expansionValues(Object.hasOwn(document.stored, field) ? document.stored[field] : undefined, note?.fields[field]);
  };
  return (source: Data, document: CollectionNote, version: string): string[] => {
    if (source.kind === "self_field") {
      if (document.hasFrontmatter === false || document.frontmatterValid === false) throw new ExpansionError("RHT-169", "self_field requires valid frontmatter");
      return fieldValues(document, source.field, "RHT-171");
    }
    if (source.kind === "note_field") {
      const link = parseNoteLink(source.note);
      if (!link) throw new ExpansionError("RHT-122", "Unsupported note-field link");
      const resolved = resolveNoteLink(link, document.path, model);
      const target = resolved.kind === "note" ? notes.get(resolved.path) : undefined;
      if (!target) throw new ExpansionError("RHT-123", "note_field must resolve to one managed note");
      return fieldValues(target, source.field, "RHT-172");
    }
    if (source.kind === "file") return [source.value === "path" ? document.path : posix.basename(document.path, source.value === "stem" ? ".md" : undefined)];
    if (source.kind === "relationship") {
      const note = notes.get(document.path);
      if (!note) throw new ExpansionError("RHT-125", "Relationship sources require a managed note");
      requireSchemaModel(model, note.noteType);
      for (const type of source.target_note_types ?? []) {
        if (!model.schemas.has(type)) throw new ExpansionError("RHT-170", `Unknown relationship filter type ${type}`);
        requireSchemaModel(model, type);
      }
      graph ??= buildRelationshipGraph(model, (actual, requested) => matchesNoteType(model.schemas, actual, requested));
      const failures = source.direction === "inbound" ? [...graph.failures.values()].flat() : graph.failures.get(note.path) ?? [];
      if (failures.length) {
        const failure = failures.find((failure) => failure.schemaIssue?.kind === "unavailable") ?? failures[0]!;
        const issue = failure.schemaIssue;
        if (issue?.kind === "unavailable") throw new QueryError("RHT-163", issue.message, issue.extension ? { extension: issue.extension } : { specificationVersion: issue.specificationVersion!, path: issue.path });
        throw new ExpansionError("RHT-163", failure.message);
      }
      let selected: ManagedNote[] = source.direction === "inbound"
        ? model.notes.filter((candidate) => graph!.targets.get(candidate.path)?.[source.relationship as "related_to" | "belongs_to"].has(note.path))
        : [...graph.targets.get(note.path)![source.relationship as "related_to" | "belongs_to"]].map((path) => notes.get(path)!);
      if (source.target_note_types) selected = selected.filter((target) => source.target_note_types.some((type: string) => matchesNoteType(model.schemas, target.noteType, type)));
      selected.sort((a, b) => compareUnicodeCodePoints(a.path, b.path));
      return selected.flatMap((target) => {
        requireSchemaModel(model, target.noteType);
        return source.field === undefined ? [relationshipLink(target.path)] : fieldValues(target, source.field, "RHT-173");
      });
    }
    if (["query", "dataset", "view"].includes(source.kind)) {
      requireContract("typedmark:queries");
      let evaluation;
      let presented: Set<string> | undefined;
      if (source.kind === "query") {
        if (source.query.specification_version !== version) throw new ExpansionError("RHT-247", "Query version differs from inherited expansion version");
        evaluation = evaluateQueryWithColumns(model, parseQuery(source.query, registry));
      } else {
        requireContract("typedmark:views");
        const table = tables.get(`${source.kind}:${source[source.kind]}`);
        if (!table) throw new ExpansionError(source.kind === "view" ? "RHT-259" : "RHT-274", "Unknown expansion artifact source");
        if (table.error) throw table.error;
        if (table.version !== version) throw new ExpansionError(source.kind === "view" ? "RHT-260" : "RHT-275", "Source and expansion specification versions differ");
        presented = table.presented;
        evaluation = table.evaluation!;
      }
      if (!evaluation.columns.has(source.column)) throw new ExpansionError(source.kind === "query" ? "RHT-249" : source.kind === "dataset" ? "RHT-277" : "RHT-262", "Unknown projected expansion column");
      if (source.kind === "view" && !presented?.has(source.column)) throw new ExpansionError("RHT-263", "Column is not presented by the view");
      return evaluation.result.rows.flatMap((row, index) => expansionValues(row[source.column], evaluation.rowDefinitions[index]?.[source.column]));
    }
    throw new ExpansionError("RHT-163", "Source cannot be evaluated during read-only validation");
  };
}
