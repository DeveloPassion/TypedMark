import { Temporal } from "@js-temporal/polyfill";
import { datetimeInstant, validateFieldValue, type FieldDefinition, type ValueFailure } from "./field-values";

export interface StoragePatterns {
  folder_pattern: string;
  note_name_pattern: string;
  note_name_prefix?: { pattern: string };
  note_name_suffix?: { pattern: string };
}
export interface StorageDefinition extends StoragePatterns { archive?: StoragePatterns }
type Fields = Record<string, FieldDefinition>;
type Reference = { field: string; format?: string };
type Resolution = { path: string } | { failure: ValueFailure };
const formats = new Set(["YYYY", "MM", "DD", "YYYY-MM", "YYYY-MM-DD", "Q", "WW", "GGGG"]);

function reference(token: string, fields?: Fields): Reference | ValueFailure {
  const [field = "", format] = token.split(":");
  if (field.includes(".")) return { rule: "NTS-125", message: "Storage placeholders cannot traverse nested fields" };
  if (!/^[a-z][a-z0-9_]*(?::[^:{}]+)?(?![\s\S])/u.test(token)) return { rule: "NTS-117", message: "Invalid storage placeholder" };
  if (format !== undefined && !formats.has(format)) return { rule: "NTS-127", message: `Unknown storage format ${format}` };
  if (!fields) return { field, format };
  const definition = Object.hasOwn(fields, field) ? fields[field] : undefined;
  if (!definition) return { rule: "NTS-124", message: `Unknown storage field ${field}` };
  if (["list", "tags", "object", "any"].includes(definition.type)) return { rule: "NTS-132", message: `Storage field ${field} is not an eligible scalar` };
  if (format !== undefined && !["date", "datetime"].includes(definition.type)) {
    return { rule: "NTS-127", message: `Invalid storage format for ${field}` };
  }
  return { field, format };
}

function patterns(storage: StoragePatterns): string[] {
  return [storage.folder_pattern, storage.note_name_prefix?.pattern ?? "", storage.note_name_pattern, storage.note_name_suffix?.pattern ?? ""];
}

// Shape checks run first. Omit fields for an abstract contribution's intrinsic
// syntax check; resolve references against each concrete schema after composition.
// Both branches are checked even when there are no notes or archived notes.
export function validateStorageDefinition(storage: StorageDefinition, fields?: Fields): ValueFailure[] {
  const failures: ValueFailure[] = [];
  for (const branch of [storage, ...(storage.archive ? [storage.archive] : [])]) {
    for (const pattern of patterns(branch)) for (const match of pattern.matchAll(/\{([^{}]*)\}/gu)) {
      const parsed = reference(match[1]!, fields);
      if ("rule" in parsed) failures.push(parsed);
    }
  }
  return failures;
}

// Date components are ISO-calendar values, localized before extraction.
// https://tc39.es/proposal-temporal/docs/instant.html#toZonedDateTimeISO
// https://tc39.es/proposal-temporal/docs/plaindate.html#weekOfYear
function formatted(value: string, definition: FieldDefinition, format: string, timezone: string): string {
  const date = definition.type === "datetime" ? datetimeInstant(value, timezone).toZonedDateTimeISO(timezone).toPlainDate() : Temporal.PlainDate.from(value);
  switch (format) {
    case "YYYY": return String(date.year).padStart(4, "0");
    case "MM": return String(date.month).padStart(2, "0");
    case "DD": return String(date.day).padStart(2, "0");
    case "YYYY-MM": return `${String(date.year).padStart(4, "0")}-${String(date.month).padStart(2, "0")}`;
    case "YYYY-MM-DD": return date.toString();
    case "Q": return String(Math.floor((date.month - 1) / 3) + 1);
    case "WW": return String(date.weekOfYear).padStart(2, "0");
    case "GGGG": return String(date.yearOfWeek).padStart(4, "0");
    default: throw new Error("Storage format was not validated");
  }
}

export function resolveStoragePath(storage: StoragePatterns, values: Record<string, unknown>, fields: Fields, timezone: string): Resolution {
  let failure: ValueFailure | undefined;
  const resolved = patterns(storage).map((pattern) => pattern.replace(/\{([^{}]*)\}/gu, (_match, token: string) => {
    if (failure) return "";
    const parsed = reference(token, fields);
    if ("rule" in parsed) { failure = parsed; return ""; }
    const value = Object.hasOwn(values, parsed.field) ? values[parsed.field] : undefined;
    if (value === undefined || value === null) {
      failure = { rule: "NTS-130", message: `Storage field ${parsed.field} has no concrete non-null value` }; return "";
    }
    const definition = fields[parsed.field]!;
    if (!["string", "number", "boolean"].includes(typeof value)) {
      failure = { rule: "NTS-129", message: `Storage field ${parsed.field} has no scalar value` }; return "";
    }
    if (parsed.format && validateFieldValue(value, { type: definition.type }, timezone)) {
      failure = { rule: "NTS-128", message: `Cannot extract date components from ${parsed.field}` }; return "";
    }
    let text: string;
    try { text = parsed.format ? formatted(String(value), definition, parsed.format, timezone) : String(value); }
    catch (error) {
      if (!(error instanceof RangeError)) throw error;
      failure = { rule: "NTS-128", message: `Cannot extract date components for ${parsed.field} in the collection timezone` }; return "";
    }
    if (/[/\\\p{Cc}]/u.test(text) || text === "." || text === "..") {
      failure = { rule: "NTS-133", message: `Storage field ${parsed.field} contains an unsafe path value` }; return "";
    }
    return text;
  }));
  if (failure) return { failure };
  const [folder = "", prefix = "", name = "", suffix = ""] = resolved;
  const basename = `${prefix}${name}${suffix}`.normalize("NFC");
  if (!basename || basename.startsWith(".")) return { failure: { rule: "NTS-134", message: "Resolved note basename must be non-empty and must not begin with a dot" } };
  const path = `${folder ? `${folder}/` : ""}${basename}.md`.normalize("NFC");
  if (/[\\\p{Cc}]/u.test(path) || path.split("/").some((part) => part === "" || part === "." || part === "..")) {
    return { failure: { rule: "NTS-180", message: "Resolved note path contains unsafe characters or segments" } };
  }
  return { path };
}
