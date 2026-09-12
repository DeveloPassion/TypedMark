import type { ErrorObject } from "ajv";
import { existsSync, lstatSync, readFileSync, readdirSync } from "node:fs";
import { basename, dirname, join, relative } from "node:path";
import { FrontmatterError, frontmatterFailureRule, parseMarkdown } from "./frontmatter";
import { compareUnicodeCodePoints } from "./order";
import { SchemaRegistry } from "./schema-registry";
import { compareFieldValues, comparisonDomain, expandObjectDefaults, fullPattern, validateFieldValue, type FieldDefinition } from "./field-values";
import { aliasValueFailure, CORE_FIELDS, noteFieldDefinitions, type CollectionModel, type CollectionNote, type ManagedNote } from "./collection-model";
import { exclusionPatterns, isExcluded, isSubtreeExcluded } from "./paths";
import { readStableCollection } from "./snapshot";
import { validateViews } from "./views";
import { resolveSchemas, type SchemaIssue } from "./reuse";
import { conditionFailures, matchesFrontmatterPredicates, validateConditions } from "./conditions";
import { validateReusableBlocks } from "./schema-semantics";
import { validateRelationships } from "./relationships";
import { computedFailures, hasComputed, validateComputedFields } from "./expressions";
import { validateExpansions, type ExpansionTemplate } from "./expansions";
import { validateAutomations } from "./automations";
import { authoringKeys, hasAuthoring, validateAuthoringFields } from "./authoring";
import { validateTemplateTracking } from "./template-tracking";
import { resolveStoragePath } from "./storage";
import { validateHistoryShape } from "./history";
export { noteFieldDefinitions } from "./collection-model";
export type { CollectionModel, CollectionNote, ManagedNote } from "./collection-model";
export { isExcluded } from "./paths";
import type {
  ExtensionMap,
  Severity,
  ValidateCollectionInput,
  ValidationReport,
  ValidationResult,
} from "./types";

type Data = Record<string, any>;

const IMPLEMENTED_CORE = "0.1.0";

const DEFAULT_SEVERITIES: Record<string, "error" | "warn"> = {
  unknown_field: "warn",
  template_drift: "warn",
};

const RESULT_ORDER = [
  "path", "rule_id", "code", "note_type", "field", "relationship", "heading",
  "expansion", "dataset", "view", "template_region", "drift_kind", "extension",
] as const;

export function validateCollection(input: ValidateCollectionInput): ValidationReport {
  return readStableCollection(input.collectionRoot, (root) => readCollectionModel({ ...input, collectionRoot: root })).report;
}

export function readCollectionModel(input: ValidateCollectionInput, options: { diagnosticPolicy?: "configured" | "strict" } = {}): CollectionModel {
  const root = input.collectionRoot;
  const mode = input.mode ?? "instantiated_collection";
  const registry = new SchemaRegistry(input.schemaDirectory);
  const results: ValidationResult[] = [];
  const configPath = join(root, "typedmark.md");
  let config: Data = {};
  let schemas = new Map<string, Data>();
  let schemaIssues = new Map<string, SchemaIssue>();
  let schemaSources = new Map<string, Array<{ path: string; version: string }>>();
  const documents: CollectionNote[] = [];
  const effectiveNotes: ManagedNote[] = [];
  const templates: ExpansionTemplate[] = [];
  const assets = new Set<string>();
  let associationIssue: string | undefined;
  let configurationIssue: string | undefined;
  const model = (validation: ValidationReport): CollectionModel => ({ report: validation, config, schemas, schemaIssues, schemaSources, documents, notes: effectiveNotes, assets, associationIssue, configurationIssue });

  if (!existsSync(configPath)) {
    configurationIssue = "typedmark.md is missing";
    add(results, {}, "invalid_collection_configuration", "typedmark.md", "CM-1", "typedmark.md is missing");
    return model(report(input.referenceEdition ?? IMPLEMENTED_CORE, mode, {}, {}, "complete", results));
  }

  try {
    config = parseMarkdown(readFileSync(configPath)).data;
  } catch (error) {
    configurationIssue = errorMessage(error);
    add(results, {}, "invalid_collection_configuration", "typedmark.md", frontmatterFailureRule(error, "CM-537"), errorMessage(error));
    return model(report(input.referenceEdition ?? IMPLEMENTED_CORE, mode, {}, {}, "complete", results));
  }

  const version = typeof config.specification_version === "string"
    ? config.specification_version
    : input.referenceEdition ?? IMPLEMENTED_CORE;
  const requiredExtensions = isRecord(config.extensions) ? stringMap(config.extensions) : {};
  const requestedExtensions = input.supportedExtensions ?? STANDARD_EXTENSIONS;
  const supportedExtensions = Object.fromEntries(
    Object.entries(STANDARD_EXTENSIONS).filter(([extension, version]) => requestedExtensions[extension] === version),
  );
  const evaluatedExtensions: ExtensionMap = {};
  let evaluation: "complete" | "incomplete" = "complete";

  if (!sameCompatibilityLine(version, IMPLEMENTED_CORE)) {
    evaluation = "incomplete";
    add(results, config, "unsupported_specification_version", "typedmark.md", "FND-92", `Unsupported specification version ${version}`);
  }

  const configShape = normalizedMandatoryTags(config);
  if (!requiredExtensions["typedmark:reuse"] || supportedExtensions["typedmark:reuse"] !== requiredExtensions["typedmark:reuse"]) delete configShape.default_property_sets;
  if (!requiredExtensions["typedmark:automation"] || supportedExtensions["typedmark:automation"] !== requiredExtensions["typedmark:automation"]) delete configShape.automation_defaults;
  const configErrors = registry.validate("typedmark.schema.json", configShape);
  if (configErrors.length > 0) {
    configurationIssue = schemaError(configErrors);
    add(results, config, "invalid_collection_configuration", "typedmark.md", configErrors.every((error) => error.instancePath.startsWith("/mandatory_tags")) ? "CM-226" : "CM-537", schemaError(configErrors));
  }
  if (!configErrors.length) {
    try {
      const timezone = config.timezone ?? "UTC";
      if (/^[+-]/u.test(timezone)) throw new RangeError("A fixed offset is not an IANA timezone identifier");
      // Intl checks named zones without reading the clock. Fixed-offset options
      // are excluded above because the collection contract requires an IANA ID.
      // https://developer.mozilla.org/en-US/docs/Web/JavaScript/Reference/Global_Objects/Intl/DateTimeFormat/DateTimeFormat#timezone
      new Intl.DateTimeFormat("en", { timeZone: timezone });
    } catch (error) {
      if (!(error instanceof RangeError)) throw error;
      configurationIssue = "timezone must be an IANA timezone identifier";
      add(results, config, "invalid_collection_configuration", "typedmark.md", "CM-551", configurationIssue);
    }
  }

  // Strict eligibility checks need known violations independently of display
  // policy. Validate the authored configuration first, then override only the
  // in-memory diagnostic projection; normal validation keeps configured policy.
  if (options.diagnosticPolicy === "strict" && !configErrors.length) {
    const categories = new Set([...Object.keys(DEFAULT_SEVERITIES), ...Object.keys(config.validation_defaults ?? {})]);
    config = { ...config, validation_defaults: Object.fromEntries([...categories].map((code) => [code, "error"])) };
  }

  for (const [extension, requiredVersion] of Object.entries(requiredExtensions).sort()) {
    if (supportedExtensions[extension] === requiredVersion) {
      evaluatedExtensions[extension] = requiredVersion;
    } else {
      evaluation = "incomplete";
      add(results, config, "unsupported_extension", "typedmark.md", "EXT-19", `${extension} at ${requiredVersion} is required but unsupported`, { extension });
    }
  }

  validateExtensionDependencies(requiredExtensions, config, results);
  const declaredMetadata = safeMetadataDirectory(config.metadata_directory);
  const metadataEntries = readdirSync(root, { withFileTypes: true }).filter((entry) => entry.isDirectory() && !entry.isSymbolicLink() && entry.name.normalize("NFC") === declaredMetadata.normalize("NFC"));
  const metadataDirectory = metadataEntries[0]?.name ?? declaredMetadata;
  if (metadataEntries.length === 1) validateReuseDeclaration(root, metadataDirectory, config, requiredExtensions, results);
  else if (Object.hasOwn(config, "default_property_sets")) requireExtension("typedmark:reuse", "typedmark.md", requiredExtensions, config, results);
  if (Object.hasOwn(config, "automation_defaults")) requireExtension("typedmark:automation", "typedmark.md", requiredExtensions, config, results);
  // Reuse consumes collection-controlled names, vocabularies and severities.
  // Invalid shapes are not safe inputs to composition or semantic evaluation.
  if (configurationIssue) return model(report(version, mode, requiredExtensions, evaluatedExtensions, evaluation, results));
  if (metadataEntries.length !== 1) {
    configurationIssue = "The metadata directory must resolve unambiguously to the collection's schema artifacts";
    add(results, config, "invalid_collection_configuration", "typedmark.md", metadataEntries.length ? "CM-24" : "FND-76", "The metadata directory must resolve unambiguously to the collection's schema artifacts");
    return model(report(version, mode, requiredExtensions, evaluatedExtensions, evaluation, results));
  }

  const schemaArtifacts = loadArtifacts(join(root, metadataDirectory, "schemas"), root, "invalid_note_type_schema", "CM-538", results, config);
  const propertySets = new Map<string, Data>();
  const propertySetIssues = new Map<string, SchemaIssue>();
  const checkVersion = (data: Data, path: string): SchemaIssue | undefined => {
    const version = data.specification_version;
    if (typeof version !== "string" || !/^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)(?![\s\S])/u.test(version)) return;
    if (version !== IMPLEMENTED_CORE) evaluation = "incomplete";
    if (sameCompatibilityLine(version, IMPLEMENTED_CORE)) return;
    const message = `Unsupported specification version ${version}`;
    add(results, config, "unsupported_specification_version", path, "FND-92", message);
    return { kind: "unavailable", path, message, specificationVersion: version };
  };
  validateSystemContract(root, metadataDirectory, mode, config, requiredExtensions, evaluatedExtensions, registry, results, checkVersion);
  const shapeErrors = (schema: string, data: Data, path: string): { errors: ErrorObject[]; invalidUnknown: boolean } => {
    const errors = registry.validate(schema, data);
    const bestEffort = String(data.specification_version).startsWith("0.1.") && data.specification_version !== IMPLEMENTED_CORE;
    let invalidUnknown = false;
    const known = errors.filter((error) => {
      if (error.keyword !== "additionalProperties") return true;
      if (!bestEffort) invalidUnknown = true;
      results.push({ code: "unknown_field", severity: bestEffort ? "warn" : "error", path, rule_id: bestEffort ? "FND-11" : "CM-534", message: `Unrecognized structural key ${error.instancePath}/${error.params.additionalProperty}` });
      return false;
    });
    return { errors: known, invalidUnknown };
  };
  const fieldContractShape = (data: Data, path: string): Data => {
    const shape = structuredClone(normalizedMandatoryTags(data));
    let used = false;
    let authoring = false;
    const visit = (field: unknown) => {
      if (!isRecord(field)) return;
      if (Object.hasOwn(field, "computed")) {
        used = true;
        if (!evaluatedExtensions["typedmark:expressions"]) delete field.computed;
      }
      for (const key of authoringKeys(field)) {
        authoring = true;
        if (!evaluatedExtensions["typedmark:authoring"]) delete field[key];
      }
      visit(field.items);
      if (isRecord(field.fields)) Object.values(field.fields).forEach(visit);
    };
    if (isRecord(shape.frontmatter)) Object.values(shape.frontmatter).forEach(visit);
    if (used) requireExtension("typedmark:expressions", path, requiredExtensions, config, results);
    if (authoring) requireExtension("typedmark:authoring", path, requiredExtensions, config, results);
    return shape;
  };
  if (evaluatedExtensions["typedmark:reuse"]) for (const artifact of loadArtifacts(join(root, metadataDirectory, "property-sets"), root, "invalid_property_set", "CM-146", results, config)) {
    const name = basename(artifact.path, ".md");
    propertySets.set(name, artifact.data);
    const unavailable = checkVersion(artifact.data, artifact.relativePath);
    if (unavailable) { propertySetIssues.set(name, unavailable); continue; }
    const { errors, invalidUnknown } = shapeErrors("property-set.schema.json", fieldContractShape(artifact.data, artifact.relativePath), artifact.relativePath);
    if (errors.length || invalidUnknown || artifact.data.property_set !== name) {
      const message = errors.length ? schemaError(errors) : invalidUnknown ? "Unrecognized structural key" : `Property set identity differs from ${name}`;
      const first = errors[0];
      const rule = first?.keyword === "required" ? "CM-146" : first?.instancePath.startsWith("/frontmatter") ? "CM-150" : first?.instancePath.startsWith("/relationships") ? "CM-152" : first?.instancePath.startsWith("/headings") ? "CM-153" : first?.instancePath === "/specification_version" ? "FND-5" : first ? "CM-146" : "CM-144";
      if (errors.length || (!invalidUnknown && artifact.data.property_set !== name)) add(results, config, "invalid_property_set", artifact.relativePath, rule, message);
      propertySetIssues.set(name, { kind: "invalid", path: artifact.relativePath, message });
    }
  }

  for (const artifact of schemaArtifacts) {
    const inferredName = basename(artifact.path, ".md");
    schemas.set(inferredName, artifact.data);
    const unavailable = checkVersion(artifact.data, artifact.relativePath);
    if (unavailable) { schemaIssues.set(inferredName, unavailable); continue; }
    if (artifact.data.abstract === true || ["extends", "property_sets", "exclude_property_sets", "frontmatter_remove", "conditions"]
      .some((key) => Object.hasOwn(artifact.data, key))) {
      requireExtension("typedmark:reuse", artifact.relativePath, requiredExtensions, config, results);
    }
    const shape = fieldContractShape(artifact.data, artifact.relativePath);
    if (!evaluatedExtensions["typedmark:reuse"]) {
      for (const key of ["extends", "abstract", "property_sets", "exclude_property_sets", "frontmatter_remove", "conditions"]) delete shape[key];
      if (Object.hasOwn(artifact.data, "extends") || artifact.data.abstract === true) shape.abstract = true;
    }
    const { errors, invalidUnknown } = shapeErrors("note-type.schema.json", shape, artifact.relativePath);
    const name = typeof artifact.data.note_type === "string" ? artifact.data.note_type : inferredName;
    if (errors.length > 0 || invalidUnknown || name !== inferredName) {
      const message = errors.length ? schemaError(errors) : invalidUnknown ? "Unrecognized structural key" : `Schema identity ${name} does not match ${inferredName}`;
      if (errors.length || (!invalidUnknown && name !== inferredName)) add(results, config, "invalid_note_type_schema", artifact.relativePath,
        errors.length && errors.every((error) => error.instancePath.startsWith("/mandatory_tags")) ? "NTS-170" : "NTS-4", message);
      schemaIssues.set(inferredName, { kind: "invalid", path: artifact.relativePath, message });
      continue;
    }
    schemas.set(name, artifact.data);
  }

  validateOptionalArtifacts(root, metadataDirectory, requiredExtensions, results, config);

  for (const [name, propertySet] of propertySets) {
    if (propertySetIssues.has(name)) continue;
    const path = `${metadataDirectory}/property-sets/${name}.md`;
    const failures = validateReusableBlocks(propertySet, schemas, config);
    if (evaluatedExtensions["typedmark:authoring"] && !failures.length) failures.push(...validateAuthoringFields(propertySet.frontmatter, config));
    if (evaluatedExtensions["typedmark:expressions"]) failures.push(...validateComputedFields(propertySet.frontmatter, false));
    for (const failure of failures) {
      add(results, config, "invalid_property_set", path, failure.rule, failure.message);
      propertySetIssues.set(name, { kind: "invalid", path, message: failure.message });
    }
  }
  const resolved = resolveSchemas({ schemas, propertySets, config, metadataDirectory, enabled: !!evaluatedExtensions["typedmark:reuse"], schemaIssues, propertySetIssues });
  schemas = resolved.schemas; schemaIssues = resolved.issues; schemaSources = resolved.sources;
  for (const finding of resolved.results) add(results, config, finding.code, finding.path, finding.rule_id, finding.message, { ...(finding.note_type ? { note_type: finding.note_type } : {}) });
  if ([...schemaIssues.values()].some((issue) => issue.kind === "unavailable" && issue.specificationVersion)) evaluation = "incomplete";
  for (const [name, schema] of schemas) {
    if (schemaIssues.has(name)) continue;
    const path = `${metadataDirectory}/schemas/${name}.md`;
    const fields = noteFieldDefinitions(schema);
    const failures = validateReusableBlocks(schema, schemas, config);
    const reportFailures = () => {
      for (const failure of failures) {
        const code = ["RHT-15", "RHT-21", "RHT-26"].includes(failure.rule) ? "invalid_relationship_definition" : "invalid_note_type_schema";
        add(results, config, code, path, failure.rule, failure.message);
        schemaIssues.set(name, { kind: "invalid", path, message: failure.message });
      }
    };
    if (hasAuthoring(fields) && !evaluatedExtensions["typedmark:authoring"]) {
      reportFailures();
      schemaIssues.set(name, { kind: "unavailable", path, message: `${name} requires Authoring`, extension: "typedmark:authoring" });
      continue;
    }
    if (hasComputed(fields) && !evaluatedExtensions["typedmark:expressions"]) {
      reportFailures();
      schemaIssues.set(name, { kind: "unavailable", path, message: `${name} requires Expressions`, extension: "typedmark:expressions" });
      continue;
    }
    if (evaluatedExtensions["typedmark:authoring"] && !failures.length) failures.push(...validateAuthoringFields(fields, config));
    if (evaluatedExtensions["typedmark:expressions"]) failures.push(...validateComputedFields(fields, !schema.abstract));
    if (!schema.abstract) failures.push(...validateConditions(schema.conditions ?? [], noteFieldDefinitions(schema)));
    reportFailures();
    if (!schema.abstract && !schemaIssues.has(name)) validateTemplate(root, metadataDirectory, name, schema, registry, results, config, templates);
  }

  const mappingFailures = validateMappingDeclarations(config, schemas);
  for (const failure of mappingFailures) add(results, config, "invalid_note_type_mapping", "typedmark.md", failure.rule, failure.message);
  if (mappingFailures.length) {
    associationIssue = mappingFailures[0]!.message;
    return model(report(version, mode, requiredExtensions, evaluatedExtensions, evaluation, results));
  }

  const files = discoverFiles(root, metadataDirectory, exclusionPatterns(config.exclude_paths));
  const notes = files.filter((path) => path.endsWith(".md"));
  for (const path of files) if (!path.endsWith(".md")) assets.add(path.normalize("NFC"));
  for (const notePath of notes) {
    let document;
    try {
      document = parseMarkdown(readFileSync(join(root, notePath)));
    } catch (error) {
      add(results, config, "invalid_note_frontmatter", notePath, frontmatterFailureRule(error, "MN-118"), errorMessage(error));
      documents.push({ path: notePath.normalize("NFC"), stored: {}, body: error instanceof FrontmatterError ? error.body : "", frontmatterValid: false, candidates: candidateTypes(selectNoteType(config, notePath, {}, false)) });
      continue;
    }
    const association = selectNoteType(config, notePath, document.data, document.hasFrontmatter);
    const candidates = candidateTypes(association);
    documents.push({ path: notePath.normalize("NFC"), stored: document.data, body: document.body, hasFrontmatter: document.hasFrontmatter, frontmatterValid: true, candidates });
    if (!association.matched) continue;
    if (!candidates.length || !schemas.has(candidates[0]!)) {
      add(results, config, "invalid_note_type_mapping", notePath, "CM-114", "The winning mapping does not resolve to one known concrete note type");
      continue;
    }
    const noteType = candidates[0]!;
    const schema = schemas.get(noteType);
    if (!schema || schema.abstract === true) {
      add(results, config, "invalid_note_type_mapping", notePath, "CM-114", `Unknown or abstract note type ${noteType}`);
      continue;
    }
    const validation = validateNote(notePath, document.data, document.body, noteType, schemaIssues.has(noteType) ? {} : schema, config, schemaIssues.has(noteType), !!requiredExtensions["typedmark:template-tracking"]);
    results.push(...validation.results);
    effectiveNotes.push({ path: notePath.normalize("NFC"), noteType, values: validation.values, fields: validation.fields,
      stored: document.data, body: document.body, problems: validation.results });
  }

  const concreteSchemas = new Map([...schemas].filter(([name, schema]) => !schemaIssues.has(name) && !schema.abstract));
  validateUniqueness(effectiveNotes, concreteSchemas, config, results);
  validateCounts(effectiveNotes, concreteSchemas, config, results);
  for (const finding of validateRelationships(model(report(version, mode, requiredExtensions, evaluatedExtensions, evaluation, results)))) {
    add(results, config, finding.code, finding.path, finding.rule_id, finding.message, { note_type: finding.note_type, ...(finding.field ? { field: finding.field } : {}), ...(finding.relationship ? { relationship: finding.relationship } : {}) });
  }
  const views = validateViews(root, metadataDirectory, model(report(version, mode, requiredExtensions, evaluatedExtensions, evaluation, results)), registry);
  results.push(...views.results);
  const expansions = validateExpansions(model(report(version, mode, requiredExtensions, evaluatedExtensions, evaluation, results)), registry, views.sources, templates);
  results.push(...expansions.results);
  if (expansions.incomplete) evaluation = "incomplete";
  for (const extension of expansions.blocked) if (evaluatedExtensions[extension]) { delete evaluatedExtensions[extension]; evaluation = "incomplete"; }
  if (views.incomplete) evaluation = "incomplete";
  for (const extension of views.blocked.keys()) {
    delete evaluatedExtensions[extension];
    evaluation = "incomplete";
  }
  const automations = validateAutomations(root, metadataDirectory, model(report(version, mode, requiredExtensions, evaluatedExtensions, evaluation, results)), registry);
  results.push(...automations.results);
  if (automations.incomplete) evaluation = "incomplete";
  if (automations.blocked) delete evaluatedExtensions["typedmark:automation"];
  const tracking = validateTemplateTracking(model(report(version, mode, requiredExtensions, evaluatedExtensions, evaluation, results)), registry, templates);
  results.push(...tracking.results);
  if (tracking.incomplete) evaluation = "incomplete";
  if (tracking.blocked) delete evaluatedExtensions["typedmark:template-tracking"];
  sortResults(results);
  return model(report(version, mode, requiredExtensions, evaluatedExtensions, evaluation, results));
}

const STANDARD_EXTENSIONS: ExtensionMap = {
  "typedmark:template-tracking": "0.1.0",
  "typedmark:authoring": "0.1.0",
  "typedmark:automation": "0.1.0",
  "typedmark:expansion": "0.1.0",
  "typedmark:expressions": "0.1.0",
  "typedmark:reuse": "0.1.0",
  "typedmark:queries": "0.1.0",
  "typedmark:views": "0.1.0",
  "typedmark:systems": "0.1.0",
};

// Knowing a standard contract's declaration requirements does not advertise
// support for evaluating its semantics (EXT-21).
function validateExtensionDependencies(required: ExtensionMap, config: Data, results: ValidationResult[]) {
  const dependencies: Record<string, ExtensionMap> = {
    "typedmark:views": { "typedmark:queries": "0.1.0" },
    "typedmark:expansion": { "typedmark:expressions": "0.1.0" },
  };
  for (const [extension, needed] of Object.entries(dependencies)) {
    if (required[extension] !== "0.1.0") continue;
    for (const [dependency, version] of Object.entries(needed)) {
      if (required[dependency] === version) continue;
      const rule = Object.hasOwn(required, dependency) ? "EXT-15" : "EXT-14";
      add(results, config, "invalid_extension_declaration", "typedmark.md", rule,
        `${extension} at 0.1.0 requires ${dependency} at ${version}`, { extension });
    }
  }
}

function requireExtension(extension: string, path: string, required: ExtensionMap, config: Data, results: ValidationResult[]) {
  if (!Object.hasOwn(required, extension)) {
    add(results, config, "invalid_extension_declaration", path, "EXT-16", `This construct requires ${extension}`, { extension });
  }
}

function validateReuseDeclaration(root: string, metadataDirectory: string, config: Data, required: ExtensionMap, results: ValidationResult[]) {
  if (Object.hasOwn(config, "default_property_sets")) {
    requireExtension("typedmark:reuse", "typedmark.md", required, config, results);
  }
  const directory = join(root, metadataDirectory, "property-sets");
  if (!existsSync(directory) || !lstatSync(directory).isDirectory()) return;
  for (const entry of readdirSync(directory, { withFileTypes: true })) {
    if (entry.isFile() && entry.name.endsWith(".md")) {
      requireExtension("typedmark:reuse", `${metadataDirectory}/property-sets/${entry.name}`, required, config, results);
    }
  }
}

function validateSystemContract(root: string, metadataDirectory: string, mode: ValidationReport["mode"], config: Data, required: ExtensionMap, evaluated: ExtensionMap, registry: SchemaRegistry, results: ValidationResult[], checkVersion: (data: Data, path: string) => SchemaIssue | undefined) {
  const historyPath = join(root, metadataDirectory, "history.md");
  const usesSystems = config.version !== undefined || config.scaffold !== undefined || config.composition !== undefined || existsSync(historyPath);
  if (usesSystems && !required["typedmark:systems"]) {
    add(results, config, "invalid_extension_declaration", "typedmark.md", "EXT-16", "System fields, composition, and history require typedmark:systems", { extension: "typedmark:systems" });
  }
  if ((mode === "system_definition" || mode === "both") && (typeof config.version !== "string" || !isRecord(config.scaffold))) {
    add(results, config, "invalid_system", "typedmark.md", "SCE-7", "A system definition requires version and scaffold");
  }
  if (!evaluated["typedmark:systems"]) return;
  if (isRecord(config.composition) && Array.isArray(config.composition.sources)) {
    const names = new Set<string>();
    for (const source of config.composition.sources) {
      if (!isRecord(source) || typeof source.name !== "string") continue;
      if (source.name === config.name) add(results, config, "invalid_composition", "typedmark.md", "CM-131", "Composition cannot reference its own collection identity");
      if (names.has(source.name)) add(results, config, "invalid_composition", "typedmark.md", "CM-130", `Duplicate composition source ${source.name}`);
      names.add(source.name);
    }
  }
  if (!existsSync(historyPath)) return;
  try {
    const history = parseMarkdown(readFileSync(historyPath)).data;
    const path = normalized(relative(root, historyPath));
    if (checkVersion(history, path)) { delete evaluated["typedmark:systems"]; return; }
    const version = String(history.specification_version);
    const validVersion = /^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)(?![\s\S])/u.test(version);
    const bestEffort = validVersion && sameCompatibilityLine(version, IMPLEMENTED_CORE)
      && BigInt(version.split(".")[2]!) > BigInt(IMPLEMENTED_CORE.split(".")[2]!);
    const shape = validateHistoryShape(history, registry, bestEffort);
    for (const issue of shape.issues) {
      if (issue.severity) results.push({ code: issue.code, severity: issue.severity, path, rule_id: issue.rule, message: issue.message });
      else add(results, config, issue.code, path, issue.rule, issue.message);
    }
    if (!shape.valid) return;
    const entries = Array.isArray(history.history) ? history.history : [];
    if (typeof config.version === "string" && entries.at(-1)?.version !== config.version) add(results, config, "invalid_history", normalized(relative(root, historyPath)), "SCE-100", "The last history version must equal the system version");
  } catch (error) {
    add(results, config, "invalid_history", normalized(relative(root, historyPath)), frontmatterFailureRule(error, "SCE-95"), errorMessage(error));
  }
}

function loadArtifacts(directory: string, root: string, code: string, rule: string, results: ValidationResult[], config: Data) {
  if (!existsSync(directory)) return [];
  return readdirSync(directory, { withFileTypes: true })
    .filter((entry) => entry.isFile() && entry.name.endsWith(".md"))
    .map((entry) => {
      const path = join(directory, entry.name);
      const relativePath = normalized(relative(root, path));
      try {
        return { path, relativePath, data: parseMarkdown(readFileSync(path)).data };
      } catch (error) {
        add(results, config, code, relativePath, frontmatterFailureRule(error, rule), errorMessage(error));
        return { path, relativePath, data: {} };
      }
    });
}

function validateOptionalArtifacts(root: string, metadataDirectory: string, required: ExtensionMap, results: ValidationResult[], config: Data) {
  const definitions = [
    ["typedmark:views", "datasets"],
    ["typedmark:views", "views"],
  ] as const;
  for (const [extension, directory] of definitions) {
    const path = join(root, metadataDirectory, directory);
    const hasArtifacts = existsSync(path) && lstatSync(path).isDirectory() && readdirSync(path, { withFileTypes: true }).some((entry) => entry.isFile() && entry.name.endsWith(".md"));
    if (hasArtifacts && !required[extension]) add(results, config, "invalid_extension_declaration", "typedmark.md", "EXT-16", `${directory} requires ${extension}`, { extension });
  }
}

function validateTemplate(root: string, metadataDirectory: string, noteType: string, schema: Data, registry: SchemaRegistry, results: ValidationResult[], config: Data, templates: ExpansionTemplate[]) {
  const explicit = schema.template && typeof schema.template.file === "string";
  const templateName = explicit ? schema.template.file : `${noteType}.md`;
  const path = join(root, metadataDirectory, "templates", templateName);
  const unavailable = () => templates.push({ path: normalized(relative(root, path)), stored: {}, body: "", version: schema.specification_version, noteType, available: false });
  if (!existsSync(path)) {
    if (explicit) { unavailable(); add(results, config, "invalid_template", normalized(relative(root, path)), "RHT-73", `Explicit template ${templateName} is missing`); }
    return;
  }
  if (lstatSync(path).isSymbolicLink()) {
    unavailable();
    add(results, config, "invalid_template", normalized(relative(root, path)), "RHT-73", `Template ${templateName} must not be a symbolic link`);
    return;
  }
  try {
    const template = parseMarkdown(readFileSync(path));
    templates.push({ path: normalized(relative(root, path)), stored: template.data, body: template.body, hasFrontmatter: template.hasFrontmatter, version: schema.specification_version, noteType });
    if (template.hasFrontmatter) {
      const declared = new Set([...Object.keys(CORE_FIELDS), ...Object.keys(schema.frontmatter ?? {})]);
      const unknown = Object.keys(template.data).find((field) => !declared.has(field) && !(field === "template_regions" && config.extensions?.["typedmark:template-tracking"]));
      if (unknown) add(results, config, "invalid_template", normalized(relative(root, path)), "RHT-76", `Template field ${unknown} is undeclared`);
    }
  } catch (error) {
    unavailable();
    add(results, config, "invalid_template", normalized(relative(root, path)), frontmatterFailureRule(error, "RHT-67"), errorMessage(error));
  }
}

function validateNote(path: string, stored: Data, body: string, noteType: string, schema: Data, config: Data, partial = false, trackingDeclared = false) {
  const results: ValidationResult[] = [];
  const fields = noteFieldDefinitions(schema);
  const values: Data = {};

  if (Object.hasOwn(stored, "note_type") && stored.note_type !== noteType) {
    add(results, config, "invalid_field_value", path, "MN-40", "Stored note_type differs from the associated concrete type", { note_type: noteType, field: "note_type" }, schema);
  }

  for (const [name, definition] of Object.entries(fields)) {
    const present = Object.hasOwn(stored, name);
    let value: unknown;
    if (present) value = stored[name];
    else if (Object.hasOwn(definition, "default_value")) value = definition.default_value;
    else if (name === "note_type") value = noteType;
    else if (name === "title") value = basename(path, ".md");
    else if (definition.nullable === true) value = null;
    else {
      add(results, config, "missing_declared_field", path, "MN-98", `${name} has no conforming effective value`, { note_type: noteType, field: name }, schema);
      continue;
    }
    value = expandObjectDefaults(value, definition);
    values[name] = value;
    if (value === null) {
      if (definition.nullable !== true || (name === "id" && present)) add(results, config, "missing_required_field", path, "MN-99", `${name} is explicitly null but is not nullable`, { note_type: noteType, field: name }, schema);
      continue;
    }
    const failure = validateFieldValue(value, definition, config.timezone ?? "UTC", config.vocabularies);
    if (failure) add(results, config, "invalid_field_value", path, failure.rule, `${name} ${failure.message}`, { note_type: noteType, field: name }, schema);
    const aliasFailure = name === "aliases" ? aliasValueFailure(value) : undefined;
    if (aliasFailure) add(results, config, "invalid_field_value", path, aliasFailure.rule, aliasFailure.message, { note_type: noteType, field: name }, schema);
  }

  const declared = new Set(Object.keys(fields));
  for (const field of Object.keys(stored)) {
    if (!partial && !declared.has(field) && !(trackingDeclared && field === "template_regions")) add(results, config, "unknown_field", path, "MN-111", `${field} is not declared`, { note_type: noteType, field }, schema);
  }
  const unknownChildren = (value: unknown, definition: FieldDefinition, prefix: string): void => {
    if (definition.type === "list" && definition.items && Array.isArray(value)) {
      value.forEach((item, index) => unknownChildren(item, definition.items!, `${prefix}.${index}`));
    } else if (definition.type === "object" && isRecord(value)) {
      for (const [name, child] of Object.entries(value)) {
        const field = `${prefix}.${name}`;
        if (!Object.hasOwn(definition.fields ?? {}, name)) add(results, config, "unknown_field", path, "MN-112", `${field} is not declared`, { note_type: noteType, field }, schema);
        else unknownChildren(child, definition.fields![name]!, field);
      }
    }
  };
  for (const [name, definition] of Object.entries(fields)) unknownChildren(stored[name], definition, name);

  const mandatory = new Set([...arrayOfStrings(config.mandatory_tags), ...arrayOfStrings(schema.mandatory_tags)].map((value) => value.normalize("NFC")));
  const tags = new Set(arrayOfStrings(values.tags).map((value) => value.normalize("NFC")));
  for (const tag of mandatory) {
    if (!tags.has(tag)) add(results, config, "invalid_field_value", path, "MN-128", `tags is missing the effective mandatory tag ${tag}`, { note_type: noteType, field: "tags" }, schema);
  }

  validateStorage(path, values, fields, schema, noteType, config, results);
  validateHeadings(path, body, values.title, schema.headings, noteType, config, results);
  for (const failure of computedFailures(fields, stored, values, config.timezone ?? "UTC", config.vocabularies)) add(results, config, "invalid_field_value", path, failure.rule, failure.message, { note_type: noteType, field: failure.field }, schema);
  for (const failure of conditionFailures(schema.conditions ?? [], stored, values)) add(results, config, failure.code, path, failure.rule, failure.message, { note_type: noteType, field: failure.field }, schema);
  return { values, fields, results };
}


function validateStorage(path: string, values: Data, fields: Data, schema: Data, noteType: string, config: Data, results: ValidationResult[]) {
  const storage = values.archived === true && schema.storage?.archive ? schema.storage.archive : schema.storage;
  if (!storage) return;
  const resolved = resolveStoragePath(storage, values, fields, config.timezone ?? "UTC");
  if ("failure" in resolved) add(results, config, "path", path, resolved.failure.rule, resolved.failure.message, { note_type: noteType }, schema);
  else if (path.normalize("NFC") !== resolved.path) add(results, config, "path", path, "NTS-146", `Expected managed-note path ${resolved.path}`, { note_type: noteType }, schema);
}

function validateHeadings(path: string, body: string, title: unknown, headings: Data | undefined, noteType: string, config: Data, results: ValidationResult[]) {
  if (!headings) return;
  const found = extractHeadings(body);
  const h1 = found.filter((item) => item.depth === 1);
  const h2 = found.filter((item) => item.depth === 2).map((item) => item.text);
  const fail = (message: string, heading?: string) => add(results, config, "invalid_heading", path, "RHT-53", message, { note_type: noteType, ...(heading ? { heading } : {}) });
  if (headings.require_h1_title === true && (h1.length !== 1 || h1[0]!.text !== title || found[0]?.depth !== 1)) fail("The body must start with exactly one H1 equal to the effective title");
  for (const required of arrayOfStrings(headings.required_h2)) if (h2.filter((value) => value === required).length !== 1) fail(`Required H2 ${required} must appear exactly once`, required);
  for (const optional of arrayOfStrings(headings.optional_h2)) if (h2.filter((value) => value === optional).length > 1) fail(`Optional H2 ${optional} appears more than once`, optional);
  const declared = new Set([...arrayOfStrings(headings.required_h2), ...arrayOfStrings(headings.optional_h2)]);
  if (headings.allow_other_h2 === false) for (const value of h2) if (!declared.has(value)) fail(`Undeclared H2 ${value} is not allowed`, value);
  if (headings.require_order === true) {
    for (const list of [arrayOfStrings(headings.required_h2), arrayOfStrings(headings.optional_h2)]) {
      const seen = h2.filter((value) => list.includes(value));
      if (seen.some((value, index) => list.indexOf(value) < list.indexOf(seen[index - 1] ?? value))) fail("Declared H2 headings are out of order");
    }
  }
}

function validateUniqueness(notes: ManagedNote[], schemas: Map<string, Data>, config: Data, results: ValidationResult[]) {
  type Policy = { collection: boolean; types: Set<string> };
  type Entry = { note: ManagedNote; value: unknown; definition: FieldDefinition };
  type Group = { field: string; collection: boolean; entries: Entry[] };
  const policies = new Map<string, Policy>();
  policies.set(JSON.stringify(["id", "text"]), { collection: true, types: new Set() });
  // A collection-wide declaration governs same-named, same-typed fields, not
  // just notes whose schema repeats the declaration (or currently has notes).
  for (const [noteType, schema] of schemas) for (const [field, definition] of Object.entries(noteFieldDefinitions(schema))) {
    if (!definition.unique || !comparisonDomain(definition)) continue;
    const key = JSON.stringify([field, definition.type]);
    const policy = policies.get(key) ?? { collection: false, types: new Set<string>() };
    if (definition.unique === "collection") policy.collection = true;
    else policy.types.add(noteType);
    policies.set(key, policy);
  }
  const groups = new Map<string, Group>();
  for (const note of notes) {
    for (const [field, definition] of Object.entries(note.fields)) {
      const value = note.values[field];
      const policy = policies.get(JSON.stringify([field, definition.type]));
      if (!policy || (!policy.collection && !policy.types.has(note.noteType)) || value === null || value === undefined) continue;
      // Invalid type-domain values have their own field findings; do not coerce
      // them or let an invalid temporal value throw during comparison.
      if (validateFieldValue(value, { type: definition.type, format: definition.format }, config.timezone ?? "UTC")) continue;
      const key = JSON.stringify([policy.collection ? null : note.noteType, field, definition.type]);
      const group = groups.get(key) ?? { field, collection: policy.collection, entries: [] };
      group.entries.push({ note, value, definition });
      groups.set(key, group);
    }
  }
  for (const group of groups.values()) {
    const compare = (left: Entry, right: Entry) => compareFieldValues(left.value, right.value, left.definition, config.timezone ?? "UTC");
    group.entries.sort((left, right) => compare(left, right) || compareUnicodeCodePoints(left.note.path, right.note.path));
    let first: Entry | undefined;
    for (const entry of group.entries) {
      if (first && compare(first, entry) === 0) {
        const rule = group.field === "id" ? "MN-48" : group.collection ? "FDR-84" : "FDR-83";
        add(results, config, "duplicate_unique_value", entry.note.path, rule, `${group.field} duplicates ${first.note.path}`, { note_type: entry.note.noteType, field: group.field });
      } else first = entry;
    }
  }
}

function validateCounts(notes: Array<{ noteType: string }>, schemas: Map<string, Data>, config: Data, results: ValidationResult[]) {
  for (const [noteType, schema] of schemas) {
    if (!schema.count) continue;
    const count = notes.filter((note) => note.noteType === noteType).length;
    if ((schema.count.min !== undefined && count < schema.count.min) || (schema.count.max !== undefined && count > schema.count.max)) {
      add(results, config, "invalid_note_count", ".", "NTS-71", `${noteType} has ${count} managed notes`, { note_type: noteType });
    }
  }
}

function discoverFiles(root: string, metadataDirectory: string, excludes: string[]): string[] {
  const result: string[] = [];
  const visit = (directory: string, relativeDirectory = "") => {
    for (const entry of readdirSync(directory, { withFileTypes: true })) {
      const relativePath = normalized(join(relativeDirectory, entry.name));
      if (relativeDirectory === "" && (entry.name.normalize("NFC") === metadataDirectory.normalize("NFC") || entry.name === "typedmark.md")) continue;
      if (entry.isDirectory() ? isSubtreeExcluded(relativePath, excludes) : isExcluded(relativePath, excludes)) continue;
      const absolute = join(directory, entry.name);
      if (entry.isSymbolicLink() || lstatSync(absolute).isSymbolicLink()) continue;
      if (entry.isDirectory()) {
        if (existsSync(join(absolute, "typedmark.md"))) continue;
        visit(absolute, relativePath);
      } else if (entry.isFile()) result.push(relativePath);
    }
  };
  visit(root);
  return result.sort();
}

type Association = { matched: false } | { matched: true; candidate: unknown };

function candidateTypes(association: Association): string[] {
  return association.matched && typeof association.candidate === "string" ? [association.candidate] : [];
}

function validateMappingDeclarations(config: Data, schemas: Map<string, Data>) {
  const failures: Array<{ rule: string; message: string }> = [];
  for (const mapping of config.note_type_mappings ?? []) {
    if (mapping.kind !== "frontmatter_field" && (!schemas.has(mapping.note_type) || schemas.get(mapping.note_type)?.abstract === true)) {
      failures.push({ rule: mapping.kind === "fixed" ? "CM-83" : "CM-92", message: `Mapping target ${mapping.note_type} is not a known concrete note type` });
    }
    const patterns = [mapping.when?.path?.regex, ...Object.values(mapping.when?.frontmatter ?? {}).map((predicate) => (predicate as Data).regex)];
    for (const pattern of patterns) if (pattern !== undefined) {
      try { fullPattern(pattern); } catch { failures.push({ rule: "FND-31", message: "Invalid note-type mapping regular expression" }); }
    }
  }
  return failures;
}

function selectNoteType(config: Data, path: string, frontmatter: Data, hasFrontmatter: boolean): Association {
  path = path.normalize("NFC");
  const mappings = Array.isArray(config.note_type_mappings) ? config.note_type_mappings : [{ kind: "frontmatter_field", field: "note_type" }];
  for (const mapping of mappings) {
    if (mapping.kind === "frontmatter_field" && Object.hasOwn(frontmatter, mapping.field)) return { matched: true, candidate: frontmatter[mapping.field] };
    if (mapping.kind === "folder" && path.startsWith(mapping.folder.normalize("NFC"))) return { matched: true, candidate: mapping.note_type };
    if (mapping.kind === "tag" && Array.isArray(frontmatter.tags)) {
      const expected = mapping.tag.normalize("NFC");
      if (frontmatter.tags.some((tag: unknown) => typeof tag === "string" && (tag.normalize("NFC") === expected || tag.normalize("NFC").startsWith(`${expected}/`)))) {
        return { matched: true, candidate: mapping.note_type };
      }
    }
    if (mapping.kind === "fixed" && matchesWhen(mapping.when, path, frontmatter, hasFrontmatter)) return { matched: true, candidate: mapping.note_type };
  }
  return { matched: false };
}

function matchesWhen(when: Data, path: string, frontmatter: Data, hasFrontmatter: boolean) {
  if (when.path?.equals !== undefined && path !== when.path.equals.normalize("NFC")) return false;
  if (when.path?.under !== undefined && !path.startsWith(when.path.under.normalize("NFC"))) return false;
  if (when.path?.regex !== undefined && !fullPattern(when.path.regex).test(path)) return false;
  if (when.frontmatter && (!hasFrontmatter || !matchesFrontmatterPredicates(when.frontmatter, frontmatter))) return false;
  return true;
}

function add(results: ValidationResult[], config: Data, code: string, path: string, rule_id: string, message: string, context: Partial<ValidationResult> = {}, schema?: Data) {
  const configured = code === "unknown_field" && schema?.unknown_field ? schema.unknown_field : config.validation_defaults?.[code];
  const severity = configured ?? DEFAULT_SEVERITIES[code] ?? "error";
  if (severity === "off") return;
  results.push({ code, severity: severity as Severity, path: normalized(path), rule_id, message, ...context });
}

function report(specification_version: string, mode: ValidationReport["mode"], required_extensions: ExtensionMap, evaluated_extensions: ExtensionMap, evaluation: "complete" | "incomplete", results: ValidationResult[]): ValidationReport {
  sortResults(results);
  return {
    specification_version,
    mode,
    evaluation,
    required_extensions,
    evaluated_extensions,
    valid: evaluation === "complete" && !results.some((result) => result.severity === "error"),
    results,
  };
}

function sortResults(results: ValidationResult[]) {
  results.sort((left, right) => {
    for (const key of RESULT_ORDER) {
      const leftValue = String(left[key] ?? "");
      const rightValue = String(right[key] ?? "");
      const compared = compareUnicodeCodePoints(leftValue, rightValue);
      if (compared !== 0) return compared;
    }
    return 0;
  });
}

function extractHeadings(body: string) {
  const headings: Array<{ depth: number; text: string }> = [];
  let fenced = false;
  const lines = body.split(/\r?\n/);
  for (let index = 0; index < lines.length; index++) {
    const line = lines[index]!;
    if (/^\s{0,3}(```|~~~)/.test(line)) { fenced = !fenced; continue; }
    if (fenced) continue;
    const atx = /^\s{0,3}(#{1,6})\s+(.+?)\s*#*\s*$/.exec(line);
    if (atx) headings.push({ depth: atx[1]!.length, text: atx[2]!.trim() });
    else if (index + 1 < lines.length && /^\s{0,3}(=+|-+)\s*$/.test(lines[index + 1]!)) {
      headings.push({ depth: lines[index + 1]!.trim().startsWith("=") ? 1 : 2, text: line.trim() });
      index++;
    }
  }
  return headings;
}

function sameCompatibilityLine(left: string, right: string) {
  return left.split(".").slice(0, 2).join(".") === right.split(".").slice(0, 2).join(".");
}

function safeMetadataDirectory(value: unknown): string {
  return typeof value === "string" && value !== "." && value !== ".." && /^[^/\\]+$/.test(value) ? value : ".typedmark";
}

function stringMap(value: Data): ExtensionMap {
  return Object.fromEntries(Object.entries(value).filter((entry): entry is [string, string] => typeof entry[1] === "string"));
}

function arrayOfStrings(value: unknown): string[] {
  return Array.isArray(value) ? value.filter((entry): entry is string => typeof entry === "string") : [];
}

// Validate the governed tag grammar and uniqueness on logical strings, without
// normalizing arbitrary data or changing the authored collection/schema model.
function normalizedMandatoryTags(data: Data): Data {
  return { ...data, ...(Array.isArray(data.mandatory_tags) ? {
    mandatory_tags: data.mandatory_tags.map((tag: unknown) => typeof tag === "string" ? tag.normalize("NFC") : tag),
  } : {}) };
}

function isRecord(value: unknown): value is Data {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

function normalized(path: string) { return path.replaceAll("\\", "/"); }
function errorMessage(error: unknown) { return error instanceof Error ? error.message : String(error); }
function schemaError(errors: Array<{ instancePath?: string; message?: string }>) { return errors.map((error) => `${error.instancePath || "/"} ${error.message ?? "is invalid"}`).join("; "); }

export { STANDARD_EXTENSIONS };
