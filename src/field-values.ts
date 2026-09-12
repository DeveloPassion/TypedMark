import { Temporal } from "@js-temporal/polyfill";
import { parseNoteLink } from "./note-links";

export type FieldType = "text" | "integer" | "number" | "checkbox" | "date" | "time" | "datetime" | "link" | "list" | "tags" | "object" | "any";
export interface FieldDefinition {
  type: FieldType;
  nullable?: boolean;
  items?: FieldDefinition;
  fields?: Record<string, FieldDefinition>;
  format?: string;
  min?: number | string;
  max?: number | string;
  regex?: string;
  not_blank?: boolean;
  not_empty?: boolean;
  allowed_values?: unknown[];
  allowed_values_from?: string;
  const_value?: unknown;
  default_value?: unknown;
  generated?: false | string | { random: number } | { sequence: { start?: number; scope?: "note_type" | "collection" } };
  computed?: string;
  immutable?: boolean;
  unique?: boolean | "collection";
  relationship_kind?: "belongs_to" | "related_to";
  targets?: string[];
  validate_exists?: boolean;
}
export type Vocabularies = Record<string, { values: string[] }>;
export type ConversionClass = "exact" | "lossless" | "conditional" | "incompatible";
export interface ValueFailure { rule: string; message: string }

export function expandObjectDefaults(value: unknown, definition: FieldDefinition): unknown {
  if (value === null || typeof value !== "object") return value;
  if (Array.isArray(value)) return definition.type === "list" && definition.items
    ? value.map((item) => expandObjectDefaults(item, definition.items!)) : value;
  if (definition.type !== "object") return value;
  const result = { ...value } as Record<string, unknown>;
  for (const [name, child] of Object.entries(definition.fields ?? {})) {
    if (!Object.hasOwn(result, name)) {
      if (Object.hasOwn(child, "default_value")) result[name] = child.default_value;
      else if (child.nullable) result[name] = null;
    }
    if (Object.hasOwn(result, name)) result[name] = expandObjectDefaults(result[name], child);
  }
  return result;
}

export function fullPattern(pattern: string): RegExp {
  // Validate the authored pattern before adding anchors: a wrapper can otherwise
  // accidentally close an unterminated character class.
  new RegExp(pattern, "u");
  return new RegExp(`^(?:${pattern})(?![\\s\\S])`, "u");
}

export function datetimeInstant(value: string, timezone: string): Temporal.Instant {
  return /(?:Z|[+-]\d{2}:\d{2})$/.test(value)
    ? Temporal.Instant.from(value)
    : Temporal.PlainDateTime.from(value).toZonedDateTime(timezone, { disambiguation: "reject" }).toInstant();
}

export function comparisonDomain(definition: FieldDefinition): string | undefined {
  if (["text", "link"].includes(definition.type)) return "string";
  if (["integer", "number"].includes(definition.type)) return "number";
  if (["checkbox", "date", "time", "datetime"].includes(definition.type)) return definition.type;
}

export function compareFieldValues(left: unknown, right: unknown, definition: FieldDefinition, timezone: string): number {
  if (definition.type === "date") return Temporal.PlainDate.compare(String(left), String(right));
  if (definition.type === "time") return Temporal.PlainTime.compare(String(left), String(right));
  if (definition.type === "datetime") return Temporal.Instant.compare(datetimeInstant(String(left), timezone), datetimeInstant(String(right), timezone));
  if (definition.type === "text" || definition.type === "link") {
    const a = [...String(left).normalize("NFC")];
    const b = [...String(right).normalize("NFC")];
    for (let i = 0; i < Math.min(a.length, b.length); i++) {
      const difference = a[i]!.codePointAt(0)! - b[i]!.codePointAt(0)!;
      if (difference) return difference;
    }
    return a.length - b.length;
  }
  if (["integer", "number", "checkbox"].includes(definition.type)) return Number(left) - Number(right);
  throw new Error(`${definition.type} has no scalar comparison domain`);
}

export function equalFieldValues(left: unknown, right: unknown, definition: FieldDefinition, timezone: string): boolean {
  if (left === null || right === null || left === undefined || right === undefined) return left === right;
  if (comparisonDomain(definition)) return compareFieldValues(left, right, definition, timezone) === 0;
  if (Array.isArray(left) || Array.isArray(right)) {
    return Array.isArray(left) && Array.isArray(right) && left.length === right.length
      && left.every((value, index) => equalFieldValues(value, right[index], definition.items ?? { type: "any" }, timezone));
  }
  if (typeof left === "object" || typeof right === "object") {
    if (typeof left !== "object" || typeof right !== "object") return false;
    const a = left as Record<string, unknown>;
    const b = right as Record<string, unknown>;
    const bKeys = new Map(Object.keys(b).map((key) => [key.normalize("NFC"), key]));
    return Object.keys(a).length === Object.keys(b).length && Object.keys(a).every((key) => {
      const other = bKeys.get(key.normalize("NFC"));
      return other !== undefined && equalFieldValues(a[key], b[other], definition.fields?.[key] ?? { type: "any" }, timezone);
    });
  }
  return typeof left === "string" && typeof right === "string" ? left.normalize("NFC") === right.normalize("NFC") : left === right;
}

export function classifyConversion(source: FieldDefinition, target: FieldDefinition): ConversionClass {
  if (source.type === target.type) return "exact";
  if (target.type === "any" || (source.type === "integer" && target.type === "number")
    || (["date", "time", "datetime", "link"].includes(source.type) && target.type === "text")
    || (source.type === "tags" && target.type === "list" && target.items?.type === "text")) return "lossless";
  if (source.type === "any" || (source.type === "number" && target.type === "integer")
    || (source.type === "text" && ["link", "date", "time", "datetime"].includes(target.type))
    || (source.type === "list" && source.items?.type === "text" && target.type === "tags")) return "conditional";
  return "incompatible";
}

export function validateFieldValue(value: unknown, definition: FieldDefinition, timezone: string, vocabularies: Vocabularies = {}): ValueFailure | undefined {
  const fail = (rule: string, message: string): ValueFailure => ({ rule, message });
  if (value === null) return definition.nullable === true ? undefined : fail("MN-99", "is not nullable");
  const type = definition.type;
  const rules: Record<FieldType, string> = { text: "FDR-8", integer: "FDR-9", number: "FDR-11", checkbox: "FDR-12", date: "FDR-13", time: "FDR-14", datetime: "FDR-15", link: "FDR-19", list: "FDR-20", tags: "FDR-21", object: "FDR-28", any: "FDR-29" };
  let valid: boolean;
  switch (type) {
    case "text": case "link": valid = typeof value === "string"; break;
    case "integer": valid = typeof value === "number" && Number.isInteger(value); break;
    case "number": valid = typeof value === "number" && Number.isFinite(value); break;
    case "checkbox": valid = typeof value === "boolean"; break;
    case "list": valid = Array.isArray(value); break;
    case "tags": valid = Array.isArray(value) && value.every((tag) => typeof tag === "string" && fullPattern("[\\p{L}\\p{N}_][\\p{L}\\p{N}_-]*(?:/[\\p{L}\\p{N}_][\\p{L}\\p{N}_-]*)*").test(tag.normalize("NFC")))
      && new Set(value.map((tag: string) => tag.normalize("NFC"))).size === value.length; break;
    case "object": valid = typeof value === "object" && !Array.isArray(value); break;
    case "date": case "time": case "datetime": {
      valid = typeof value === "string";
      try {
        if (type === "date") valid = valid && fullPattern("\\d{4}-\\d{2}-\\d{2}").test(String(value)) && Temporal.PlainDate.from(String(value)).toString() === value;
        else if (type === "datetime") {
          valid = valid && fullPattern("\\d{4}-\\d{2}-\\d{2}T\\d{2}:\\d{2}(?::\\d{2}(?:\\.\\d+)?)?(?:Z|[+-]\\d{2}:\\d{2})?").test(String(value));
          datetimeInstant(String(value), timezone);
        } else {
          const patterns: Record<string, string> = { "hh:mm": "(?:[01]\\d|2[0-3]):[0-5]\\d", "hh:mm:ss": "(?:[01]\\d|2[0-3]):[0-5]\\d:[0-5]\\d", "hh:mm:ss.sss": "(?:[01]\\d|2[0-3]):[0-5]\\d:[0-5]\\d\\.\\d{3}" };
          valid = valid && !!patterns[definition.format ?? ""] && fullPattern(patterns[definition.format ?? ""]!).test(String(value));
        }
      } catch { valid = false; }
      break;
    }
    case "any": valid = value !== undefined; break;
    default: return fail("FDR-7", "has an unknown type");
  }
  if (!valid) return fail(rules[type], `must satisfy the ${type} value contract`);
  if (type === "list" && definition.items) {
    for (const item of value as unknown[]) {
      const failure = validateFieldValue(item, definition.items, timezone, vocabularies);
      if (failure) return failure;
    }
  }
  if (type === "object") {
    for (const [name, child] of Object.entries(definition.fields ?? {})) {
      const object = value as Record<string, unknown>;
      const effective = Object.hasOwn(object, name) ? object[name]
        : Object.hasOwn(child, "default_value") ? child.default_value : child.nullable ? null : undefined;
      if (effective === undefined) return fail("MN-98", `has no conforming value for ${name}`);
      const failure = validateFieldValue(effective, child, timezone, vocabularies);
      if (failure) return failure;
    }
    if (definition.not_empty && Object.keys(value as object).length === 0) return fail("FDR-171", "must not be empty");
  }
  if (definition.not_blank && !/\S/u.test(String(value))) return fail("FDR-176", "must not be blank");
  if (definition.format === "slug" && !fullPattern("[a-z0-9]+(?:-[a-z0-9]+)*").test(String(value))) return fail("FDR-139", "must use slug format");
  if (definition.format === "uri") {
    try { if (!/^[a-z][a-z0-9+.-]*:/i.test(String(value)) || /[\s<>]/u.test(String(value))) throw new Error(); new URL(String(value)); }
    catch { return fail("FDR-140", "must be an absolute URI"); }
  }
  if (definition.format === "note_link") {
    const link = parseNoteLink(String(value));
    if (!link || link.embed) return fail("FDR-142", "must be one non-embed internal note link");
  }
  if (definition.regex && !fullPattern(definition.regex).test(String(value).normalize("NFC"))) return fail("FDR-181", "does not match the declared regular expression");
  const measured = type === "text" || type === "link" ? [...String(value).normalize("NFC")].length : Array.isArray(value) ? value.length : value;
  const temporal = ["date", "time", "datetime"].includes(type);
  if (definition.min !== undefined && (temporal ? compareFieldValues(value, definition.min, definition, timezone) < 0 : Number(measured) < Number(definition.min))) return fail("FDR-187", "is below the minimum");
  if (definition.max !== undefined && (temporal ? compareFieldValues(value, definition.max, definition, timezone) > 0 : Number(measured) > Number(definition.max))) return fail("FDR-193", "exceeds the maximum");
  const vocabulary = definition.allowed_values_from ? vocabularies[definition.allowed_values_from]?.values : undefined;
  if (definition.allowed_values_from && !vocabulary) return fail("FDR-205", "references an unknown vocabulary");
  const allowed = definition.allowed_values ?? vocabulary;
  if (allowed) {
    const candidates = type === "list" || type === "tags" ? value as unknown[] : [value];
    if (candidates.some((candidate) => !allowed.some((entry) => type === "tags"
      ? String(candidate).normalize("NFC") === String(entry).normalize("NFC") || String(candidate).normalize("NFC").startsWith(`${String(entry).normalize("NFC")}/`)
      : equalFieldValues(candidate, entry, type === "list" ? definition.items! : definition, timezone)))) return fail("FDR-198", "is not in the allowed values");
  }
  if (Object.hasOwn(definition, "const_value") && !equalFieldValues(value, definition.const_value, definition, timezone)) return fail("FDR-213", "does not equal const_value");
}
