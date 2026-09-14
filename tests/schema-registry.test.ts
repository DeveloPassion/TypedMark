import { expect, test } from "bun:test";
import { resolve } from "node:path";
import { SchemaRegistry } from "../src/schema-registry";

const registry = new SchemaRegistry(resolve(import.meta.dir, "../../TypedMarkSpecification/schema/json-schema"));
const fragment = "defs.schema.json#/$defs/extension_requirements";

test("validates registered schema fragments using local references", () => {
  expect(registry.validate(fragment, { "example:future": "9.0.0-rc.1+build" })).toEqual([]);
  expect(registry.validate(fragment, { bad: "1.0.0" }).length).toBeGreaterThan(0);
  expect(registry.validate(fragment, { "typedmark:reuse": 17 }).length).toBeGreaterThan(0);
  expect(registry.validate(fragment, { "typedmark:reuse": "0.1.0\n" }).length).toBeGreaterThan(0);
  expect(registry.validate(fragment, {})).toEqual([]);
});

test.each(["missing.schema.json#/$defs/example", "defs.schema.json#/$defs/missing"])("rejects unknown schema reference %s", (reference) => {
  expect(() => registry.validate(reference, {})).toThrow("Unknown TypedMark schema");
});
