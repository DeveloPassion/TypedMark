import { parseBodyRegions, type RegionRange } from "./body-regions";
import { regionDigest, classifyRegion } from "./template-drift";
import type { CollectionModel, CollectionNote } from "./collection-model";
import type { ExpansionTemplate } from "./expansions";
import type { SchemaRegistry } from "./schema-registry";
import type { ValidationResult } from "./types";

type Data = Record<string, any>;
const isObject = (value: unknown): value is Data => !!value && typeof value === "object" && !Array.isArray(value);
const slug = (value: unknown): value is string => typeof value === "string" && /^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(value);

function crossingIndex(ranges: RegionRange[]) {
  const sorted = [...ranges].sort((a, b) => a.line - b.line);
  const ends: number[] = [];
  sorted.forEach((range, index) => ends.push(Math.max(range.endLine, ends[index - 1] ?? -1)));
  return (region: RegionRange) => {
    let low = 0; let high = sorted.length;
    while (low < high) { const middle = (low + high) >>> 1; if (sorted[middle]!.line < region.line) low = middle + 1; else high = middle; }
    if ((ends[low - 1] ?? -1) > region.line) return "RHT-192";
    if (sorted[low] && sorted[low]!.line < region.endLine) return "RHT-191";
  };
}

export function validateTemplateTracking(model: CollectionModel, registry: SchemaRegistry, templates: ExpansionTemplate[]) {
  const results: ValidationResult[] = [];
  let incomplete = false; let blocked = false;
  const extension = "typedmark:template-tracking";
  const enabled = !!model.report.evaluated_extensions[extension];
  const finding = (path: string, rule_id: string, message: string, id?: unknown, drift_kind?: string) => {
    const code = drift_kind ? "template_drift" : "invalid_template_region";
    const severity = model.config.validation_defaults?.[code] ?? (drift_kind ? "warn" : "error");
    if (severity !== "off") results.push({ code, severity, path, rule_id, message, ...(slug(id) ? { template_region: id } : {}), ...(drift_kind ? { drift_kind } : {}) });
  };
  const declaration = (document: CollectionNote, used: boolean) => {
    if (used && !model.report.required_extensions[extension]) {
      const severity = model.config.validation_defaults?.invalid_extension_declaration ?? "error";
      if (severity !== "off") results.push({ code: "invalid_extension_declaration", severity, path: document.path, rule_id: "EXT-16", message: "Template markers and receipts require template tracking", extension });
    }
  };
  const inspect = (document: CollectionNote, version: string, template = false) => {
    const parsed = parseBodyRegions(document.body, "template-region");
    const enrolled = Object.hasOwn(document.stored, "template_regions");
    declaration(document, parsed.used || enrolled);
    const regions = new Map<string, string>();
    const invalid = new Set(parsed.failures.flatMap((failure) => failure.id ? [failure.id] : []));
    if (!enabled) return { regions, invalid, valid: false, used: parsed.used };
    if (!String(version).startsWith("0.1.")) { if (parsed.used || enrolled) { incomplete = true; blocked = true; } return { regions, invalid, valid: false, used: parsed.used }; }
    if (version !== "0.1.0" && (parsed.used || enrolled)) incomplete = true;
    if (template && enrolled) finding(document.path, "MN-293", "Template frontmatter cannot store tracking receipts");
    // Unlocated grammar failures make the file unreliable; identified failures
    // only suppress classification for that identifier.
    let valid = !parsed.failures.some((failure) => !failure.id);
    for (const failure of parsed.failures) finding(document.path, failure.rule, failure.message, failure.id);
    const crossing = crossingIndex(parseBodyRegions(document.body, "expansion").ranges);
    for (const region of parsed.regions) {
      const descriptor = structuredClone(region.descriptor) as Data;
      if (version !== "0.1.0") for (const key of Object.keys(descriptor)) if (key !== "id") {
        results.push({ code: "unknown_field", severity: "warn", path: document.path, rule_id: "FND-11", message: `Unknown best-effort template descriptor key ${key}` });
        delete descriptor[key];
      }
      if (registry.validate("template-region.schema.json", descriptor).length) { if (slug(descriptor.id)) invalid.add(descriptor.id); else valid = false; finding(document.path, "RHT-184", "Template region descriptor must contain one slug id", descriptor.id); continue; }
      const overlap = crossing(region);
      if (overlap) { invalid.add(descriptor.id); finding(document.path, overlap, "Template regions and expansions cannot contain one another", descriptor.id); }
      regions.set(descriptor.id, regionDigest(region.region));
    }
    return { regions, invalid, valid, used: parsed.used };
  };
  const canonical = new Map<string, ReturnType<typeof inspect>>();
  const cache = new Map<string, ReturnType<typeof inspect>>();
  for (const template of templates) {
    if (template.available === false) { canonical.set(template.noteType, { regions: new Map(), invalid: new Set(), valid: false, used: false }); continue; }
    const key = `${template.path}\0${template.version}`;
    if (!cache.has(key)) cache.set(key, inspect(template, template.version, true));
    canonical.set(template.noteType, cache.get(key)!);
  }
  for (const document of model.documents) {
    const type = document.candidates?.length === 1 ? document.candidates[0] : undefined;
    const schema = type ? model.schemas.get(type) : undefined;
    const managed = schema && !schema.abstract;
    const version = managed ? schema.specification_version : model.config.specification_version;
    const note = inspect(document, version);
    const enrolled = Object.hasOwn(document.stored, "template_regions");
    if (!enabled || (!enrolled && !note.used)) continue;
    if (!managed || document.frontmatterValid === false) { finding(document.path, "CR-88", "Tracking state requires an enrolled managed note with valid frontmatter"); continue; }
    if (!enrolled) { for (const id of note.regions.keys()) finding(document.path, "RHT-211", "Region marker requires a baseline receipt", id); continue; }
    if (!note.valid) continue;
    const issue = model.schemaIssues?.get(type!);
    if (issue?.kind === "unavailable") { incomplete = true; blocked = true; continue; }
    if (issue) continue;
    const receipts = structuredClone(document.stored.template_regions);
    if (!isObject(receipts)) { finding(document.path, "MN-287", "Tracking receipts must be a mapping"); continue; }
    const invalid = new Set(note.invalid);
    for (const [id, receipt] of Object.entries(receipts)) {
      if (version !== "0.1.0" && isObject(receipt)) for (const key of Object.keys(receipt)) if (key !== "baseline" && key !== "detached") {
        results.push({ code: "unknown_field", severity: "warn", path: document.path, rule_id: "FND-11", message: `Unknown best-effort receipt key ${id}/${key}` });
        delete receipt[key];
      }
      if (!slug(id) || registry.validate("template-tracking.schema.json", { [id]: receipt }).length) { finding(document.path, "RHT-213", "Invalid tracking receipt", id); invalid.add(id); }
    }
    for (const id of note.regions.keys()) {
      if (invalid.has(id)) continue;
      const receipt = Object.hasOwn(receipts, id) ? receipts[id] : undefined;
      if (!receipt || !Object.hasOwn(receipt, "baseline")) { invalid.add(id); finding(document.path, receipt?.detached === true ? "RHT-212" : "RHT-211", "Region marker requires a baseline, not a detached or absent receipt", id); }
    }
    let template = canonical.get(type!);
    if (!template) {
      if (schema.template?.file) continue;
      template = { regions: new Map(), invalid: new Set(), valid: true, used: false };
    }
    if (!template.valid) continue;
    for (const id of new Set([...template.regions.keys(), ...note.regions.keys(), ...Object.keys(receipts)])) {
      if (invalid.has(id) || template.invalid.has(id)) continue;
      const receipt = Object.hasOwn(receipts, id) ? receipts[id] : undefined;
      if (receipt?.detached === true) continue;
      const state = classifyRegion(receipt?.baseline, note.regions.get(id), template.regions.get(id));
      if (state !== "current" && state !== "retired") finding(document.path, "RHT-217", `Tracked region is ${state}`, id, state);
    }
  }
  return { results, incomplete, blocked };
}
