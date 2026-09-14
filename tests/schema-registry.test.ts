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

test.each([new Map([["required_h2", 7]]), new Set(["required_h2"]), new Date(0)])("native containers cannot satisfy a governed object shape: %j", (value) => {
  const errors = registry.validate("defs.schema.json#/$defs/headings_block", value);
  expect(errors).toContainEqual(expect.objectContaining({ keyword: "type", instancePath: "", params: { type: "object" } }));
  expect(() => JSON.stringify(errors)).not.toThrow();
});

test("shape projection preserves ordinary-object equality without calling missing prototype methods", () => {
  expect(registry.validate("defs.schema.json#/$defs/field_definition", {
    type: "text", allowed_values: [{ a: 1 }, { a: 2 }],
  })).toEqual([]); // Value compatibility is a later semantic check.
});

test("distinct native values do not become a false duplicate during shape validation", () => {
  const first = new Date(0), second = new Date(1);
  expect(registry.validate("defs.schema.json#/$defs/field_definition", {
    type: "text", allowed_values: [first, second],
  })).toEqual([]);
  expect(registry.validate("defs.schema.json#/$defs/field_definition", {
    type: "text", allowed_values: [first, first],
  }).some((error) => error.keyword === "uniqueItems")).toBe(true);
  expect(first.getTime()).toBe(0);
  expect(second.getTime()).toBe(1);
});

test("opaque cyclic values and aliases are not mutated by shape checking", () => {
  const opaque: Record<string, unknown> = Object.create(null);
  opaque.self = opaque;
  opaque.tagged = new Map([["value", 7]]);
  const value = { type: "any", default_value: opaque };
  expect(registry.validate("defs.schema.json#/$defs/field_definition", value)).toEqual([]);
  expect(value.default_value).toBe(opaque);
  expect(opaque.self).toBe(opaque);
  expect(opaque.tagged).toBeInstanceOf(Map);
  expect(Object.getPrototypeOf(opaque)).toBeNull();
});

test("an own __proto__ key cannot disappear while projecting a mapping", () => {
  const frontmatter = JSON.parse('{"__proto__":{"type":"text"}}');
  const errors = registry.validate("note-type.schema.json", {
    specification_version: "0.1.0", description: "Note.",
    storage: { folder_pattern: "", note_name_pattern: "Note" }, frontmatter,
  });
  expect(errors.length).toBeGreaterThan(0);
  expect(Object.hasOwn(frontmatter, "__proto__")).toBe(true);
  expect(Object.getPrototypeOf(frontmatter)).toBe(Object.prototype);
});

test("deep opaque metadata does not introduce a projection call-stack limit", () => {
  const opaque: Record<string, unknown> = {};
  let leaf = opaque;
  for (let index = 0; index < 20_000; index++) {
    const child: Record<string, unknown> = {};
    leaf.next = child;
    leaf = child;
  }
  const native = new Set(["retained"]);
  leaf.native = native;
  leaf.root = opaque;
  const value = { specification_version: "0.1.0", name: "deep-metadata", description: "Opaque metadata.", x_vendor: opaque };
  expect(registry.validate("typedmark.schema.json", value)).toEqual([]);
  expect(value.x_vendor).toBe(opaque);
  expect(leaf.native).toBe(native);
  expect(leaf.root).toBe(opaque);
});
