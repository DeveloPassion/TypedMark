import { expect, test } from "bun:test";
import { compileExpression, evaluateExpression, validateComputedFields, computedFailures } from "../src/expressions";

test("text templates preserve literals and evaluate only named text transforms", () => {
  const expression = compileExpression("${capitalize(first)} ${uppercase(last)} / ${lowercase(last)}");
  expect(evaluateExpression(expression, { first: "éMILIE", last: "STRAẞE" })).toBe("Émilie STRAẞE / straße");
  expect(evaluateExpression(compileExpression("${capitalize(value)}"), { value: "𐐨ABC" })).toBe("𐐀abc");
  expect(evaluateExpression(compileExpression("${capitalize(value)}"), { value: "" })).toBe("");
});

test("decoded escaping is single-pass and substitution text is not reparsed", () => {
  const template = "a\\\\b \\${value} ${value}";
  expect(evaluateExpression(compileExpression(template), { value: "${uppercase(secret)}" })).toBe("a\\b ${value} ${uppercase(secret)}");
});

test.each(["${", "${name", "${ name}", "${name.x}", "${uppercase(name, other)}", "${uppercase(lowercase(name))}", "${unknown(name)}", String.raw`\n`, "${Name}"])("rejects unsupported expression syntax: %j", (source) => {
  expect(() => compileExpression(source)).toThrow();
});

test("references do not read inherited object properties or coerce absent/null/non-text values", () => {
  for (const values of [{}, { value: null }, { value: 1 }, Object.create({ value: "secret" })]) expect(() => evaluateExpression(compileExpression("${value}"), values)).toThrow();
});

test("computed definitions prohibit self, computed, missing and non-text dependencies", () => {
  const fields = { first: { type: "text" }, count: { type: "integer" }, full: { type: "text", computed: "${first}" } };
  expect(validateComputedFields(fields)).toEqual([]);
  for (const dependency of ["missing", "full", "count"]) expect(validateComputedFields({ ...fields, full: { type: "text", computed: `\${${dependency}}` } })).toHaveLength(1);
});

test("computed validation compares stored values without replacing them", () => {
  const fields = { first: { type: "text" }, full: { type: "text", computed: "${uppercase(first)}" } };
  const values = { first: "a", full: "stale" };
  expect(computedFailures(fields, values, values, "UTC")).toMatchObject([{ field: "full", rule: "FDR-234" }]);
  expect(values.full).toBe("stale");
  expect(computedFailures(fields, { first: "a", full: "A" }, { first: "a", full: "A" }, "UTC")).toEqual([]);
  expect(computedFailures(fields, { first: null }, { first: null, full: null }, "UTC")).toMatchObject([{ field: "full", rule: "FDR-232" }]);
});
