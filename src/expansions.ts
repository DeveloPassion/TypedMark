import type { CollectionModel, CollectionNote } from "./collection-model";
import { parseExpansions } from "./expansion-markers";
import { compileExpression, evaluateExpression, ExpressionError } from "./expressions";
import { expansionSources, ExpansionError, validateSourceContract } from "./expansion-sources";
import { NoteLinkError } from "./note-links";
import { QueryError } from "./query-engine";
import type { SchemaRegistry } from "./schema-registry";
import type { TabularSource } from "./views";
import type { ValidationResult } from "./types";

type Data = Record<string, any>;
export interface ExpansionTemplate extends CollectionNote { noteType: string; version: string; available?: boolean }
export function validateExpansions(model: CollectionModel, registry: SchemaRegistry, tables: Map<string, TabularSource>, templates: ExpansionTemplate[]) {
  const results: ValidationResult[] = [];
  const blocked = new Set<string>();
  let incomplete = false;
  const readSource = expansionSources(model, registry, tables);
  const notes = new Map(model.notes.map((note) => [note.path, note]));
  const finding = (path: string, code: string, rule_id: string, message: string, context: Partial<ValidationResult> = {}) => {
    const severity = model.config.validation_defaults?.[code] ?? "error";
    if (severity !== "off") results.push({ code, severity, path, rule_id, message, ...context });
  };
  for (const document of [...model.documents, ...templates]) {
    const template = "version" in document ? document as ExpansionTemplate : undefined;
    const note = notes.get(document.path);
    const candidate = note?.noteType ?? (document.candidates?.length === 1 ? document.candidates[0] : undefined);
    const schema = candidate ? model.schemas.get(candidate) : undefined;
    const version = template?.version ?? (schema && !schema.abstract ? schema.specification_version : model.config.specification_version);
    const parsed = parseExpansions(document.body);
    if (!parsed.used) continue;
    const requireDeclaration = (extension: string) => {
      if (!model.report.required_extensions[extension]) finding(document.path, "invalid_extension_declaration", "EXT-16", `Expansion requires ${extension}`, { extension });
    };
    requireDeclaration("typedmark:expansion");
    for (const marker of parsed.expansions) {
      const kind = (marker.descriptor as Data).source?.kind;
      if (["query", "dataset", "view"].includes(kind)) requireDeclaration("typedmark:queries");
      if (["dataset", "view"].includes(kind)) requireDeclaration("typedmark:views");
    }
    if (!model.report.evaluated_extensions["typedmark:expansion"]) {
      if (model.report.evaluated_extensions["typedmark:queries"]) blocked.add("typedmark:queries");
      continue;
    }
    if (!String(version).startsWith("0.1.")) { incomplete = true; blocked.add("typedmark:expansion"); continue; }
    if (version !== "0.1.0") incomplete = true;
    for (const failure of parsed.failures) finding(document.path, "invalid_expansion", failure.rule, failure.message, failure.expansion ? { expansion: failure.expansion } : {});
    if (parsed.failures.length) continue;
    for (const marker of parsed.expansions) {
      const descriptor = structuredClone(marker.descriptor) as Data;
      const context = typeof descriptor.id === "string" && /^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(descriptor.id) ? { expansion: descriptor.id } : {};
      try {
        if (version !== "0.1.0") {
          const known = (value: unknown, keys: string[], prefix: string) => {
            if (!value || typeof value !== "object" || Array.isArray(value)) return;
            for (const key of Object.keys(value)) if (!keys.includes(key)) {
              results.push({ code: "unknown_field", severity: "warn", path: document.path, rule_id: "FND-11", message: `Unrecognized best-effort construct ${prefix}/${key}`, ...context });
              delete (value as Data)[key];
            }
          };
          const sourceKeys: Record<string, string[]> = { self_field: ["field"], note_field: ["note", "field"], relationship: ["relationship", "direction", "field", "target_note_types"], query: ["query", "column"], dataset: ["dataset", "column"], view: ["view", "column"], file: ["value"], now: ["format"] };
          known(descriptor, ["id", "mode", "state", "source", "render"], "");
          known(descriptor.render, ["item", "separator", "empty"], "/render");
          const keys = Object.hasOwn(sourceKeys, descriptor.source?.kind) ? sourceKeys[descriptor.source.kind] : undefined;
          if (keys) known(descriptor.source, ["kind", ...keys], "/source");
        }
        const errors = registry.validate("expansion.schema.json", descriptor).filter((error) => {
          if (version === "0.1.0" || error.keyword !== "additionalProperties") return true;
          results.push({ code: "unknown_field", severity: "warn", path: document.path, rule_id: "FND-11", message: `Unrecognized best-effort construct ${error.instancePath}/${error.params.additionalProperty}`, ...context });
          return false;
        });
        if (errors.length) throw new ExpansionError("RHT-98", errors.map((error) => `${error.instancePath} ${error.message}`).join("; "));
        validateSourceContract(descriptor.source, version, tables);
        if (!model.report.evaluated_extensions["typedmark:expressions"]) throw new QueryError("RHT-163", "Expansion rendering requires Expressions", { extension: "typedmark:expressions" });
        const expression = compileExpression(descriptor.render.item);
        if (expression.some((part) => "reference" in part && part.reference !== "value")) throw new ExpansionError("RHT-141", "Expansion rendering exposes only value");
        if (descriptor.state === "pending" && marker.region !== "") throw new ExpansionError("RHT-146", "Pending expansion region must be empty");
        if (template) {
          if (descriptor.state !== "pending") throw new ExpansionError("RHT-150", "Template expansions must be pending");
          continue;
        }
        if (descriptor.state === "pending") throw new ExpansionError("RHT-162", "Persisted notes cannot contain pending expansions");
        if (descriptor.mode === "once") continue;
        const values = readSource(descriptor.source, document, version);
        const expected = values.length ? values.map((value) => evaluateExpression(expression, { value })).join(descriptor.render.separator ?? "\n") : descriptor.render.empty ?? "";
        if (expected.replace(/\r\n?/g, "\n") !== marker.region) finding(document.path, "expansion_drift", "RHT-164", "Stored expansion differs from current rendered source", context);
      } catch (error) {
        if (error instanceof QueryError && error.unavailable) {
          incomplete = true; blocked.add("typedmark:expansion");
          if (["query", "dataset", "view"].includes(descriptor.source?.kind)) blocked.add("typedmark:queries");
          if ("specificationVersion" in error.unavailable) {
            const path = error.unavailable.path ?? document.path;
            if (![...model.report.results, ...results].some((result) => result.code === "unsupported_specification_version" && result.path === path)) finding(path, "unsupported_specification_version", "FND-92", error.message);
          }
        } else if (error instanceof ExpansionError || error instanceof ExpressionError) finding(document.path, "invalid_expansion", error.rule, error.message, context);
        else if (error instanceof QueryError || error instanceof NoteLinkError) finding(document.path, "invalid_expansion", error.rule_id, error.message, context);
        else throw error;
      }
    }
  }
  return { results, blocked, incomplete };
}
