import { equalFieldValues, validateFieldValue, type ValueFailure, type Vocabularies } from "./field-values";

type Data = Record<string, any>;
type Transform = "uppercase" | "lowercase" | "capitalize";
export type Expression = ReadonlyArray<{ literal: string } | { reference: string; transform?: Transform }>;
export class ExpressionError extends Error {
  constructor(readonly rule: string, message: string) { super(message); }
}

/** Parse decoded text; deliberately no host-language evaluation or recursive substitution. */
export function compileExpression(source: string): Expression {
  const parts: Array<Expression[number]> = [];
  let literal = "";
  for (let index = 0; index < source.length;) {
    if (source[index] === "\\") {
      if (source[index + 1] === "\\") { literal += "\\"; index += 2; }
      else if (source.slice(index + 1, index + 3) === "${") { literal += "${"; index += 3; }
      else throw new ExpressionError("FND-63", "Unsupported expression escape");
    } else if (source.slice(index, index + 2) === "${") {
      if (literal) { parts.push({ literal }); literal = ""; }
      const end = source.indexOf("}", index + 2);
      const placeholder = end < 0 ? "" : source.slice(index + 2, end);
      const reference = /^([a-z][a-z0-9_]*)(?![\s\S])/u.exec(placeholder);
      const transformed = /^([a-z][a-z0-9_]*)\(([a-z][a-z0-9_]*)\)(?![\s\S])/u.exec(placeholder);
      if (reference) parts.push({ reference: reference[1]! });
      else if (transformed && ["uppercase", "lowercase", "capitalize"].includes(transformed[1]!)) parts.push({ reference: transformed[2]!, transform: transformed[1] as Transform });
      else throw new ExpressionError("FND-73", "Invalid placeholder or unknown transform");
      index = end + 1;
    } else { literal += source[index]; index++; }
  }
  if (literal) parts.push({ literal });
  return parts;
}

export function evaluateExpression(expression: Expression, values: Record<string, unknown>): string {
  return expression.map((part) => {
    if ("literal" in part) return part.literal;
    const value = Object.hasOwn(values, part.reference) ? values[part.reference] : undefined;
    if (typeof value !== "string") throw new ExpressionError("FND-71", `Reference ${part.reference} has no concrete text value`);
    if (part.transform === "uppercase") return value.toUpperCase();
    if (part.transform === "lowercase") return value.toLowerCase();
    if (part.transform === "capitalize") {
      const [first, ...rest] = [...value];
      return first === undefined ? "" : first.toUpperCase() + rest.join("").toLowerCase();
    }
    return value;
  }).join("");
}

export interface ComputedFailure extends ValueFailure { field: string }
export function hasComputed(fields: Data): boolean {
  const pending: unknown[] = Object.values(fields);
  while (pending.length) {
    const field = pending.pop();
    if (!field || typeof field !== "object" || Array.isArray(field)) continue;
    if (Object.hasOwn(field, "computed")) return true;
    const definition = field as Data;
    if (definition.items) pending.push(definition.items);
    if (definition.fields && typeof definition.fields === "object") pending.push(...Object.values(definition.fields));
  }
  return false;
}

export function validateComputedFields(fields: Data, checkReferences = true): ComputedFailure[] {
  const failures: ComputedFailure[] = [];
  for (const [field, definition] of Object.entries(fields)) if (Object.hasOwn(definition, "computed")) {
    try {
      for (const part of compileExpression(definition.computed)) if (checkReferences && "reference" in part) {
        const source = Object.hasOwn(fields, part.reference) ? fields[part.reference] : undefined;
        if (!source || part.reference === field || Object.hasOwn(source, "computed")) throw new ExpressionError("FDR-228", `Invalid computed dependency ${part.reference}`);
        if (source.type !== "text") throw new ExpressionError("FDR-229", `Computed dependency ${part.reference} is not text`);
      }
    } catch (error) {
      if (!(error instanceof ExpressionError)) throw error;
      failures.push({ field, rule: error.rule, message: error.message });
    }
  }
  return failures;
}

export function computedFailures(fields: Data, stored: Data, values: Data, timezone: string, vocabularies?: Vocabularies): ComputedFailure[] {
  const failures: ComputedFailure[] = [];
  for (const [field, definition] of Object.entries(fields)) if (Object.hasOwn(definition, "computed")) {
    let expected: string;
    try { expected = evaluateExpression(compileExpression(definition.computed), values); }
    catch (error) {
      if (!(error instanceof ExpressionError)) throw error;
      failures.push({ field, rule: "FDR-232", message: error.message }); continue;
    }
    if (Object.hasOwn(stored, field) && !equalFieldValues(stored[field], expected, { type: "any" }, timezone)) failures.push({ field, rule: "FDR-234", message: "Stored computed value differs from its expression" });
    const invalid = validateFieldValue(expected, definition, timezone, vocabularies);
    if (invalid) failures.push({ field, rule: "FDR-235", message: `Computed result ${invalid.message}` });
  }
  return failures;
}
