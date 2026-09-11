import { existsSync, lstatSync, readFileSync, readdirSync } from "node:fs";
import { basename, join } from "node:path";
import { parseMarkdown } from "./frontmatter";
import { noteFieldDefinitions, type CollectionModel } from "./collection-model";
import { definitionAt, evaluateQueryWithColumns, parseQuery, QueryError, type Descriptor, type QueryEvaluation } from "./query-engine";
import { equalFieldValues, validateFieldValue, type FieldDefinition } from "./field-values";
import type { SchemaRegistry } from "./schema-registry";
import type { ValidationResult } from "./types";

type Data = Record<string, any>;
interface Artifact { path: string; id: string; data: Data }
export interface TabularSource {
  path: string;
  version: string;
  evaluation?: QueryEvaluation;
  presented?: Set<string>;
  error?: QueryError;
}
export interface ViewValidation {
  results: ValidationResult[];
  blocked: Map<string, string>;
  incomplete: boolean;
  sources: Map<string, TabularSource>;
}

export function validateViews(root: string, metadata: string, model: CollectionModel, registry: SchemaRegistry): ViewValidation {
  const outcome: ViewValidation = { results: [], blocked: new Map(), incomplete: false, sources: new Map() };
  const required = model.report.required_extensions;
  const evaluated = model.report.evaluated_extensions;
  const timezone = model.config.timezone ?? "UTC";
  let hasOwnedArtifacts = false;
  const finding = (code: string, path: string, rule: string, message: string, context: Partial<ValidationResult> = {}) => {
    const severity = model.config.validation_defaults?.[code] ?? "error";
    if (severity !== "off") outcome.results.push({ code, severity, path, rule_id: rule, message, ...context });
  };
  const block = (reason: string) => {
    for (const extension of ["typedmark:queries", "typedmark:views"]) if (evaluated[extension]) outcome.blocked.set(extension, reason);
  };
  const read = (directory: "datasets" | "views", identity: "dataset" | "view"): Artifact[] => {
    const parent = join(root, metadata, directory);
    if (!existsSync(parent) || !lstatSync(parent).isDirectory()) return [];
    const artifacts: Artifact[] = [];
    for (const entry of readdirSync(parent, { withFileTypes: true })) {
      if (!entry.isFile() || !entry.name.endsWith(".md")) continue;
      hasOwnedArtifacts = true;
      const path = `${metadata}/${directory}/${entry.name}`;
      const id = basename(entry.name, ".md");
      const source: TabularSource = { path, version: "", error: new QueryError("CM-421", "Artifact could not be evaluated") };
      outcome.sources.set(`${identity}:${id}`, source);
      const context = /^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(id) ? { [identity]: id } : {};
      try {
        const parsed = parseMarkdown(readFileSync(join(parent, entry.name), "utf8"));
        const data = parsed.data as Data;
        const version = data.specification_version;
        source.version = String(version);
        const validVersion = typeof version === "string" && /^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)(?![\s\S])/u.test(version);
        if (validVersion && version.startsWith("0.1.") && version !== "0.1.0") outcome.incomplete = true;
        if (Object.hasOwn(data, "query") && !required["typedmark:queries"]) finding("invalid_extension_declaration", path, "EXT-16", "An embedded query requires typedmark:queries", { extension: "typedmark:queries" });
        if (!evaluated["typedmark:views"]) { source.error = new QueryError("CM-421", "Views evaluation is unavailable", { extension: "typedmark:views" }); continue; }
        if (validVersion && !version.startsWith("0.1.")) {
          outcome.incomplete = true;
          block("A query-owning artifact uses an unsupported specification compatibility line");
          finding("unsupported_specification_version", path, "FND-92", `Unsupported artifact version ${data.specification_version}`);
          source.error = new QueryError("FND-92", "Unsupported artifact version", { specificationVersion: version, path });
          continue;
        }
        const errors = registry.validate(`${identity}.schema.json`, data);
        if (!parsed.hasFrontmatter || errors.length) {
          finding(`invalid_${identity}`, path, identity === "dataset" ? "CM-499" : "CM-413", errors.map((error) => `${error.instancePath} ${error.message}`).join("; ") || "Artifact requires frontmatter", context);
          continue;
        }
        if (data[identity] !== id) {
          finding(`invalid_${identity}`, path, identity === "dataset" ? "CM-496" : "CM-410", "Artifact identifier differs from its basename", context);
          continue;
        }
        artifacts.push({ path, id, data });
      } catch (error) {
        finding(`invalid_${identity}`, path, identity === "dataset" ? "CM-499" : "CM-413", error instanceof Error ? error.message : String(error), context);
      }
    }
    return artifacts;
  };

  // A standalone query engine cannot establish full interpretation of query
  // surfaces owned by an unsupported body contract.
  if (required["typedmark:expansion"] && !evaluated["typedmark:expansion"]) block("Content-expansion query surfaces are not implemented");
  if (required["typedmark:views"] && !evaluated["typedmark:views"]) block("The query-owning Views contract is not being interpreted");
  const datasets = read("datasets", "dataset");
  const views = read("views", "view");
  if (hasOwnedArtifacts && !evaluated["typedmark:views"]) block("The query-owning Views contract is unavailable or undeclared");
  if ((datasets.length || views.length) && !evaluated["typedmark:queries"]) block("Embedded query evaluation is unavailable or deliberately excluded");
  if ((required["typedmark:expansion"] && !evaluated["typedmark:expansion"]) || !evaluated["typedmark:views"] || !evaluated["typedmark:queries"]) {
    for (const source of outcome.sources.values()) if (!source.error?.unavailable) source.error = new QueryError("CM-421", "Query artifact evaluation is unavailable", { extension: !evaluated["typedmark:views"] ? "typedmark:views" : !evaluated["typedmark:queries"] ? "typedmark:queries" : "typedmark:expansion" });
    return outcome;
  }

  function fail(rule: string, message: string): never { throw new QueryError(rule, message); }
  const evaluate = (artifact: Artifact, queryData: unknown, mismatchRule: string) => {
    if ((queryData as Descriptor).specification_version !== artifact.data.specification_version) fail(mismatchRule, "Query and artifact specification versions differ");
    const query = parseQuery(queryData, registry);
    const evaluation = evaluateQueryWithColumns(model, query);
    if (evaluation.result.evaluation !== "complete") outcome.incomplete = true;
    return { query, evaluation };
  };
  const reportError = (artifact: Artifact, kind: "dataset" | "view", error: unknown) => {
    if (!(error instanceof QueryError)) throw error;
    outcome.sources.get(`${kind}:${artifact.id}`)!.error = error;
    if (error.unavailable) {
      block(error.message);
      if ("specificationVersion" in error.unavailable) {
        const path = error.unavailable.path ?? artifact.path;
        if (![...model.report.results, ...outcome.results].some((result) => result.path === path && result.code === "unsupported_specification_version")) {
          finding("unsupported_specification_version", path, "FND-92", error.message);
        }
      }
    } else finding(`invalid_${kind}`, artifact.path, error.rule_id, error.message, { [kind]: artifact.id });
  };
  const cache = new Map<string, { artifact: Artifact; query: Descriptor; evaluation: QueryEvaluation; columns: Map<string, FieldDefinition> }>();
  for (const artifact of datasets) {
    try {
      const { query, evaluation } = evaluate(artifact, artifact.data.query, "CM-506");
      const columns = new Map<string, FieldDefinition>();
      for (const column of query.select) {
        const definitions = evaluation.columns.get(column.as) ?? [];
        const common = definitions[0];
        if (!common) fail("CM-515", `Column ${column.as} has no effective field definition`);
        if (column.kind === "field") {
          if (definitions.some((definition) => !equalFieldValues(normalizeDefinition(definition), normalizeDefinition(common), { type: "any" }, timezone))) fail("CM-528", `Column ${column.as} has heterogeneous definitions; use mapped_field`);
          const undeclared = evaluation.admittedTypes.some((type) => !definitionAt(noteFieldDefinitions(model.schemas.get(type)!), column.field));
          if ((undeclared || evaluation.result.rows.some((row) => row[column.as] === null)) && common.nullable !== true) fail("CM-529", `Column ${column.as} can be absent but its common definition is not nullable`);
        }
        columns.set(column.as, common);
      }
      const identity = columns.get(artifact.data.row_identity);
      if (!identity) fail("CM-508", "row_identity is not a projected alias");
      const seen: unknown[] = [];
      for (const row of evaluation.result.rows) {
        const value = row[artifact.data.row_identity];
        if (value === null || !["string", "number", "boolean"].includes(typeof value)) fail("CM-509", "Row identity must be a non-null scalar");
        if (seen.some((previous) => equalFieldValues(previous, value, identity, timezone))) fail("CM-510", "Row identity is duplicated");
        seen.push(value);
      }
      cache.set(artifact.id, { artifact, query, evaluation, columns });
      Object.assign(outcome.sources.get(`dataset:${artifact.id}`)!, { evaluation, error: undefined });
    } catch (error) { reportError(artifact, "dataset", error); }
  }

  for (const artifact of views) {
    try {
      let evaluation: QueryEvaluation;
      if (artifact.data.dataset !== undefined) {
        const source = datasets.find((dataset) => dataset.id === artifact.data.dataset);
        if (!source) {
          const dependency = outcome.sources.get(`dataset:${artifact.data.dataset}`)?.error;
          if (dependency?.unavailable) throw dependency;
          fail("CM-520", "Referenced dataset does not resolve");
        }
        if (source.data.specification_version !== artifact.data.specification_version) fail("CM-521", "View and dataset specification versions differ");
        const dataset = cache.get(source.id);
        if (!dataset) {
          const dependency = outcome.sources.get(`dataset:${source.id}`)?.error;
          if (dependency?.unavailable) throw dependency;
          fail("CM-421", "Referenced dataset could not be evaluated");
        }
        evaluation = dataset.evaluation;
      } else evaluation = evaluate(artifact, artifact.data.query, "CM-420").evaluation;
      for (const [alias, definitions] of evaluation.columns) {
        if (!definitions.length) fail("CM-449", `Projected column ${alias} has no declared source field`);
      }
      const presented = new Set<string>();
      for (const field of artifact.data.presentation.fields) {
        if (!evaluation.columns.has(field.column)) fail("CM-425", `Unknown presented column ${field.column}`);
        if (presented.has(field.column)) fail("CM-426", `Presented column ${field.column} is duplicated`);
        presented.add(field.column);
      }
      if (artifact.data.presentation.layout === "board") {
        const board = artifact.data.presentation.board;
        const definitions = evaluation.columns.get(board.column);
        if (!definitions?.length) fail("CM-435", "Board column does not resolve to a typed projected column");
        if (evaluation.result.rows.some((row) => row[board.column] !== null && !["string", "number", "boolean"].includes(typeof row[board.column]))) fail("CM-435", "Board values must be scalar or null");
        const seen: unknown[] = [];
        for (const column of board.columns) {
          if (definitions.some((definition) => validateFieldValue(column.value, definition, timezone, model.config.vocabularies))) fail("CM-437", "Declared board value is incompatible with its projected field");
          if (seen.some((value) => definitions.some((definition) => equalFieldValues(value, column.value, definition, timezone)))) fail("CM-438", "Declared board values are not unique");
          seen.push(column.value);
        }
      }
      Object.assign(outcome.sources.get(`view:${artifact.id}`)!, { evaluation, presented, error: undefined });
    } catch (error) { reportError(artifact, "view", error); }
  }
  return outcome;
}

function normalizeDefinition(definition: FieldDefinition): Record<string, unknown> {
  const normalized: Record<string, unknown> = { nullable: false, generated: false, immutable: false, deprecated: false, unique: false, validate_exists: false, not_empty: false, not_blank: false, ...definition };
  if (definition.items) normalized.items = normalizeDefinition(definition.items);
  if (definition.fields) normalized.fields = Object.fromEntries(Object.entries(definition.fields).map(([name, child]) => [name, normalizeDefinition(child)]));
  return normalized;
}
