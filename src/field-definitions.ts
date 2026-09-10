import { compareFieldValues, equalFieldValues, expandObjectDefaults, fullPattern, validateFieldValue, type FieldDefinition, type ValueFailure, type Vocabularies } from "./field-values";

// Shape validation precedes this semantic pass. It is shared by schema artifacts
// and query result definitions, and does not depend on either consumer.
export function validateFieldDefinition(definition: FieldDefinition, timezone: string, vocabularies: Vocabularies = {}): ValueFailure | undefined {
  const fail = (rule: string, message: string): ValueFailure => ({ rule, message });
  if (definition.regex !== undefined) {
    try { fullPattern(definition.regex); } catch { return fail("FND-31", "Invalid field-definition regular expression"); }
  }
  if (definition.allowed_values_from && !Object.hasOwn(vocabularies, definition.allowed_values_from)) return fail("FDR-205", "Unknown vocabulary in a field definition");
  const allowed = definition.allowed_values ?? (definition.allowed_values_from ? vocabularies[definition.allowed_values_from]!.values : undefined);
  if (allowed) {
    const item = definition.type === "list" ? definition.items! : definition;
    const valueType: FieldDefinition = { type: item.type, format: item.format, nullable: item.nullable };
    for (const value of allowed) {
      const invalid = definition.type === "tags" ? validateFieldValue([value], { type: "tags" }, timezone) : validateFieldValue(value, valueType, timezone);
      if (invalid) return fail("FDR-198", "Allowed value is incompatible with the declared field type");
    }
    if (allowed.some((value, index) => allowed.slice(0, index).some((earlier) => equalFieldValues(value, earlier, definition.type === "tags" ? { type: "text" } : valueType, timezone)))) return fail("FDR-197", "Allowed values are not unique under field-value equality");
  }
  const sized = ["text", "link", "list", "tags"].includes(definition.type);
  for (const bound of ["min", "max"] as const) {
    const value = definition[bound];
    if (value !== undefined && validateFieldValue(value, sized ? { type: "integer", min: 0 } : { type: definition.type, format: definition.format }, timezone)) return fail(bound === "min" ? "FDR-187" : "FDR-193", "Field bound does not conform to its type");
  }
  if (definition.min !== undefined && definition.max !== undefined) {
    const compared = sized ? Number(definition.min) - Number(definition.max) : compareFieldValues(definition.min, definition.max, definition, timezone);
    if (compared > 0) return fail("FDR-195", "Field minimum exceeds maximum");
  }
  for (const child of [...(definition.items ? [definition.items] : []), ...Object.values(definition.fields ?? {})]) {
    const invalid = validateFieldDefinition(child, timezone, vocabularies);
    if (invalid) return invalid;
  }
  if (Object.hasOwn(definition, "const_value")) {
    const invalid = validateFieldValue(definition.const_value, { type: definition.type, format: definition.format, nullable: definition.nullable, items: definition.items, fields: definition.fields }, timezone, vocabularies);
    if (invalid) return fail("FDR-211", `Invalid constant: ${invalid.message}`);
  }
  if (Object.hasOwn(definition, "default_value")) {
    if (definition.default_value === null && !definition.nullable) return fail("FDR-119", "A null default requires nullable: true");
    const invalid = validateFieldValue(expandObjectDefaults(definition.default_value, definition), definition, timezone, vocabularies);
    if (invalid) return fail("FDR-4", `Invalid default: ${invalid.message}`);
  }
  return undefined;
}
