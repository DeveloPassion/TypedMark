import { existsSync, lstatSync, readFileSync, readdirSync } from "node:fs";
import { basename, join } from "node:path";
import { FrontmatterError, frontmatterFailureRule, parseMarkdown } from "./frontmatter";
import { validateAutomationRule } from "./automation-rules";
import { QueryError } from "./query-engine";
import type { CollectionModel } from "./collection-model";
import type { SchemaRegistry } from "./schema-registry";
import type { ValidationResult } from "./types";

type Data = Record<string, any>;
function projectKnownStructure(data: Data, unknown: (path: string) => void) {
  const object = (value: unknown): value is Data => !!value && typeof value === "object" && !Array.isArray(value);
  const keep = (value: unknown, keys: string[], path: string) => {
    if (!object(value)) return;
    for (const key of Object.keys(value)) if (!keys.includes(key) && !(path === "" && /^x_[a-z][a-z0-9_]*(?![\s\S])/u.test(key))) { unknown(`${path}/${key}`); delete value[key]; }
  };
  keep(data, ["specification_version", "automation", "description", "priority", "trigger", "scope", "when", "actions", "failure"], "");
  if (data.trigger?.kind === "event") {
    keep(data.trigger, ["kind", "event", "changed", "scope_transition"], "/trigger");
    if (object(data.trigger.changed)) for (const [field, predicate] of Object.entries(data.trigger.changed)) keep(predicate, ["from", "to"], `/trigger/changed/${field}`);
  } else if (data.trigger?.kind === "schedule") {
    keep(data.trigger, ["kind", "schedule"], "/trigger");
    const cadence = data.trigger.schedule?.cadence;
    if (["daily", "weekly", "monthly"].includes(cadence)) keep(data.trigger.schedule, ["cadence", "at", ...(cadence === "weekly" ? ["weekday"] : cadence === "monthly" ? ["day"] : [])], "/trigger/schedule");
  }
  keep(data.scope, ["note_types", "path"], "/scope");
  keep(data.scope?.path, ["equals", "under", "regex"], "/scope/path");
  if (object(data.when)) for (const [field, predicate] of Object.entries(data.when)) keep(predicate, ["exists", "equals", "regex", "contains_any", "contains_all"], `/when/${field}`);
  const actionKeys: Record<string, string[]> = { set_field: ["field", "value"], add_tag: ["tag"], remove_tag: ["tag"], move_note: ["path"], archive_note: [], create_note: ["note_type", "values"], logical_delete_note: [], hard_delete_note: [] };
  if (Array.isArray(data.actions)) data.actions.forEach((action, index) => { if (action && Object.hasOwn(actionKeys, action.kind)) keep(action, ["kind", ...actionKeys[action.kind]!], `/actions/${index}`); });
}

export function validateAutomations(root: string, metadata: string, model: CollectionModel, registry: SchemaRegistry) {
  const results: ValidationResult[] = [];
  let incomplete = false;
  let blocked = false;
  const finding = (code: string, path: string, rule_id: string, message: string, context: Partial<ValidationResult> = {}) => {
    const severity = model.config.validation_defaults?.[code] ?? "error";
    if (severity !== "off") results.push({ code, severity, path, rule_id, message, ...context });
  };
  const directory = join(root, metadata, "automations");
  if (!existsSync(directory) || !lstatSync(directory).isDirectory()) return { results, incomplete, blocked };
  for (const entry of readdirSync(directory, { withFileTypes: true })) {
    if (!entry.isFile() || !entry.name.endsWith(".md")) continue;
    const path = `${metadata}/automations/${entry.name}`;
    if (!model.report.required_extensions["typedmark:automation"]) finding("invalid_extension_declaration", path, "EXT-16", "Automation artifact requires typedmark:automation", { extension: "typedmark:automation" });
    if (!model.report.evaluated_extensions["typedmark:automation"]) continue;
    try {
      const parsed = parseMarkdown(readFileSync(join(directory, entry.name)));
      const data = parsed.data;
      const version = data.specification_version;
      const validVersion = typeof version === "string" && /^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)(?![\s\S])/u.test(version);
      if (validVersion && version !== "0.1.0") incomplete = true;
      if (validVersion && !version.startsWith("0.1.")) {
        blocked = true; finding("unsupported_specification_version", path, "FND-92", `Unsupported automation version ${version}`); continue;
      }
      const bestEffort = validVersion && version !== "0.1.0";
      let unknown = false;
      projectKnownStructure(data, (key) => {
        results.push({ code: "unknown_field", severity: bestEffort ? "warn" : "error", path, rule_id: bestEffort ? "FND-11" : "CM-534", message: `Unknown automation key ${key}` });
        unknown = true;
      });
      const errors = registry.validate("automation.schema.json", data);
      if (!parsed.hasFrontmatter || errors.length) {
        finding("invalid_automation", path, !parsed.hasFrontmatter || errors.some((error) => error.keyword === "required" && error.instancePath === "") ? "CM-243" : "CM-279", errors.map((error) => `${error.instancePath} ${error.message}`).join("; ") || "Automation requires frontmatter"); continue;
      }
      if (data.automation !== basename(entry.name, ".md")) { finding("invalid_automation", path, "CM-242", "Automation identifier differs from its basename"); continue; }
      if (unknown && !bestEffort) continue;
      for (const failure of validateAutomationRule(data, model)) finding("invalid_automation", path, failure.rule, failure.message, { ...(failure.field ? { field: failure.field } : {}), ...(failure.note_type ? { note_type: failure.note_type } : {}) });
    } catch (error) {
      if (error instanceof QueryError && error.unavailable) {
        blocked = true; incomplete = true;
        if ("specificationVersion" in error.unavailable) {
          const source = error.unavailable.path ?? path;
          if (![...model.report.results, ...results].some((result) => result.code === "unsupported_specification_version" && result.path === source)) finding("unsupported_specification_version", source, "FND-92", error.message);
        }
      } else if (error instanceof QueryError || error instanceof FrontmatterError) finding("invalid_automation", path, frontmatterFailureRule(error, error instanceof QueryError ? "CM-278" : "CM-243"), error.message);
      else throw error;
    }
  }
  return { results, incomplete, blocked };
}
