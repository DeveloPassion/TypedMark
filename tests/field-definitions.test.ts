import { expect, test } from "bun:test";
import { validateFieldDefinition } from "../src/field-definitions";
import type { FieldDefinition } from "../src/field-values";

test.each([
  [{ type: "text", regex: "[" }, "FND-31"],
  [{ type: "text", allowed_values: ["é", "e\u0301"] }, "FDR-197"],
  [{ type: "text", allowed_values_from: "absent" }, "FDR-205"],
  [{ type: "integer", min: 2, max: 1 }, "FDR-195"],
  [{ type: "text", default_value: null }, "FDR-119"],
  [{ type: "integer", min: 2, default_value: 1 }, "FDR-4"],
  [{ type: "integer", const_value: "bad" }, "FDR-211"],
  [{ type: "object", fields: { child: { type: "integer", default_value: "bad" } } }, "FDR-4"],
] as Array<[FieldDefinition, string]>)("rejects an invalid field definition before materialization: %j", (definition, rule) => {
  expect(validateFieldDefinition(definition, "UTC")).toMatchObject({ rule });
});

test("validates structured defaults after recursively applying child defaults", () => {
  expect(validateFieldDefinition({ type: "object", fields: { count: { type: "integer", default_value: 1 } }, default_value: {} }, "UTC")).toBeUndefined();
});
