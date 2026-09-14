import { expect, test } from "bun:test";
import Ajv2020 from "ajv/dist/2020";
import { readFileSync, readdirSync } from "node:fs";
import { join, resolve } from "node:path";
import { parse } from "yaml";
import { SchemaRegistry } from "../src/schema-registry";
// Test-only dependency on the pinned specification checkout; production still
// loads JSON Schemas only. This module has no runtime package dependencies.
import { shapeValue } from "../../TypedMarkSpecification/schema/shape-value";

const directory = resolve(import.meta.dir, "../../TypedMarkSpecification/schema/json-schema");
const registry = new SchemaRegistry(directory);
const ajv = new Ajv2020({ allErrors: true, strict: false, validateFormats: false });
const ids = new Map<string, string>();
for (const name of readdirSync(directory).filter((name) => name.endsWith(".schema.json"))) {
  const schema = JSON.parse(readFileSync(join(directory, name), "utf8"));
  ajv.addSchema(schema);
  ids.set(name, schema.$id);
}
const collection = { specification_version: "0.1.0", name: "parity", description: "Shape parity." };
const noteType = { specification_version: "0.1.0", description: "Shape parity.", abstract: true };

function compare(schema: string, data: unknown, valid: boolean) {
  const checker = ajv.getSchema(ids.get(schema)!)!;
  expect(checker(shapeValue(data))).toBe(valid);
  const expected = [...checker.errors ?? []];
  expect(registry.validate(schema, data)).toEqual(expected);
}

test.each(["!!set {}", "!!omap []", "!!timestamp 2026-09-15T12:00:00Z", '!!binary ""'])(
  "checker and runtime agree on structural versus opaque %s", (tagged) => {
    const value = parse(`value: ${tagged}`).value;
    for (const field of ["validation_defaults", "vocabularies"]) {
      compare("typedmark.schema.json", { ...collection, [field]: value }, false);
    }
    compare("typedmark.schema.json", { ...collection, x_vendor: value }, true);
    compare("note-type.schema.json", { ...noteType, frontmatter: value }, false);
    compare("note-type.schema.json", { ...noteType, frontmatter: { data: { type: "any", default_value: value } } }, true);
  },
);

test("both projections preserve native alias identity for uniqueness checks", () => {
  const first = new Date(0), second = new Date(1);
  for (const [values, valid] of [[[first, second], true], [[first, first], false]] as const) {
    compare("note-type.schema.json", { ...noteType, frontmatter: { data: { type: "text", allowed_values: [...values] } } }, valid);
  }
  expect(first.getTime()).toBe(0);
  expect(second.getTime()).toBe(1);
});

test("structural aliases are rejected without changing their opaque references", () => {
  const native = new Map([["tagged", 1]]);
  const opaque = Object.create(null) as Record<string, unknown>;
  opaque.self = opaque;
  opaque.native = native;
  const data = { ...collection, validation_defaults: native, x_vendor: opaque, x_alias: opaque };
  compare("typedmark.schema.json", data, false);
  expect(data.validation_defaults).toBe(native);
  expect(data.x_vendor).toBe(data.x_alias);
  expect(opaque.self).toBe(opaque);
  expect(opaque.native).toBe(native);
});

test("both projections retain own prototype keys as data", () => {
  const fields = JSON.parse('{"__proto__":{"type":"text"}}');
  compare("note-type.schema.json", { ...noteType, frontmatter: fields }, false);
  expect(Object.hasOwn(fields, "__proto__")).toBe(true);
  expect(Object.getPrototypeOf(fields)).toBe(Object.prototype);
});
