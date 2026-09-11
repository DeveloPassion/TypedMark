import { noteFieldDefinitions, type CollectionModel } from "./collection-model";
import { equalFieldValues, expandObjectDefaults, fullPattern, validateFieldValue, type ValueFailure } from "./field-values";
import { requireSchemaModel } from "./query-engine";
import { isExcluded } from "./paths";
import { posix } from "node:path";

type Data = Record<string, any>;
export interface AutomationFailure extends ValueFailure { field?: string; note_type?: string }

function storageAccepts(path: string, storage: Data): boolean {
  const name = `${storage.note_name_prefix?.pattern ?? ""}${storage.note_name_pattern}${storage.note_name_suffix?.pattern ?? ""}`;
  // Decomposition also handles normalization across a literal/placeholder boundary.
  const pattern = `${storage.folder_pattern ? `${storage.folder_pattern}/` : ""}${name}.md`.normalize("NFD");
  const formats: Record<string, string> = { YYYY: "[0-9]{4}", GGGG: "[0-9]{4}", MM: "(?:0[1-9]|1[0-2])", DD: "(?:0[1-9]|[12][0-9]|3[01])", Q: "[1-4]", WW: "(?:0[1-9]|[1-4][0-9]|5[0-3])", "YYYY-MM": "[0-9]{4}-(?:0[1-9]|1[0-2])", "YYYY-MM-DD": "[0-9]{4}-(?:0[1-9]|1[0-2])-(?:0[1-9]|[12][0-9]|3[01])" };
  const escape = (text: string) => text.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  let escaped = ""; let cursor = 0;
  for (const match of pattern.matchAll(/\{[a-z][a-z0-9_]*(?::([^}]+))?\}/gu)) {
    escaped += escape(pattern.slice(cursor, match.index));
    if (match[1] && !Object.hasOwn(formats, match[1])) return false;
    escaped += match[1] ? formats[match[1]] : "[^/\\\\\\p{Cc}]*";
    cursor = match.index + match[0].length;
  }
  escaped += escape(pattern.slice(cursor));
  return fullPattern(escaped).test(path.normalize("NFD"));
}

/** Artifact validation only: actions are never executed and no future values are invented. */
export function validateAutomationRule(automation: Data, model: CollectionModel): AutomationFailure[] {
  const failures: AutomationFailure[] = [];
  const fail = (rule: string, message: string, context: Partial<AutomationFailure> = {}) => failures.push({ rule, message, ...context });
  const targetless = automation.trigger.kind === "schedule" && !automation.scope && !automation.when;
  const types: string[] = targetless ? [] : automation.scope?.note_types ?? [...model.schemas].filter(([, schema]) => !schema.abstract).map(([name]) => name);
  for (const type of types) {
    const schema = model.schemas.get(type);
    if (!schema || schema.abstract) fail("CM-253", `Scope type ${type} does not resolve to a concrete schema`);
    else requireSchemaModel(model, type);
  }
  if (failures.length) return failures;
  for (const regex of [automation.scope?.path?.regex, ...Object.values(automation.when ?? {}).map((predicate) => (predicate as Data).regex)]) if (regex !== undefined) {
    try { fullPattern(regex); } catch { fail("FND-31", "Invalid automation predicate regular expression"); }
  }
  const timezone = model.config.timezone ?? "UTC";
  const fieldsByType = new Map(types.map((type) => [type, noteFieldDefinitions(model.schemas.get(type)!)]));
  for (const [type, fields] of fieldsByType) for (const field of new Set([...Object.keys(automation.when ?? {}), ...Object.keys(automation.trigger.changed ?? {})])) {
    if (!Object.hasOwn(fields, field)) fail("CM-278", `Predicate field ${field} is undeclared for ${type}`, { field, note_type: type });
  }
  for (const action of automation.actions) {
    if (action.kind === "create_note") {
      const schema = model.schemas.get(action.note_type);
      if (!schema || schema.abstract) { fail("CM-274", "create_note requires a known concrete type"); continue; }
      requireSchemaModel(model, action.note_type);
      const fields = noteFieldDefinitions(schema);
      for (const [field, value] of Object.entries(action.values ?? {})) {
        const definition = Object.hasOwn(fields, field) ? fields[field] : undefined;
        const invalid = !definition || validateFieldValue(expandObjectDefaults(value, definition), definition, timezone, model.config.vocabularies);
        if (invalid || (field === "note_type" && value !== action.note_type)) fail("CM-278", `Creation value ${field} is incompatible with ${action.note_type}`, { field, note_type: action.note_type });
      }
      continue;
    }
    for (const [type, fields] of fieldsByType) {
      const schema = model.schemas.get(type)!;
      const context = { note_type: type };
      if (action.kind === "set_field") {
        const definition = Object.hasOwn(fields, action.field) ? fields[action.field] : undefined;
        if (!definition || ["id", "note_type"].includes(action.field) || definition.immutable === true || Object.hasOwn(definition, "computed") || Object.hasOwn(definition, "const_value")) {
          fail("CM-278", `Field ${action.field} is undeclared or not assignable`, { ...context, field: action.field }); continue;
        }
        const invalid = validateFieldValue(expandObjectDefaults(action.value, definition), definition, timezone, model.config.vocabularies);
        if (invalid) fail("CM-278", `Assignment to ${action.field} ${invalid.message}`, { ...context, field: action.field });
      } else if (action.kind === "add_tag" || action.kind === "remove_tag") {
        const tags = fields.tags!;
        const invalid = validateFieldValue([action.tag], { type: "tags", allowed_values: tags.allowed_values, allowed_values_from: tags.allowed_values_from }, timezone, model.config.vocabularies);
        const mandatory: unknown[] = [...(model.config.mandatory_tags ?? []), ...(schema.mandatory_tags ?? [])];
        if (invalid || (action.kind === "remove_tag" && mandatory.some((tag) => equalFieldValues(tag, action.tag, { type: "text" }, timezone)))) fail("CM-278", "Tag action violates the target tag policy", { ...context, field: "tags" });
      } else if (action.kind === "move_note") {
        const path = (action.path as string).normalize("NFC");
        const metadata = (model.config.metadata_directory ?? ".typedmark").normalize("NFC");
        const basename = posix.basename(path, ".md");
        const unsafe = !basename || basename.startsWith(".") || /[\\\p{Cc}]/u.test(path) || path.split("/").some((segment) => segment === "." || segment === ".." || segment === "");
        if (unsafe || path === "typedmark.md" || path.startsWith(`${metadata}/`) || isExcluded(path, model.config.exclude_paths ?? [".git/**"]) || ![schema.storage, schema.storage?.archive].some((storage) => storage && storageAccepts(path, storage))) fail("CM-278", "Move path is outside the target's managed storage contract", context);
      } else if (action.kind === "archive_note" || action.kind === "logical_delete_note") {
        const field = action.kind === "archive_note" ? "archived" : "deleted";
        if (validateFieldValue(true, fields[field]!, timezone, model.config.vocabularies)) fail("CM-278", `Action violates ${field} constraints`, { ...context, field });
      }
    }
  }
  return failures;
}
