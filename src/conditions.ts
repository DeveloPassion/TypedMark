import { equalFieldValues, fullPattern, type ValueFailure } from "./field-values";

type Data = Record<string, any>;
export interface ConditionFailure extends ValueFailure { code: string; field: string }

export function validateConditions(conditions: Data[], fields: Data): ValueFailure[] {
  const failures: ValueFailure[] = [];
  for (const condition of conditions) {
    const references = [...Object.keys(condition.when), ...(condition.then.require ?? []), ...(condition.then.require_null ?? [])];
    for (const field of new Set(references)) if (!Object.hasOwn(fields, field)) failures.push({ rule: "NTS-87", message: `Condition field ${field} is undeclared` });
    for (const predicate of Object.values(condition.when) as Data[]) if (predicate.regex !== undefined) {
      try { fullPattern(predicate.regex); } catch { failures.push({ rule: "FND-31", message: "Invalid condition regular expression" }); }
    }
  }
  return failures;
}

function matches(when: Data, stored: Data, values: Data): boolean {
  return Object.entries(when).every(([field, predicate]) => {
    const value = values[field];
    if (predicate.exists !== undefined && Object.hasOwn(stored, field) !== predicate.exists) return false;
    if (Object.hasOwn(predicate, "equals") && !equalFieldValues(value, predicate.equals, { type: "any" }, "UTC")) return false;
    if (predicate.regex !== undefined && (typeof value !== "string" || !fullPattern(predicate.regex).test(value.normalize("NFC")))) return false;
    for (const key of ["contains_any", "contains_all"]) if (predicate[key]) {
      if (!Array.isArray(value) || !value.every((entry) => typeof entry === "string")) return false;
      const found = (predicate[key] as string[]).map((entry) => value.some((item) => item.normalize("NFC") === entry.normalize("NFC")));
      if (key === "contains_any" ? !found.some(Boolean) : !found.every(Boolean)) return false;
    }
    return true;
  });
}

export function conditionFailures(conditions: Data[], stored: Data, values: Data): ConditionFailure[] {
  const failures: ConditionFailure[] = [];
  const required = new Set<string>();
  const empty = new Set<string>();
  for (const condition of conditions) {
    if (!matches(condition.when, stored, values)) continue;
    for (const field of condition.then.require ?? []) {
      required.add(field);
      if (values[field] === null || values[field] === undefined) failures.push({ rule: "NTS-90", code: "missing_required_field", field, message: `${field} requires a non-null effective value` });
    }
    for (const field of condition.then.require_null ?? []) {
      empty.add(field);
      if (values[field] !== null) failures.push({ rule: "NTS-90", code: "invalid_field_value", field, message: `${field} requires a null effective value` });
    }
  }
  for (const field of required) if (empty.has(field)) failures.push({ rule: "NTS-92", code: "invalid_field_value", field, message: `${field} has conflicting matching conditions` });
  return failures;
}
