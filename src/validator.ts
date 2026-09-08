import { Temporal } from "@js-temporal/polyfill";
import { existsSync, lstatSync, readFileSync, readdirSync } from "node:fs";
import { basename, dirname, join, relative } from "node:path";
import { parseMarkdown } from "./frontmatter";
import { compareUnicodeCodePoints } from "./order";
import { SchemaRegistry } from "./schema-registry";
import type {
  ExtensionMap,
  Severity,
  ValidateCollectionInput,
  ValidationReport,
  ValidationResult,
} from "./types";

type Data = Record<string, any>;

const IMPLEMENTED_CORE = "0.1.0";
const CORE_FIELDS: Record<string, Data> = {
  note_type: { type: "text", nullable: false },
  id: { type: "text", format: "slug", nullable: true },
  deleted: { type: "checkbox", nullable: false, default_value: false },
  archived: { type: "checkbox", nullable: false, default_value: false },
  aliases: { type: "list", items: { type: "text" }, nullable: false, default_value: [] },
  tags: { type: "tags", nullable: false, default_value: [] },
  title: { type: "text", nullable: true },
  description: { type: "text", nullable: true },
  created_at: { type: "datetime", nullable: true },
  updated_at: { type: "datetime", nullable: true },
};

const DEFAULT_SEVERITIES: Record<string, "error" | "warn"> = {
  unknown_field: "warn",
  template_drift: "warn",
};

const RESULT_ORDER = [
  "path", "rule_id", "code", "note_type", "field", "relationship", "heading",
  "expansion", "dataset", "view", "template_region", "drift_kind", "extension",
] as const;

export function validateCollection(input: ValidateCollectionInput): ValidationReport {
  const root = input.collectionRoot;
  const mode = input.mode ?? "instantiated_collection";
  const registry = new SchemaRegistry(input.schemaDirectory);
  const results: ValidationResult[] = [];
  const configPath = join(root, "typedmark.md");
  let config: Data = {};

  if (!existsSync(configPath)) {
    add(results, {}, "invalid_collection_configuration", "typedmark.md", "CM-1", "typedmark.md is missing");
    return report(input.referenceEdition ?? IMPLEMENTED_CORE, mode, {}, {}, "complete", results);
  }

  try {
    config = parseMarkdown(readFileSync(configPath, "utf8")).data;
  } catch (error) {
    add(results, {}, "invalid_collection_configuration", "typedmark.md", "CM-537", errorMessage(error));
    return report(input.referenceEdition ?? IMPLEMENTED_CORE, mode, {}, {}, "complete", results);
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
    add(results, config, "unsupported_specification_version", "typedmark.md", "FND-71", `Unsupported specification version ${version}`);
  }

  const configErrors = registry.validate("typedmark.schema.json", config);
  if (configErrors.length > 0) {
    add(results, config, "invalid_collection_configuration", "typedmark.md", "CM-537", schemaError(configErrors));
  }

  for (const [extension, requiredVersion] of Object.entries(requiredExtensions).sort()) {
    if (supportedExtensions[extension] === requiredVersion) {
      evaluatedExtensions[extension] = requiredVersion;
    } else {
      evaluation = "incomplete";
      add(results, config, "unsupported_extension", "typedmark.md", "EXT-19", `${extension} at ${requiredVersion} is required but unsupported`, { extension });
    }
  }

  const metadataDirectory = safeMetadataDirectory(config.metadata_directory);
  validateSystemContract(root, metadataDirectory, mode, config, requiredExtensions, evaluatedExtensions, registry, results);
  const schemaArtifacts = loadArtifacts(join(root, metadataDirectory, "schemas"), root, "invalid_note_type_schema", "CM-538", results, config);
  const propertySets = evaluatedExtensions["typedmark:reuse"]
    ? loadNamedArtifacts(join(root, metadataDirectory, "property-sets"), root, "property_set", "property-set.schema.json", registry, "invalid_property_set", "CM-533", results, config)
    : new Map<string, Data>();
  const schemas = new Map<string, Data>();

  for (const artifact of schemaArtifacts) {
    const errors = registry.validate("note-type.schema.json", artifact.data);
    const inferredName = basename(artifact.path, ".md");
    const name = typeof artifact.data.note_type === "string" ? artifact.data.note_type : inferredName;
    if (errors.length > 0 || name !== inferredName || schemas.has(name)) {
      add(results, config, "invalid_note_type_schema", artifact.relativePath, "NTS-4", errors.length ? schemaError(errors) : `Schema identity ${name} does not match ${inferredName}`);
      continue;
    }
    schemas.set(name, artifact.data);
  }

  validateOptionalArtifacts(root, metadataDirectory, requiredExtensions, evaluatedExtensions, registry, results, config);

  const effectiveSchemas = new Map<string, Data>();
  const resolving = new Set<string>();
  const effectiveSchema = (name: string): Data | undefined => {
    if (effectiveSchemas.has(name)) return effectiveSchemas.get(name);
    const local = schemas.get(name);
    if (!local || resolving.has(name)) return undefined;
    resolving.add(name);
    let effective: Data = { ...local, frontmatter: { ...(local.frontmatter ?? {}) } };
    if (typeof local.extends === "string" && evaluatedExtensions["typedmark:reuse"]) {
      const parent = effectiveSchema(local.extends);
      if (parent) effective = mergeSchemas(parent, effective);
    }
    if (evaluatedExtensions["typedmark:reuse"]) {
      const names = [...arrayOfStrings(config.default_property_sets), ...arrayOfStrings(local.property_sets)]
        .filter((value) => !arrayOfStrings(local.exclude_property_sets).includes(value));
      for (const propertySetName of names) {
        const propertySet = propertySets.get(propertySetName);
        if (!propertySet) {
          add(results, config, "invalid_property_set", `.typedmark/schemas/${name}.md`, "PS-8", `Unknown property set ${propertySetName}`);
          continue;
        }
        effective = mergeSchemas(propertySet, effective);
      }
      for (const field of arrayOfStrings(local.frontmatter_remove)) delete effective.frontmatter?.[field];
    }
    resolving.delete(name);
    effectiveSchemas.set(name, effective);
    return effective;
  };

  for (const name of schemas.keys()) {
    const schema = effectiveSchema(name);
    if (!schema) add(results, config, "invalid_note_type_schema", `${metadataDirectory}/schemas/${name}.md`, "NTS-13", "Schema inheritance is cyclic or unresolved");
    else validateTemplate(root, metadataDirectory, name, schema, registry, results, config);
  }

  const notes = discoverNotes(root, metadataDirectory, arrayOfStrings(config.exclude_paths));
  const effectiveNotes: Array<{ path: string; noteType: string; values: Data; fields: Data }> = [];
  for (const notePath of notes) {
    let document;
    try {
      document = parseMarkdown(readFileSync(join(root, notePath), "utf8"));
    } catch (error) {
      add(results, config, "invalid_note_frontmatter", notePath, "MN-118", errorMessage(error));
      continue;
    }
    const candidates = noteTypeCandidates(config, notePath, document.data);
    if (candidates.length === 0) continue;
    if (candidates.length !== 1 || !schemas.has(candidates[0]!)) {
      add(results, config, "invalid_note_type_mapping", notePath, "MN-120", "The note does not resolve to exactly one known concrete note type");
      continue;
    }
    const noteType = candidates[0]!;
    const schema = effectiveSchema(noteType);
    if (!schema || schema.abstract === true) {
      add(results, config, "invalid_note_type_mapping", notePath, "MN-120", `Unknown or abstract note type ${noteType}`);
      continue;
    }
    const validation = validateNote(notePath, document.data, document.body, noteType, schema, config);
    results.push(...validation.results);
    effectiveNotes.push({ path: notePath, noteType, values: validation.values, fields: validation.fields });
  }

  validateUniqueness(effectiveNotes, config, results);
  validateCounts(effectiveNotes, schemas, config, results);
  sortResults(results);
  return report(version, mode, requiredExtensions, evaluatedExtensions, evaluation, results);
}

const STANDARD_EXTENSIONS: ExtensionMap = {
  "typedmark:automation": "0.1.0",
  "typedmark:queries": "0.1.0",
  "typedmark:reuse": "0.1.0",
  "typedmark:systems": "0.1.0",
  "typedmark:views": "0.1.0",
};

function validateSystemContract(root: string, metadataDirectory: string, mode: ValidationReport["mode"], config: Data, required: ExtensionMap, evaluated: ExtensionMap, registry: SchemaRegistry, results: ValidationResult[]) {
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
      if (source.name === config.name || names.has(source.name)) add(results, config, "invalid_composition", "typedmark.md", "SCE-50", `Invalid or duplicate composition source ${source.name}`);
      names.add(source.name);
    }
  }
  if (!existsSync(historyPath)) return;
  try {
    const history = parseMarkdown(readFileSync(historyPath, "utf8")).data;
    const errors = registry.validate("history.schema.json", history);
    if (errors.length > 0) add(results, config, "invalid_history", normalized(relative(root, historyPath)), "SCE-95", schemaError(errors));
    const entries = Array.isArray(history.history) ? history.history : [];
    if (typeof config.version === "string" && entries.at(-1)?.version !== config.version) add(results, config, "invalid_history", normalized(relative(root, historyPath)), "SCE-100", "The last history version must equal the system version");
  } catch (error) {
    add(results, config, "invalid_history", normalized(relative(root, historyPath)), "SCE-95", errorMessage(error));
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
        return { path, relativePath, data: parseMarkdown(readFileSync(path, "utf8")).data };
      } catch (error) {
        add(results, config, code, relativePath, rule, errorMessage(error));
        return { path, relativePath, data: {} };
      }
    });
}

function loadNamedArtifacts(directory: string, root: string, identity: string, schemaName: string, registry: SchemaRegistry, code: string, rule: string, results: ValidationResult[], config: Data) {
  const values = new Map<string, Data>();
  for (const artifact of loadArtifacts(directory, root, code, rule, results, config)) {
    const errors = registry.validate(schemaName, artifact.data);
    const inferred = basename(artifact.path, ".md");
    const name = artifact.data[identity] ?? inferred;
    if (errors.length > 0 || name !== inferred) add(results, config, code, artifact.relativePath, rule, errors.length ? schemaError(errors) : `Artifact identity ${name} does not match ${inferred}`);
    else values.set(name, artifact.data);
  }
  return values;
}

function validateOptionalArtifacts(root: string, metadataDirectory: string, required: ExtensionMap, evaluated: ExtensionMap, registry: SchemaRegistry, results: ValidationResult[], config: Data) {
  const definitions = [
    ["typedmark:automation", "automations", "automation", "automation.schema.json", "invalid_automation", "AUTO-2"],
    ["typedmark:views", "datasets", "dataset", "dataset.schema.json", "invalid_dataset", "DV-2"],
    ["typedmark:views", "views", "view", "view.schema.json", "invalid_view", "DV-34"],
  ] as const;
  for (const [extension, directory, identity, schema, code, rule] of definitions) {
    const path = join(root, metadataDirectory, directory);
    const hasArtifacts = existsSync(path) && readdirSync(path, { withFileTypes: true }).some((entry) => entry.isFile() && entry.name.endsWith(".md"));
    if (hasArtifacts && !required[extension]) add(results, config, "invalid_extension_declaration", "typedmark.md", "EXT-16", `${directory} requires ${extension}`, { extension });
    if (evaluated[extension]) loadNamedArtifacts(path, root, identity, schema, registry, code, rule, results, config);
  }
}

function validateTemplate(root: string, metadataDirectory: string, noteType: string, schema: Data, registry: SchemaRegistry, results: ValidationResult[], config: Data) {
  const explicit = schema.template && typeof schema.template.file === "string";
  const templateName = explicit ? schema.template.file : `${noteType}.md`;
  const path = join(root, metadataDirectory, "templates", templateName);
  if (!existsSync(path)) {
    if (explicit) add(results, config, "invalid_template", normalized(relative(root, path)), "RHT-73", `Explicit template ${templateName} is missing`);
    return;
  }
  if (lstatSync(path).isSymbolicLink()) {
    add(results, config, "invalid_template", normalized(relative(root, path)), "RHT-73", `Template ${templateName} must not be a symbolic link`);
    return;
  }
  try {
    const template = parseMarkdown(readFileSync(path, "utf8"));
    if (template.hasFrontmatter) {
      const declared = new Set([...Object.keys(CORE_FIELDS), ...Object.keys(schema.frontmatter ?? {})]);
      const unknown = Object.keys(template.data).find((field) => !declared.has(field));
      if (unknown) add(results, config, "invalid_template", normalized(relative(root, path)), "RHT-76", `Template field ${unknown} is undeclared`);
    }
  } catch (error) {
    add(results, config, "invalid_template", normalized(relative(root, path)), "RHT-67", errorMessage(error));
  }
}

function validateNote(path: string, stored: Data, body: string, noteType: string, schema: Data, config: Data) {
  const results: ValidationResult[] = [];
  const fields: Data = {};
  for (const [name, definition] of Object.entries(CORE_FIELDS)) fields[name] = { ...definition, ...(schema.frontmatter?.[name] ?? {}) };
  for (const [name, definition] of Object.entries(schema.frontmatter ?? {})) fields[name] = { ...(fields[name] ?? {}), ...(definition as Data) };
  const values: Data = {};

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
    values[name] = value;
    if (value === null) {
      if (definition.nullable !== true) add(results, config, "missing_required_field", path, "MN-99", `${name} is explicitly null but is not nullable`, { note_type: noteType, field: name }, schema);
      continue;
    }
    const failure = validateValue(value, definition, config.timezone ?? "UTC");
    if (failure) add(results, config, "invalid_field_value", path, failure.rule, `${name} ${failure.message}`, { note_type: noteType, field: name }, schema);
  }

  const declared = new Set(Object.keys(fields));
  for (const field of Object.keys(stored)) {
    if (!declared.has(field)) add(results, config, "unknown_field", path, "MN-111", `${field} is not declared`, { note_type: noteType, field }, schema);
  }

  const mandatory = [...arrayOfStrings(config.mandatory_tags), ...arrayOfStrings(schema.mandatory_tags)].filter((value, index, all) => all.indexOf(value) === index);
  const tags = Array.isArray(values.tags) ? values.tags : [];
  for (const tag of mandatory) {
    if (!tags.includes(tag)) add(results, config, "invalid_field_value", path, "MN-128", `tags is missing the effective mandatory tag ${tag}`, { note_type: noteType, field: "tags" }, schema);
  }

  validateStorage(path, values, fields, schema, noteType, config, results);
  validateHeadings(path, body, values.title, schema.headings, noteType, config, results);
  return { values, fields, results };
}

function validateValue(value: unknown, definition: Data, timezone: string): { rule: string; message: string } | undefined {
  const type = definition.type;
  const typeRules: Record<string, string> = { text: "FDR-8", integer: "FDR-9", number: "FDR-11", checkbox: "FDR-12", date: "FDR-13", time: "FDR-14", datetime: "FDR-15", link: "FDR-19", list: "FDR-20", tags: "FDR-21", object: "FDR-28", any: "FDR-29" };
  let valid = true;
  if (type === "text" || type === "link") valid = typeof value === "string";
  else if (type === "integer") valid = typeof value === "number" && Number.isInteger(value);
  else if (type === "number") valid = typeof value === "number" && Number.isFinite(value);
  else if (type === "checkbox") valid = typeof value === "boolean";
  else if (type === "date") valid = isDate(value);
  else if (type === "time") valid = isTime(value, definition.format);
  else if (type === "datetime") valid = isDateTime(value, timezone);
  else if (type === "list") valid = Array.isArray(value);
  else if (type === "tags") valid = Array.isArray(value) && value.every((tag) => typeof tag === "string" && /^[\p{L}\p{N}_][\p{L}\p{N}_-]*(?:\/[\p{L}\p{N}_][\p{L}\p{N}_-]*)*$/u.test(tag)) && new Set(value).size === value.length;
  else if (type === "object") valid = isRecord(value);
  if (!valid) return { rule: typeRules[type] ?? "FDR-7", message: `must satisfy the ${type} value contract` };

  if (type === "list" && definition.items) {
    for (const item of value as unknown[]) {
      const failure = validateValue(item, definition.items, timezone);
      if (failure) return failure;
    }
  }
  if (type === "object" && definition.fields) {
    const object = value as Data;
    for (const [name, child] of Object.entries(definition.fields as Data)) {
      if (!Object.hasOwn(object, name)) continue;
      if (object[name] === null) return { rule: "MN-99", message: `contains null for non-nullable ${name}` };
      const failure = validateValue(object[name], child as Data, timezone);
      if (failure) return failure;
    }
  }
  if ((type === "text" || type === "link") && definition.not_blank === true && !/\S/u.test(value as string)) return { rule: "FDR-176", message: "must not be blank" };
  if (type === "object" && definition.not_empty === true && Object.keys(value as Data).length === 0) return { rule: "FDR-171", message: "must not be empty" };
  if (definition.format === "slug" && !/^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(value as string)) return { rule: "FDR-139", message: "must use slug format" };
  if (definition.format === "uri") {
    try { if (!(new URL(value as string)).protocol) throw new Error(); } catch { return { rule: "FDR-140", message: "must be an absolute URI" }; }
  }
  if (typeof definition.regex === "string" && !(new RegExp(`^(?:${definition.regex})$`, "u")).test(value as string)) return { rule: "FDR-181", message: "does not match the declared regular expression" };
  const measure: string | number = typeof value === "string"
    ? (type === "text" || type === "link" ? [...value].length : value)
    : Array.isArray(value)
      ? value.length
      : typeof value === "number"
        ? value
        : String(value);
  if (definition.min !== undefined && measure < definition.min) return { rule: "FDR-187", message: `is less than ${definition.min}` };
  if (definition.max !== undefined && measure > definition.max) return { rule: "FDR-193", message: `is greater than ${definition.max}` };
  if (Array.isArray(definition.allowed_values)) {
    const candidates = type === "list" ? value as unknown[] : [value];
    if (candidates.some((candidate) => !definition.allowed_values.some((allowed: unknown) => deepEqual(allowed, candidate)))) return { rule: "FDR-198", message: "is not in allowed_values" };
  }
  if (Object.hasOwn(definition, "const_value") && !deepEqual(value, definition.const_value)) return { rule: "FDR-213", message: "does not equal const_value" };
  return undefined;
}

function validateStorage(path: string, values: Data, fields: Data, schema: Data, noteType: string, config: Data, results: ValidationResult[]) {
  const storage = values.archived === true && schema.storage?.archive ? schema.storage.archive : schema.storage;
  if (!storage) return;
  const resolvePattern = (pattern: string) => pattern.replace(/\{([a-z][a-z0-9_]*)(?::([^}]+))?\}/g, (_all, field, format) => formatStorageValue(values[field], fields[field], format, config.timezone ?? "UTC"));
  const folder = resolvePattern(storage.folder_pattern ?? "");
  const prefix = resolvePattern(storage.note_name_prefix?.pattern ?? "");
  const name = resolvePattern(storage.note_name_pattern ?? "");
  const suffix = resolvePattern(storage.note_name_suffix?.pattern ?? "");
  const expected = `${folder ? `${folder}/` : ""}${prefix}${name}${suffix}.md`.normalize("NFC");
  if (!expected.includes("undefined") && path.normalize("NFC") !== expected) add(results, config, "path", path, "NTS-146", `Expected managed-note path ${expected}`, { note_type: noteType }, schema);
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

function validateUniqueness(notes: Array<{ path: string; noteType: string; values: Data; fields: Data }>, config: Data, results: ValidationResult[]) {
  const seen = new Map<string, string>();
  for (const note of notes) {
    for (const [field, definition] of Object.entries(note.fields)) {
      const value = note.values[field];
      const unique = field === "id" ? "collection" : (definition as Data).unique;
      if (!unique || value === null || value === undefined) continue;
      const scope = unique === "collection" ? "collection" : note.noteType;
      const key = `${scope}\0${field}\0${JSON.stringify(value)}`;
      if (seen.has(key)) add(results, config, "duplicate_unique_value", note.path, field === "id" ? "MN-48" : "FDR-83", `${field} duplicates ${seen.get(key)}`, { note_type: note.noteType, field });
      else seen.set(key, note.path);
    }
  }
}

function validateCounts(notes: Array<{ noteType: string }>, schemas: Map<string, Data>, config: Data, results: ValidationResult[]) {
  for (const [noteType, schema] of schemas) {
    if (!schema.count) continue;
    const count = notes.filter((note) => note.noteType === noteType).length;
    if ((schema.count.min !== undefined && count < schema.count.min) || (schema.count.max !== undefined && count > schema.count.max)) {
      add(results, config, "invalid_note_count", ".", "NTS-94", `${noteType} has ${count} managed notes`, { note_type: noteType });
    }
  }
}

function discoverNotes(root: string, metadataDirectory: string, excludes: string[]): string[] {
  const result: string[] = [];
  const visit = (directory: string, relativeDirectory = "") => {
    for (const entry of readdirSync(directory, { withFileTypes: true })) {
      const relativePath = normalized(join(relativeDirectory, entry.name));
      if (relativeDirectory === "" && (entry.name === metadataDirectory || entry.name === "typedmark.md")) continue;
      if (isExcluded(relativePath, excludes)) continue;
      const absolute = join(directory, entry.name);
      if (entry.isSymbolicLink() || lstatSync(absolute).isSymbolicLink()) continue;
      if (entry.isDirectory()) {
        if (existsSync(join(absolute, "typedmark.md"))) continue;
        visit(absolute, relativePath);
      } else if (entry.isFile() && entry.name.endsWith(".md")) result.push(relativePath);
    }
  };
  visit(root);
  return result.sort();
}

function noteTypeCandidates(config: Data, path: string, frontmatter: Data): string[] {
  const mappings = Array.isArray(config.note_type_mappings) ? config.note_type_mappings : [{ kind: "frontmatter_field", field: "note_type" }];
  const candidates: string[] = [];
  for (const mapping of mappings) {
    let candidate: unknown;
    if (mapping.kind === "frontmatter_field") candidate = frontmatter.note_type;
    else if (mapping.kind === "folder" && path.startsWith(mapping.folder)) candidate = mapping.note_type;
    else if (mapping.kind === "tag" && Array.isArray(frontmatter.tags) && frontmatter.tags.some((tag: string) => tag === mapping.tag || tag.startsWith(`${mapping.tag}/`))) candidate = mapping.note_type;
    else if (mapping.kind === "fixed" && matchesWhen(mapping.when, path, frontmatter)) candidate = mapping.note_type;
    if (typeof candidate === "string" && !candidates.includes(candidate)) candidates.push(candidate);
  }
  return candidates;
}

function matchesWhen(when: Data, path: string, frontmatter: Data) {
  if (when.path?.equals !== undefined && path !== when.path.equals) return false;
  if (when.path?.under !== undefined && !path.startsWith(when.path.under)) return false;
  if (when.path?.regex !== undefined && !(new RegExp(`^(?:${when.path.regex})$`, "u")).test(path)) return false;
  if (when.frontmatter) {
    for (const [field, predicate] of Object.entries(when.frontmatter as Data)) {
      if (isRecord(predicate) && Object.hasOwn(predicate, "equals") && !deepEqual(frontmatter[field], predicate.equals)) return false;
    }
  }
  return true;
}

function mergeSchemas(base: Data, overlay: Data): Data {
  return {
    ...base,
    ...overlay,
    storage: overlay.storage ?? base.storage,
    frontmatter: { ...(base.frontmatter ?? {}), ...(overlay.frontmatter ?? {}) },
    relationships: { ...(base.relationships ?? {}), ...(overlay.relationships ?? {}) },
    headings: { ...(base.headings ?? {}), ...(overlay.headings ?? {}) },
    mandatory_tags: [...arrayOfStrings(base.mandatory_tags), ...arrayOfStrings(overlay.mandatory_tags)].filter((value, index, all) => all.indexOf(value) === index),
  };
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

function formatStorageValue(value: unknown, definition: Data | undefined, format: string | undefined, timezone: string) {
  if (value === undefined || value === null || typeof value === "object") return "undefined";
  if (!format) return String(value);
  try {
    const date = definition?.type === "datetime"
      ? (/[zZ]|[+-]\d{2}:\d{2}$/.test(String(value)) ? Temporal.Instant.from(String(value)).toZonedDateTimeISO(timezone).toPlainDate() : Temporal.PlainDateTime.from(String(value)).toPlainDate())
      : Temporal.PlainDate.from(String(value));
    if (format === "YYYY") return String(date.year).padStart(4, "0");
    if (format === "MM") return String(date.month).padStart(2, "0");
    if (format === "DD") return String(date.day).padStart(2, "0");
    if (format === "YYYY-MM") return `${date.year}-${String(date.month).padStart(2, "0")}`;
    if (format === "YYYY-MM-DD") return date.toString();
    if (format === "Q") return String(Math.floor((date.month - 1) / 3) + 1);
    if (format === "WW") return String(date.weekOfYear).padStart(2, "0");
    if (format === "GGGG") return String(date.yearOfWeek).padStart(4, "0");
  } catch {}
  return "undefined";
}

function isDate(value: unknown) {
  if (typeof value !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  try { return Temporal.PlainDate.from(value).toString() === value; } catch { return false; }
}

function isTime(value: unknown, format: unknown) {
  if (typeof value !== "string") return false;
  const patterns: Record<string, RegExp> = { "hh:mm": /^(?:[01]\d|2[0-3]):[0-5]\d$/, "hh:mm:ss": /^(?:[01]\d|2[0-3]):[0-5]\d:[0-5]\d$/, "hh:mm:ss.sss": /^(?:[01]\d|2[0-3]):[0-5]\d:[0-5]\d\.\d{3}$/ };
  return typeof format === "string" && Boolean(patterns[format]?.test(value));
}

function isDateTime(value: unknown, timezone: string) {
  if (typeof value !== "string" || !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}(?::\d{2}(?:\.\d+)?)?(?:Z|[+-]\d{2}:\d{2})?$/.test(value)) return false;
  try {
    if (/[zZ]|[+-]\d{2}:\d{2}$/.test(value)) Temporal.Instant.from(value);
    else Temporal.PlainDateTime.from(value).toZonedDateTime(timezone, { disambiguation: "reject" });
    return true;
  } catch { return false; }
}

function isExcluded(path: string, globs: string[]) {
  return globs.some((glob) => {
    const regex = glob.replace(/[.+^${}()|[\]\\]/g, "\\$&").replace(/\*\*/g, "\u0000").replace(/\*/g, "[^/]*").replace(/\?/g, "[^/]").replace(/\u0000/g, ".*");
    return new RegExp(`^${regex}$`, "u").test(path);
  });
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

function isRecord(value: unknown): value is Data {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

function normalized(path: string) { return path.replaceAll("\\", "/"); }
function deepEqual(left: unknown, right: unknown) { return JSON.stringify(left) === JSON.stringify(right); }
function errorMessage(error: unknown) { return error instanceof Error ? error.message : String(error); }
function schemaError(errors: Array<{ instancePath?: string; message?: string }>) { return errors.map((error) => `${error.instancePath || "/"} ${error.message ?? "is invalid"}`).join("; "); }

export { STANDARD_EXTENSIONS };
