import type { ErrorObject } from "ajv";
import type { SchemaRegistry } from "./schema-registry";
import type { ValueFailure } from "./field-values";

type Data = Record<string, any>;
interface HistoryIssue extends ValueFailure { code: string; severity?: "error" | "warn" }
const fieldOperations = new Set(["add_field", "remove_field", "rename_field", "retype_field", "change_field"]);
const operationKeys: Record<string, string[]> = {
  ...Object.fromEntries(["add_note_type", "remove_note_type", "change_storage", "change_template", "change_headings", "change_relationships", "change_note_type"].map((op) => [op, ["note_type"]])),
  ...Object.fromEntries(["rename_note_type", "rename_property_set"].map((op) => [op, ["from", "to"]])),
  ...Object.fromEntries(["add_field", "remove_field", "change_field"].map((op) => [op, ["field", "note_type", "property_set"]])),
  rename_field: ["from", "to", "note_type", "property_set"],
  retype_field: ["field", "from_type", "to_type", "note_type", "property_set"],
  change_collection: [],
  ...Object.fromEntries(["add_property_set", "remove_property_set"].map((op) => [op, ["property_set"]])),
  ...Object.fromEntries(["add_automation", "remove_automation", "change_automation"].map((op) => [op, ["automation"]])),
  ...Object.fromEntries(["add_dataset", "remove_dataset", "change_dataset"].map((op) => [op, ["dataset"]])),
  ...Object.fromEntries(["add_view", "remove_view", "change_view"].map((op) => [op, ["view"]])),
};
const record = (value: unknown): value is Data => !!value && typeof value === "object" && !Array.isArray(value);

function shapeRule(error: ErrorObject, data: Data): string {
  if (error.instancePath === "/specification_version") return "FND-5";
  if (error.instancePath === "") return "SCE-95";
  if (error.instancePath === "/history") return "SCE-96";
  const operation = /^\/history\/(\d+)\/changes\/(\d+)/u.exec(error.instancePath);
  if (operation) {
    const change = data.history[Number(operation[1])]?.changes?.[Number(operation[2])];
    if (record(change) && fieldOperations.has(change.op) && Object.hasOwn(change, "note_type") === Object.hasOwn(change, "property_set")) return "SCE-102";
    return "SCE-101";
  }
  if (/^\/history\/\d+\/version/u.test(error.instancePath)) return "SCE-98";
  return "SCE-97";
}

function operationMessage(errors: ErrorObject[], data: Data): string {
  const paths = new Set(errors.map((error) => /^\/history\/(\d+)\/changes\/(\d+)/u.exec(error.instancePath)?.[0]).filter((path): path is string => !!path));
  return [...paths].map((path) => {
    const [, , release, , offset] = path.split("/");
    const change = data.history[Number(release)]?.changes?.[Number(offset)];
    if (!record(change) || typeof change.op !== "string") return `${path} must declare a string op with its operands`;
    if (!Object.hasOwn(operationKeys, change.op)) return `${path} uses unknown change operation ${change.op}`;
    const missing = operationKeys[change.op]!.filter((key) => !Object.hasOwn(change, key) && !(fieldOperations.has(change.op) && ["note_type", "property_set"].includes(key)));
    return missing.length ? `${path} ${change.op} is missing ${missing.join(", ")}` : `${path} ${change.op} has invalid operands`;
  }).join("; ") || "History changes must declare supported operations and their operands";
}

// Project only known structure on a clone. Inspect the actual operation kind,
// so AJV failures from unrelated oneOf branches are not mistaken for unknown keys.
export function validateHistoryShape(data: Data, registry: SchemaRegistry, bestEffort: boolean): { valid: boolean; issues: HistoryIssue[] } {
  const shape = structuredClone(data);
  const issues: HistoryIssue[] = [];
  const unknown = (path: string) => issues.push({ code: "unknown_field", severity: bestEffort ? "warn" : "error", rule: bestEffort ? "FND-11" : "CM-534", message: `Unrecognized history structure ${path}` });
  const keep = (value: Data, keys: string[], path: string, vendor = false) => {
    for (const key of Object.keys(value)) if (!keys.includes(key) && !(vendor && /^x_[a-z][a-z0-9_]*(?![\s\S])/u.test(key))) {
      unknown(`${path}/${key}`); delete value[key];
    }
  };
  keep(shape, ["specification_version", "history"], "", true);
  if (Array.isArray(shape.history)) shape.history.forEach((entry: unknown, index: number) => {
    if (!record(entry)) return;
    keep(entry, ["version", "changes"], `/history/${index}`);
    if (Array.isArray(entry.changes)) entry.changes = entry.changes.filter((change: unknown, offset: number) => {
      if (!record(change)) return true;
      const path = `/history/${index}/changes/${offset}`;
      if (typeof change.op === "string" && Object.hasOwn(operationKeys, change.op)) keep(change, ["op", ...operationKeys[change.op]!], path);
      else if (bestEffort && typeof change.op === "string") { unknown(`${path}/op`); return false; }
      return true;
    });
  });
  const errors = registry.validate("history.schema.json", shape);
  for (const rule of new Set(errors.map((error) => shapeRule(error, shape)))) {
    const relevant = errors.filter((error) => shapeRule(error, shape) === rule);
    const message = rule === "SCE-102" ? "A field history operation requires exactly one physical artifact scope"
      : rule === "SCE-101" ? operationMessage(relevant, shape)
      : relevant.map((error) => `${error.instancePath || "/"} ${error.message}`).join("; ");
    issues.push({ code: "invalid_history", rule, message });
  }
  return { valid: !errors.length && !issues.some((issue) => issue.severity === "error"), issues };
}
