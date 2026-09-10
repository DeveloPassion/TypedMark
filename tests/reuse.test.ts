import { expect, test } from "bun:test";
import { resolveSchemas } from "../src/reuse";

const version = { specification_version: "0.1.0", description: "Schema." };
const storage = { folder_pattern: "Notes", note_name_pattern: "{title}" };
const resolve = (schemas: Record<string, object>, sets: Record<string, object> = {}, config = {}) => resolveSchemas({
  schemas: new Map(Object.entries(schemas).map(([name, schema]) => [name, { ...version, ...schema }])),
  propertySets: new Map(Object.entries(sets).map(([name, schema]) => [name, { ...version, property_set: name, ...schema }])),
  config, metadataDirectory: ".typedmark", enabled: true,
});

test("composes defaults, ancestors, removal, opt-ins, then local fields by full replacement", () => {
  const result = resolve({
    base: { abstract: true, frontmatter: { value: { type: "text", default_value: "ancestor", regex: "ancestor" }, removed: { type: "text" } } },
    note: { extends: "base", storage, property_sets: ["opt"], frontmatter_remove: ["removed"], frontmatter: { value: { type: "text", nullable: true } } },
  }, {
    defaults: { frontmatter: { value: { type: "text", default_value: "default" }, shared: { type: "integer", default_value: 1 } } },
    opt: { frontmatter: { value: { type: "text", default_value: "opt" }, removed: { type: "integer", default_value: 2 } } },
  }, { default_property_sets: ["defaults"] });
  expect(result.results).toEqual([]);
  expect(result.schemas.get("note")?.frontmatter).toEqual({
    value: { type: "text", nullable: true }, shared: { type: "integer", default_value: 1 }, removed: { type: "integer", default_value: 2 },
  });
  expect(result.schemas.get("note")).toMatchObject({ note_type: "note", abstract: false, label: "note", description: "Schema." });
});

test("uses whole-key metadata replacement and merges relationship targets and heading members", () => {
  const result = resolve({
    base: { abstract: true, storage: { ...storage, archive: storage }, mandatory_tags: ["base"], count: { min: 1, max: 5 },
      headings: { required_h2: ["Base"], allow_other_h2: false }, relationships: { belongs_to: { allowed_note_types: { area: { min: 1, max: 2 } } } } },
    note: { extends: "base", storage, mandatory_tags: ["local"], count: { max: 3 }, headings: { required_h2: ["Local"] },
      relationships: { belongs_to: { allowed_note_types: { area: { max: 4 } } } } },
    area: { storage },
  });
  expect(result.results).toEqual([]);
  expect(result.schemas.get("note")).toMatchObject({ storage, mandatory_tags: ["local"], count: { max: 3 },
    headings: { required_h2: ["Local"], allow_other_h2: false }, relationships: { belongs_to: { allowed_note_types: { area: { max: 4 } } } },
  });
  expect(result.schemas.get("note")?.storage.archive).toBeUndefined();
});

test("does not apply collection defaults to abstract schema layers", () => {
  const result = resolve({ base: { abstract: true }, note: { extends: "base", storage, exclude_property_sets: ["shared"] } },
    { shared: { frontmatter: { value: { type: "text" } } } }, { default_property_sets: ["shared"] });
  expect(result.schemas.get("base")?.frontmatter).toEqual({});
  expect(result.schemas.get("note")?.frontmatter).toEqual({});
});

test.each([
  [{ note: { extends: "missing", storage } }, {}, {}, "NTS-36"],
  [{ base: { storage }, note: { extends: "base", storage } }, {}, {}, "NTS-36"],
  [{ a: { abstract: true, extends: "b" }, b: { abstract: true, extends: "a" } }, {}, {}, "NTS-37"],
  [{ note: { storage, property_sets: ["missing"] } }, {}, {}, "CM-165"],
  [{ note: { storage, exclude_property_sets: ["shared"] } }, { shared: { frontmatter: {} } }, {}, "CM-166"],
  [{ note: { storage, property_sets: ["shared"] } }, { shared: { frontmatter: {} } }, { default_property_sets: ["shared"] }, "CM-167"],
  [{ note: { storage, frontmatter_remove: ["missing"] } }, {}, {}, "CM-171"],
  [{ base: { abstract: true }, note: { extends: "base" } }, {}, {}, "NTS-23"],
] as const)("rejects invalid reuse references and effective contracts: %j", (schemas, sets, config, rule) => {
  expect(resolve(schemas, sets, config).results).toContainEqual(expect.objectContaining({ rule_id: rule }));
});

test("leaves source artifacts unchanged", () => {
  const schemas = { base: { abstract: true, frontmatter: { value: { type: "text" } } }, note: { extends: "base", storage } };
  const before = structuredClone(schemas);
  resolve(schemas);
  expect(schemas).toEqual(before);
});

test("failed and disabled outputs cannot mutate caller-owned sources", () => {
  for (const enabled of [false, true]) {
    const schemas = new Map([["note", { ...version, storage, extends: "missing" }]]);
    const result = resolveSchemas({ schemas, propertySets: new Map(), config: {}, metadataDirectory: ".typedmark", enabled });
    result.schemas.get("note")!.description = "changed";
    expect(schemas.get("note")!.description).toBe("Schema.");
  }
});

test("default-property-set reference errors are reported once at their declaration", () => {
  const result = resolve({ a: { storage }, b: { storage } }, {}, { default_property_sets: ["missing"] });
  expect(result.results).toMatchObject([{ rule_id: "CM-137", path: "typedmark.md" }]);
  expect(result.issues.size).toBe(2);
});

test("empty type-level tag policy is materialized after composition", () => {
  expect(resolve({ note: { storage } }).schemas.get("note")?.mandatory_tags).toEqual([]);
});

test("deep ancestry is composed iteratively with bounded completeness metadata", () => {
  const schemas: Record<string, object> = {};
  for (let index = 5999; index >= 0; index--) schemas[`type-${index}`] = { abstract: true, specification_version: `0.1.${index}`, ...(index ? { extends: `type-${index - 1}` } : {}) };
  schemas.note = { extends: "type-5999", storage };
  const result = resolve(schemas);
  expect(result.results).toEqual([]);
  expect(result.schemas.size).toBe(6001);
  expect(result.sources.get("note")).toHaveLength(1);
});

test("known unavailable property sets are not reclassified as missing references", () => {
  const issue = { kind: "unavailable" as const, path: ".typedmark/property-sets/shared.md", specificationVersion: "0.2.0", message: "Unsupported version" };
  const result = resolveSchemas({ schemas: new Map([
    ["note", { ...version, storage }], ["excluded", { ...version, storage, exclude_property_sets: ["shared"] }],
  ]), propertySets: new Map(), propertySetIssues: new Map([["shared", issue]]), config: { default_property_sets: ["shared"] }, metadataDirectory: ".typedmark", enabled: true });
  expect(result.results).toEqual([]);
  expect(result.issues.get("note")).toEqual(issue);
  expect(result.issues.has("excluded")).toBe(false);
});
