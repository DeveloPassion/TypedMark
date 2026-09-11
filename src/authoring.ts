import { validateFieldValue, type FieldDefinition, type ValueFailure } from "./field-values";
type Data = Record<string, any>;

/** Properties owned by Authoring rather than the Core generation contract. */
export function authoringKeys(field: Data): string[] {
  const keys: string[] = [];
  if (Object.hasOwn(field, "immutable") && field.immutable !== false) keys.push("immutable");
  if (field.generated === "ulid" || (field.generated !== null && typeof field.generated === "object")) keys.push("generated");
  return keys;
}

export function hasAuthoring(fields: Data): boolean {
  const pending: unknown[] = Object.values(fields);
  while (pending.length) {
    const field = pending.pop();
    if (!field || typeof field !== "object" || Array.isArray(field)) continue;
    if (authoringKeys(field).length) return true;
    const definition = field as Data;
    if (definition.items) pending.push(definition.items);
    if (definition.fields && typeof definition.fields === "object") pending.push(...Object.values(definition.fields));
  }
  return false;
}

export function validateAuthoringFields(fields: Data, config: Data): ValueFailure[] {
  const failures: ValueFailure[] = [];
  const visit = (field: Data) => {
    const length = field.generated === "ulid" ? 26 : field.generated?.random;
    if (typeof length === "number") {
      const allowed = field.allowed_values ?? config.vocabularies?.[field.allowed_values_from]?.values;
      const compatible = (value: unknown) => typeof value === "string" && value.length === length
        && (field.generated === "ulid" ? /^[0-7][0-9abcdefghjkmnpqrstvwxyz]{25}$/.test(value) : /^[a-z0-9]+$/.test(value))
        && !validateFieldValue(value, field as FieldDefinition, config.timezone ?? "UTC", config.vocabularies);
      if (length < (field.min ?? 0) || length > (field.max ?? Infinity) || (allowed && !allowed.some(compatible))) failures.push({ rule: "FDR-65", message: "Generator output cannot satisfy the declared length or finite value constraints" });
    }
    if (field.items) visit(field.items);
    for (const child of Object.values(field.fields ?? {})) visit(child as Data);
  };
  Object.values(fields).forEach((field) => visit(field as Data));
  return failures;
}
