import { noteFieldDefinitions, type CollectionModel, type ManagedNote } from "./collection-model";
import type { SchemaRegistry } from "./schema-registry";
import { compareUnicodeCodePoints } from "./order";
import { buildRelationshipGraph, type NoteLinkError } from "./note-links";
import { matchesNoteType } from "./reuse";
import { validateFieldDefinition } from "./field-definitions";
import { hasComputed } from "./expressions";
import { classifyConversion, comparisonDomain, compareFieldValues, equalFieldValues, fullPattern, validateFieldValue, type FieldDefinition } from "./field-values";

type Row = Record<string, unknown>;
type Kind = "belongs_to" | "related_to";
type Predicate =
  | { kind: "all"; predicates: Predicate[] }
  | { kind: "any"; predicates: Predicate[] }
  | { kind: "not"; predicate: Predicate }
  | { kind: "path"; operator: "equals" | "under" | "regex"; value: string }
  | { kind: "field"; field: string; operator: string; value: unknown }
  | { kind: "relationship"; relationship: Kind; direction?: "inbound" | "outbound"; note_types?: string[]; where?: Predicate; count?: { min?: number; max?: number } };
type Source = { note_types: string[]; field: string; conversion?: "lossless" | "conditional" };
type Projection =
  | { kind: "path"; as: string }
  | { kind: "note_type"; as: string }
  | { kind: "field"; as: string; field: string }
  | { kind: "mapped_field"; as: string; definition: FieldDefinition; sources: Source[] };
export interface Descriptor {
  specification_version: string;
  note_types?: string[];
  include_deleted?: boolean;
  where?: Predicate;
  select: Projection[];
  order_by?: Array<{ column: string; direction?: "asc" | "desc"; nulls?: "first" | "last" }>;
  group_by?: string[];
  limit?: number;
}
interface Provenance { path: string; field: string; source_backed: boolean }
interface Cell { value: unknown; definition?: FieldDefinition; source: Provenance | null }
export interface QueryResult {
  evaluation: "complete" | "incomplete";
  rows: Row[];
  provenance: Array<Record<string, Provenance | null>>;
  groups?: Array<{ key: unknown[]; rows: Row[] }>;
}
export interface QueryEvaluation {
  result: QueryResult;
  columns: Map<string, FieldDefinition[]>;
  admittedTypes: string[];
  rowDefinitions: Array<Record<string, FieldDefinition | undefined>>;
}
export type QueryUnavailability = { extension: string } | { specificationVersion: string; path?: string };
export class QueryError extends Error {
  constructor(readonly rule_id: string, message: string, readonly unavailable?: QueryUnavailability) { super(`${rule_id}: ${message}`); }
}
function fail(rule: string, message: string, unavailable?: QueryUnavailability): never { throw new QueryError(rule, message, unavailable); }
export const QUERY_VERSION = "0.1.0";

export function parseQuery(input: unknown, registry: SchemaRegistry): Descriptor {
  const errors = registry.validate("query.schema.json", input);
  if (errors.length) fail("CM-301", errors.map((error) => `${error.instancePath} ${error.message}`).join("; "));
  const query = input as Descriptor;
  if (!query.specification_version.startsWith("0.1.")) fail("CM-405", "Unsupported query specification compatibility line", { specificationVersion: query.specification_version });
  return query;
}

function lookup(note: ManagedNote, path: string): { definition?: FieldDefinition; present: boolean; stored: unknown; effective: unknown } {
  const declared = definitionAt(note.fields, path);
  const segments = path.split(".");
  let fields = note.fields;
  let definition: FieldDefinition | undefined;
  let stored: unknown = note.stored;
  let effective: unknown = note.values;
  let present = true;
  for (let index = 0; index < segments.length; index++) {
    const segment = segments[index]!;
    definition = fields && Object.hasOwn(fields, segment) ? fields[segment] : undefined;
    present = present && stored !== null && typeof stored === "object" && Object.hasOwn(stored, segment);
    stored = present ? (stored as Row)[segment] : undefined;
    effective = effective !== null && typeof effective === "object" && Object.hasOwn(effective, segment) ? (effective as Row)[segment] : undefined;
    if (index < segments.length - 1 && definition) {
      if (definition.type !== "object") fail("CM-328", `Field path ${path} traverses a non-object field`);
      fields = definition.fields ?? {};
    } else fields = {};
  }
  return { definition: declared, present: !!declared && present, stored, effective };
}

export function definitionAt(fields: Record<string, FieldDefinition>, path: string): FieldDefinition | undefined {
  const segments = path.split(".");
  let definition: FieldDefinition | undefined;
  for (let index = 0; index < segments.length; index++) {
    const name = segments[index]!;
    definition = Object.hasOwn(fields, name) ? fields[name] : undefined;
    if (!definition) return undefined;
    if (index < segments.length - 1) {
      if (definition.type !== "object") fail("CM-328", `Field path ${path} traverses a non-object field`);
      fields = definition.fields ?? {};
    }
  }
  return definition;
}

function scalarDefinition(cell: Cell): FieldDefinition {
  if (cell.definition && cell.definition.type !== "any") return cell.definition;
  return { type: typeof cell.value === "number" ? "number" : typeof cell.value === "boolean" ? "checkbox" : "text" };
}

function equalCells(left: Cell, right: Cell, timezone: string): boolean {
  if (left.value === null || right.value === null) return left.value === right.value;
  const a = scalarDefinition(left); const b = scalarDefinition(right);
  return comparisonDomain(a) === comparisonDomain(b) && equalFieldValues(left.value, right.value, a, timezone);
}

function checkDefinition(definition: FieldDefinition, model: CollectionModel, target: boolean): void {
  const forbidden = ["validate_exists", "generated", "computed", "unique", "deprecated", "immutable", "default_value", "const_value", "relationship_kind"];
  if (target && forbidden.some((key) => Object.hasOwn(definition, key))) fail("CM-489", "Mapped definitions describe result values, not stored fields");
  const failure = validateFieldDefinition(definition, model.config.timezone ?? "UTC", model.config.vocabularies);
  if (failure) fail(failure.rule, failure.message);
  if (target) {
    if (definition.items) checkDefinition(definition.items, model, true);
    for (const child of Object.values(definition.fields ?? {})) checkDefinition(child, model, true);
  }
}

function checkConversion(source: FieldDefinition, target: FieldDefinition, declared?: string): void {
  const conversion = classifyConversion(source, target);
  if (conversion === "incompatible") fail("CM-488", "The mapped source and target types are incompatible");
  if (!declared && conversion !== "exact") fail("CM-484", `A ${conversion} conversion must be declared explicitly`);
  if (declared && declared !== conversion) fail("CM-483", "Declared conversion class differs from the actual conversion");
}

export function requireSchemaModel(model: CollectionModel, type: string): void {
  const issue = model.schemaIssues?.get(type);
  if (issue) fail("CM-308", issue.message, issue.kind === "invalid" ? undefined : issue.extension ? { extension: issue.extension } : { specificationVersion: issue.specificationVersion!, path: issue.path });
  const schema = model.schemas.get(type);
  if (!schema) fail("CM-311", `Unknown note type ${type}`);
  if (!String(schema.specification_version).startsWith("0.1.")) fail("CM-308", `${type} uses an unsupported specification compatibility line`, { specificationVersion: String(schema.specification_version), path: `${model.config.metadata_directory ?? ".typedmark"}/schemas/${type}.md` });
  const needsReuse = model.config.default_property_sets || schema.abstract || schema.extends || schema.property_sets || schema.exclude_property_sets || schema.frontmatter_remove || schema.conditions;
  if (needsReuse && !model.report.evaluated_extensions["typedmark:reuse"]) fail("CM-308", `${type} requires Reuse to construct its effective model`, { extension: "typedmark:reuse" });
  if (hasComputed(noteFieldDefinitions(schema)) && !model.report.evaluated_extensions["typedmark:expressions"]) fail("CM-308", `${type} requires expression evaluation`, { extension: "typedmark:expressions" });
}

export function evaluateQuery(model: CollectionModel, query: Descriptor): QueryResult {
  return evaluateQueryWithColumns(model, query).result;
}

export function evaluateQueryWithColumns(model: CollectionModel, query: Descriptor): QueryEvaluation {
  const timezone = model.config.timezone ?? "UTC";
  const invalid = model.report.results.find((result) => result.severity === "error" && result.path === "typedmark.md"
    && ["invalid_collection_configuration", "unsupported_specification_version"].includes(result.code));
  if (invalid) fail("CM-308", invalid.message, invalid.code === "unsupported_specification_version" ? { specificationVersion: String(model.config.specification_version), path: invalid.path } : undefined);
  const checkTypes = (types?: string[]) => { for (const type of types ?? []) requireSchemaModel(model, type); };
  const matchesType = (type: string, requested: string) => matchesNoteType(model.schemas, type, requested);
  const admitted = (type: string, types?: string[]) => !types || types.some((requested) => matchesType(type, requested));
  const checkPredicate = (predicate: Predicate): void => {
    if (predicate.kind === "all" || predicate.kind === "any") predicate.predicates.forEach(checkPredicate);
    else if (predicate.kind === "not") checkPredicate(predicate.predicate);
    else if (predicate.kind === "relationship") {
      checkTypes(predicate.note_types);
      if ((predicate.count?.min ?? 0) > (predicate.count?.max ?? Infinity)) fail("CM-356", "Relationship minimum exceeds maximum");
      if (predicate.where) checkPredicate(predicate.where);
    } else if (predicate.operator === "regex") {
      try { fullPattern(String(predicate.value)); } catch { fail("CM-339", "Invalid Unicode regular expression"); }
    }
  };
  checkTypes(query.note_types);
  if (query.where) checkPredicate(query.where);
  const aliases = new Set<string>();
  const concreteTypes = [...model.schemas].filter(([, schema]) => !schema.abstract).map(([type]) => type).filter((type) => admitted(type, query.note_types));
  concreteTypes.forEach((type) => requireSchemaModel(model, type));
  const usedTypes = new Set(concreteTypes);
  const typeFields = new Map(concreteTypes.map((type) => [type, noteFieldDefinitions(model.schemas.get(type)!)]));
  const modeledPaths = new Set(model.notes.map((note) => note.path));
  for (const document of model.documents) {
    if (!modeledPaths.has(document.path) && document.candidates?.some((type) => admitted(type, query.note_types))) {
      fail("CM-308", `${document.path} cannot provide an admitted effective model`);
    }
  }
  const columnDefinitions = new Map<string, FieldDefinition[]>();
  for (const column of query.select) {
    if (aliases.has(column.as)) fail("CM-361", `Duplicate projection alias ${column.as}`);
    aliases.add(column.as);
    columnDefinitions.set(column.as, column.kind === "mapped_field" ? [column.definition] : column.kind === "field"
      ? [...typeFields.values()].map((fields) => definitionAt(fields, column.field)).filter((field): field is FieldDefinition => !!field)
      : [{ type: "text" }]);
    if (column.kind !== "mapped_field") continue;
    checkDefinition(column.definition, model, true);
    column.sources.forEach((source) => checkTypes(source.note_types));
    for (const type of concreteTypes) {
      const matching = column.sources.filter((source) => admitted(type, source.note_types));
      if (matching.length > 1) fail("CM-480", `Mapped sources overlap for ${type}`);
    }
    for (const mapping of column.sources) {
      for (const [type, schema] of model.schemas) {
        if (schema.abstract || !admitted(type, mapping.note_types)) continue;
        usedTypes.add(type);
        const definition = definitionAt(noteFieldDefinitions(schema), mapping.field);
        if (!definition) fail("CM-481", `Mapped source ${type}.${mapping.field} is undeclared`);
        checkDefinition(definition, model, false);
        checkConversion(definition, column.definition, mapping.conversion);
      }
    }
  }
  const ordered = new Set<string>();
  for (const order of query.order_by ?? []) {
    if (!aliases.has(order.column)) fail("CM-369", `Unknown ordered column ${order.column}`);
    if (ordered.has(order.column)) fail("CM-368", `Duplicate ordered column ${order.column}`);
    if (columnDefinitions.get(order.column)?.some((definition) => ["list", "tags", "object"].includes(definition.type))) {
      fail("CM-374", `Column ${order.column} is not scalar`);
    }
    ordered.add(order.column);
  }
  for (const name of query.group_by ?? []) if (!aliases.has(name)) fail("CM-380", `Unknown grouped column ${name}`);

  const graph = buildRelationshipGraph(model, matchesType);
  const graphFailure = (failure: NoteLinkError): never => {
    const issue = failure.schemaIssue;
    fail("CM-307", failure.message, issue?.kind !== "unavailable" ? undefined : issue.extension ? { extension: issue.extension } : { specificationVersion: issue.specificationVersion!, path: issue.path });
  };
  const byPath = new Map(model.notes.map((note) => [note.path, note]));
  const ensureModel = (note: ManagedNote) => {
    usedTypes.add(note.noteType);
    requireSchemaModel(model, note.noteType);
    if (graph.failures.has(note.path)) graphFailure(graph.failures.get(note.path)![0]!);
    if (note.problems.some((problem) => ["invalid_field_value", "missing_required_field", "missing_declared_field"].includes(problem.code))) {
      fail("CM-308", `${note.path} has no conforming effective field model`);
    }
  };
  const match = (note: ManagedNote, predicate: Predicate): boolean => {
    if (predicate.kind === "all" || predicate.kind === "any") {
      const matches = predicate.predicates.map((child) => match(note, child));
      return predicate.kind === "all" ? matches.every(Boolean) : matches.some(Boolean);
    }
    if (predicate.kind === "not") return !match(note, predicate.predicate);
    if (predicate.kind === "path") {
      const value = predicate.value.normalize("NFC");
      if (predicate.operator === "equals") return note.path === value;
      if (predicate.operator === "under") return note.path.startsWith(value);
      return fullPattern(predicate.value).test(note.path);
    }
    if (predicate.kind === "relationship") {
      let related: ManagedNote[];
      if (predicate.direction === "inbound") {
        if (graph.failures.size) graphFailure([...graph.failures.values()].flat().find((failure) => failure.schemaIssue?.kind === "unavailable") ?? graph.failures.values().next().value![0]!);
        related = model.notes.filter((source) => graph.targets.get(source.path)?.[predicate.relationship].has(note.path));
      } else related = [...(graph.targets.get(note.path)?.[predicate.relationship] ?? [])].map((path) => byPath.get(path)!);
      related = related.filter((target) => admitted(target.noteType, predicate.note_types));
      related = related.filter((target) => { ensureModel(target); return !predicate.where || match(target, predicate.where); });
      const minimum = predicate.count ? predicate.count.min ?? 0 : 1;
      return related.length >= minimum && related.length <= (predicate.count?.max ?? Infinity);
    }
    const field = lookup(note, predicate.field);
    if (predicate.operator === "exists") return field.present === predicate.value;
    const definition = field.definition;
    if (!definition) return false;
    const incompatible = () => fail("CM-345", `${predicate.operator} or its operand is incompatible with ${predicate.field}`);
    if (predicate.operator === "regex") {
      if (!["text", "link"].includes(definition.type)) incompatible();
      return typeof field.effective === "string" && fullPattern(String(predicate.value)).test(field.effective.normalize("NFC"));
    }
    if (predicate.operator === "contains_any" || predicate.operator === "contains_all") {
      if (!["list", "tags"].includes(definition.type)) incompatible();
      const item = definition.type === "tags" ? { type: "text" as const } : definition.items!;
      const operands = predicate.value as unknown[];
      for (const value of operands) {
        const check = definition.type === "tags"
          ? validateFieldValue([value], { type: "tags", allowed_values_from: definition.allowed_values_from }, timezone, model.config.vocabularies)
          : validateFieldValue(value, item, timezone, model.config.vocabularies);
        if (check) incompatible();
      }
      if (!Array.isArray(field.effective)) return false;
      const matches = operands.map((operand) => (field.effective as unknown[]).some((entry) => equalFieldValues(operand, entry, item, timezone)));
      return predicate.operator === "contains_any" ? matches.some(Boolean) : matches.every(Boolean);
    }
    if (validateFieldValue(predicate.value, definition, timezone, model.config.vocabularies)) incompatible();
    if (predicate.operator === "equals") return field.effective !== undefined && equalFieldValues(field.effective, predicate.value, definition, timezone);
    if (!comparisonDomain(definition) || predicate.value === null) incompatible();
    if (field.effective === null || field.effective === undefined) return false;
    const compared = compareFieldValues(field.effective, predicate.value, definition, timezone);
    switch (predicate.operator) {
      case "less_than": return compared < 0;
      case "less_than_or_equal": return compared <= 0;
      case "greater_than": return compared > 0;
      case "greater_than_or_equal": return compared >= 0;
      default: return incompatible();
    }
  };

  const project = (note: ManagedNote, column: Projection): Cell => {
    if (column.kind === "path" || column.kind === "note_type") return {
      value: column.kind === "path" ? note.path : note.noteType, definition: { type: "text" }, source: null,
    };
    const mapping = column.kind === "mapped_field" ? column.sources.find((source) => admitted(note.noteType, source.note_types)) : undefined;
    const path = column.kind === "field" ? column.field : mapping?.field;
    const field = path ? lookup(note, path) : undefined;
    const source = field?.definition;
    const target = column.kind === "field" ? source : column.definition;
    const value = field?.definition && field.present ? field.stored : null;
    if (column.kind === "mapped_field") {
      if (source) {
        checkConversion(source, column.definition, mapping?.conversion);
      }
      if (validateFieldValue(value, column.definition, timezone, model.config.vocabularies)) fail("CM-488", `Mapped value is incompatible with ${column.as}`);
    }
    const backed = !!source && !!field?.present && !source.generated && !source.computed && !source.immutable
      && !!target && classifyConversion(target, source) !== "incompatible"
      && !validateFieldValue(value, source, timezone, model.config.vocabularies);
    return { value, definition: target, source: field?.definition && field.present && path
      ? { path: note.path, field: path, source_backed: backed } : null };
  };
  const entries = model.notes.filter((note) => (query.include_deleted || note.values.deleted !== true) && admitted(note.noteType, query.note_types))
    .filter((note) => { ensureModel(note); return !query.where || match(note, query.where); })
    .map((note) => ({ path: note.path, cells: Object.fromEntries(query.select.map((column) => [column.as, project(note, column)])) }));
  for (const order of query.order_by ?? []) {
    const domains = new Set(entries.filter((entry) => entry.cells[order.column]!.value !== null)
      .map((entry) => {
        const cell = entry.cells[order.column]!;
        return typeof cell.value === "object" ? undefined : comparisonDomain(scalarDefinition(cell));
      }));
    if (domains.has(undefined) || domains.size > 1) fail("CM-374", `Column ${order.column} has incompatible scalar domains`);
  }
  entries.sort((left, right) => {
    for (const order of query.order_by ?? []) {
      const a = left.cells[order.column]!; const b = right.cells[order.column]!;
      if (a.value === null && b.value === null) continue;
      if (a.value === null || b.value === null) return (a.value === null ? 1 : -1) * (order.nulls === "first" ? -1 : 1);
      const compared = compareFieldValues(a.value, b.value, scalarDefinition(a), timezone);
      if (compared) return compared * (order.direction === "desc" ? -1 : 1);
    }
    return compareUnicodeCodePoints(left.path, right.path);
  });
  const retained = entries.slice(0, query.limit ?? entries.length);
  const rows = retained.map((entry) => Object.fromEntries(query.select.map((column) => [column.as, structuredClone(entry.cells[column.as]!.value)])));
  const provenance = retained.map((entry) => Object.fromEntries(query.select.map((column) => [column.as, entry.cells[column.as]!.source])));
  const complete = query.specification_version === "0.1.0" && model.config.specification_version === "0.1.0"
    && [...usedTypes].every((type) => model.schemas.get(type)?.specification_version === "0.1.0"
      && (model.schemaSources?.get(type) ?? []).every((source) => source.version === "0.1.0"));
  const result: QueryResult = { evaluation: complete ? "complete" : "incomplete", rows, provenance };
  if (query.group_by) {
    const groups: Array<{ key: unknown[]; rows: Row[]; cells: Cell[] }> = [];
    retained.forEach((entry, index) => {
      const cells = query.group_by!.map((name) => entry.cells[name]!);
      if (cells.some((cell) => cell.value !== null && typeof cell.value === "object")) fail("CM-402", "Grouped values must be scalar or null");
      let group = groups.find((candidate) => cells.every((cell, i) => equalCells(cell, candidate.cells[i]!, timezone)));
      if (!group) { group = { key: cells.map((cell) => cell.value), rows: [], cells }; groups.push(group); }
      group.rows.push(rows[index]!);
    });
    result.groups = groups.map(({ key, rows }) => ({ key, rows }));
  }
  const rowDefinitions = retained.map((entry) => Object.fromEntries(query.select.map((column) => [column.as, entry.cells[column.as]!.definition])));
  return { result, columns: columnDefinitions, admittedTypes: concreteTypes, rowDefinitions };
}
