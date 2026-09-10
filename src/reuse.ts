import type { ValidationResult } from "./types";

type Data = Record<string, any>;
export interface SchemaIssue {
  kind: "invalid" | "unavailable";
  path: string;
  message: string;
  specificationVersion?: string;
  extension?: string;
}
export interface SchemaSource { path: string; version: string }
export interface ResolvedSchemas {
  schemas: Map<string, Data>;
  issues: Map<string, SchemaIssue>;
  sources: Map<string, SchemaSource[]>;
  results: ValidationResult[];
}
interface ResolveInput {
  schemas: Map<string, Data>;
  propertySets: Map<string, Data>;
  config: Data;
  metadataDirectory: string;
  enabled: boolean;
  schemaIssues?: Map<string, SchemaIssue>;
  propertySetIssues?: Map<string, SchemaIssue>;
}
const inheritedKeys = ["storage", "template", "mandatory_tags", "guidance", "unknown_field", "conditions", "count"];

export function matchesNoteType(schemas: Map<string, Data>, actual: string, requested: string): boolean {
  if (actual === requested) return true;
  if (!schemas.get(requested)?.abstract) return false;
  const seen = new Set<string>();
  let parent = schemas.get(actual)?.extends;
  while (typeof parent === "string" && !seen.has(parent)) {
    if (parent === requested) return true;
    seen.add(parent); parent = schemas.get(parent)?.extends;
  }
  return false;
}

export function resolveSchemas(input: ResolveInput): ResolvedSchemas {
  const result: ResolvedSchemas = { schemas: new Map(), issues: structuredClone(input.schemaIssues ?? new Map()), sources: new Map(), results: [] };
  const contributions = new Map<string, Data>();
  const pathOf = (name: string) => `${input.metadataDirectory}/schemas/${name}.md`;
  const defaults: string[] = Array.isArray(input.config.default_property_sets) ? input.config.default_property_sets : [];
  const mark = (name: string, issue: SchemaIssue) => {
    if (result.issues.get(name)?.kind !== "unavailable") result.issues.set(name, structuredClone(issue));
  };
  const problem = (name: string, rule: string, message: string, propertySet = false) => {
    const path = pathOf(name);
    mark(name, { kind: "invalid", path, message });
    result.results.push({ code: propertySet ? "invalid_property_set" : "invalid_note_type_schema", severity: "error", path, rule_id: rule, message, note_type: name });
  };
  const unavailable = (name: string, source: SchemaSource) => {
    const message = `Unsupported specification version ${source.version}`;
    mark(name, { kind: "unavailable", path: source.path, message, specificationVersion: source.version });
    if (!result.results.some((finding) => finding.path === source.path && finding.code === "unsupported_specification_version")) {
      result.results.push({ code: "unsupported_specification_version", severity: "error", path: source.path, rule_id: "FND-92", message });
    }
  };
  const missingDefaults = new Map<string, SchemaIssue>();
  const hasSet = (id: string) => input.propertySets.has(id) || input.propertySetIssues?.has(id);
  if (input.enabled) for (const id of defaults) if (!hasSet(id)) {
    const message = `Unknown default property set ${id}`;
    missingDefaults.set(id, { kind: "invalid", path: "typedmark.md", message });
    result.results.push({ code: "invalid_property_set", severity: "error", path: "typedmark.md", rule_id: "CM-137", message });
  }

  const compose = (name: string) => {
    const local = input.schemas.get(name)!;
    if (local.extends && result.issues.has(local.extends)) mark(name, result.issues.get(local.extends)!);
    if (result.issues.has(name)) { result.schemas.set(name, structuredClone(local)); return; }
    const parent = contributions.get(local.extends);
    const effective: Data = { ...structuredClone(local), note_type: name, abstract: local.abstract === true, label: local.label ?? name,
      frontmatter: {}, relationships: { belongs_to: { allowed_note_types: {} }, related_to: { allowed_note_types: {} } }, headings: {},
    };
    // One non-implemented source is sufficient as a completeness witness; this
    // is not a provenance inventory. Full ancestry lists would be quadratic.
    const sources = [...(result.sources.get(local.extends) ?? [])];
    if (!sources.length && local.specification_version !== "0.1.0") sources.push({ path: pathOf(name), version: String(local.specification_version) });
    const apply = (layer: Data) => {
      Object.assign(effective.frontmatter, structuredClone(layer.frontmatter ?? {}));
      for (const kind of ["belongs_to", "related_to"]) Object.assign(effective.relationships[kind].allowed_note_types, structuredClone(layer.relationships?.[kind]?.allowed_note_types ?? {}));
      Object.assign(effective.headings, structuredClone(layer.headings ?? {}));
    };
    const applySet = (id: string, isDefault: boolean) => {
      const issue = input.propertySetIssues?.get(id) ?? (isDefault ? missingDefaults.get(id) : undefined);
      if (issue) { mark(name, issue); return; }
      const set = input.propertySets.get(id);
      if (!set) { problem(name, "CM-165", `Unknown property set ${id}`, true); return; }
      const source = { path: `${input.metadataDirectory}/property-sets/${id}.md`, version: String(set.specification_version) };
      if (!sources.length && source.version !== "0.1.0") sources.push(source);
      if (!source.version.startsWith("0.1.")) { unavailable(name, source); return; }
      apply(set);
    };
    const excluded: string[] = local.exclude_property_sets ?? [];
    const selected: string[] = local.property_sets ?? [];
    const appliedDefaults = defaults.filter((id) => !excluded.includes(id));
    if (!effective.abstract && input.enabled) {
      for (const id of excluded) {
        if (!hasSet(id)) problem(name, "CM-165", `Unknown excluded property set ${id}`, true);
        if (!defaults.includes(id)) problem(name, "CM-166", `Excluded property set ${id} is not a collection default`, true);
      }
      for (const id of selected) if (appliedDefaults.includes(id)) problem(name, "CM-167", `Property set ${id} is both default and opt-in`, true);
      for (const id of appliedDefaults) applySet(id, true);
    }
    if (parent) apply(parent);
    if (!effective.abstract && input.enabled) {
      for (const field of local.frontmatter_remove ?? []) {
        if (!Object.hasOwn(effective.frontmatter, field)) problem(name, "CM-171", `Removed field ${field} has no inherited contribution`, true);
        else delete effective.frontmatter[field];
      }
      for (const id of selected) applySet(id, false);
    }
    apply(local);
    for (const layer of [parent, local]) if (layer) for (const key of inheritedKeys) if (Object.hasOwn(layer, key)) effective[key] = structuredClone(layer[key]);
    // Cache the composed contribution before omission defaults. An absent
    // ancestor heading member must not erase a property-set contribution.
    contributions.set(name, structuredClone(effective));
    effective.headings = { required_h2: [], optional_h2: [], allow_other_h2: true, require_order: false, require_h1_title: false, ...effective.headings };
    effective.mandatory_tags ??= [];
    if (!result.issues.has(name) && !effective.abstract && !effective.storage) problem(name, "NTS-23", "Concrete type has no effective storage block");
    if (effective.count?.min !== undefined && effective.count?.max !== undefined && effective.count.min > effective.count.max) problem(name, "NTS-69", "Note count minimum exceeds maximum");
    result.schemas.set(name, effective);
    result.sources.set(name, sources);
  };

  // Iterative parent-first traversal: no call-stack limit or repeated replay of
  // a full ancestor chain. Each local contribution is composed once.
  for (const start of input.schemas.keys()) {
    if (result.schemas.has(start)) continue;
    const pending: string[] = [];
    const visiting = new Set<string>();
    let name = start;
    while (!result.schemas.has(name)) {
      if (visiting.has(name)) {
        for (const member of pending.slice(pending.indexOf(name))) problem(member, "NTS-37", "Schema inheritance is cyclic");
        break;
      }
      visiting.add(name); pending.push(name);
      const local = input.schemas.get(name)!;
      if (result.issues.has(name)) break;
      const usesReuse = local.abstract === true || ["extends", "property_sets", "exclude_property_sets", "frontmatter_remove", "conditions"].some((key) => Object.hasOwn(local, key)) || defaults.length;
      if (usesReuse && !input.enabled) {
        mark(name, { kind: "unavailable", path: pathOf(name), message: `${name} requires Reuse`, extension: "typedmark:reuse" }); break;
      }
      if (!String(local.specification_version).startsWith("0.1.")) {
        unavailable(name, { path: pathOf(name), version: String(local.specification_version) }); break;
      }
      if (local.extends === undefined) break;
      const parent = input.schemas.get(local.extends);
      if (result.issues.get(local.extends)?.kind === "unavailable") {
        mark(name, result.issues.get(local.extends)!); break;
      }
      if (!parent || parent.abstract !== true) {
        problem(name, "NTS-36", `Parent ${local.extends} does not resolve to an abstract schema`); break;
      }
      name = local.extends;
    }
    for (const member of pending.reverse()) compose(member);
  }
  return result;
}
