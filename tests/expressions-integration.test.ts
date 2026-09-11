import { afterEach, expect, test } from "bun:test";
import { dirname, join, resolve } from "node:path";
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { stringify } from "yaml";
import { readCollectionModel } from "../src/validator";
import { evaluateQuery } from "../src/query-engine";

const schemaDirectory = resolve(import.meta.dir, "../../TypedMarkSpecification/schema/json-schema");
const roots: string[] = [];
const version = { specification_version: "0.1.0", description: "Expressions." };
const extensions = { "typedmark:expressions": "0.1.0", "typedmark:reuse": "0.1.0", "typedmark:queries": "0.1.0" };
function write(root: string, path: string, data: unknown) {
  mkdirSync(dirname(join(root, path)), { recursive: true });
  writeFileSync(join(root, path), `---\n${stringify(data)}---\n`);
}
function collection() {
  const root = mkdtempSync(join(tmpdir(), "typedmark-expressions-")); roots.push(root);
  write(root, "typedmark.md", { ...version, name: "expressions", extensions });
  write(root, ".typedmark/property-sets/names.md", { ...version, property_set: "names", frontmatter: { first: { type: "text", default_value: "Ada" }, full: { type: "text", computed: "${first} ${last}" } } });
  write(root, ".typedmark/schemas/person.md", { ...version, property_sets: ["names"], storage: { folder_pattern: "People", note_name_pattern: "{title}" }, frontmatter: { last: { type: "text" } } });
  write(root, "People/Ada.md", { note_type: "person", last: "Lovelace", full: "Ada Lovelace" });
  return root;
}
const model = (collectionRoot: string, supportedExtensions?: Record<string, string>) => readCollectionModel({ collectionRoot, schemaDirectory, supportedExtensions });
afterEach(() => { for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true }); });

test("computed values use composed sibling defaults without writing notes and remain queryable", () => {
  const root = collection(); const before = readFileSync(join(root, "People/Ada.md"));
  const loaded = model(root);
  expect(loaded.report).toMatchObject({ evaluation: "complete", valid: true, results: [] });
  expect(evaluateQuery(loaded, { specification_version: "0.1.0", note_types: ["person"], select: [{ kind: "field", field: "full", as: "name" }] }).rows).toEqual([{ name: "Ada Lovelace" }]);
  expect(readFileSync(join(root, "People/Ada.md"))).toEqual(before);
});

test.each([["stale", "Lovelace", "FDR-234"], ["Ada Lovelace", null, "FDR-232"]])("reports invalid computed note state %j", (full, last, rule) => {
  const root = collection(); write(root, "People/Ada.md", { note_type: "person", full, last });
  const loaded = model(root);
  expect(loaded.report.results).toContainEqual(expect.objectContaining({ code: "invalid_field_value", field: "full", rule_id: rule, path: "People/Ada.md" }));
  expect(() => evaluateQuery(loaded, { specification_version: "0.1.0", note_types: ["person"], select: [{ kind: "path", as: "path" }] })).toThrow("CM-308");
});

test("reference validation uses the final composition and reports the effective schema", () => {
  const root = collection();
  write(root, ".typedmark/schemas/person.md", { ...version, property_sets: ["names"], storage: { folder_pattern: "People", note_name_pattern: "{title}" } });
  expect(model(root).report.results).toContainEqual(expect.objectContaining({ code: "invalid_note_type_schema", rule_id: "FDR-228", path: ".typedmark/schemas/person.md" }));
});

test("undeclared or disabled Expressions are never silently evaluated", () => {
  const root = collection();
  write(root, "typedmark.md", { ...version, name: "expressions", extensions: { "typedmark:reuse": "0.1.0" } });
  expect(model(root).report.results).toContainEqual(expect.objectContaining({ code: "invalid_extension_declaration", extension: "typedmark:expressions", path: ".typedmark/property-sets/names.md" }));
  write(root, "typedmark.md", { ...version, name: "expressions", extensions });
  write(root, ".typedmark/property-sets/names.md", { ...version, property_set: "names", frontmatter: { full: { type: "text", computed: { future: true } } } });
  const loaded = model(root, { "typedmark:reuse": "0.1.0" });
  expect(loaded.report.evaluation).toBe("incomplete");
  expect(loaded.report.results.some((result) => result.code === "invalid_property_set")).toBe(false);
});

test("an omitted nullable computed field is not virtual, while stored null must match", () => {
  const root = collection();
  write(root, ".typedmark/property-sets/names.md", { ...version, property_set: "names", frontmatter: { first: { type: "text", default_value: "Ada" }, full: { type: "text", computed: "${first} ${last}", nullable: true } } });
  write(root, "People/Ada.md", { note_type: "person", last: "Lovelace" });
  const loaded = model(root);
  expect(loaded.report.valid).toBe(true);
  expect(loaded.notes[0]?.values.full).toBeNull();
  expect(evaluateQuery(loaded, { specification_version: "0.1.0", note_types: ["person"], select: [{ kind: "field", field: "full", as: "name" }] }).rows).toEqual([{ name: null }]);
  write(root, "People/Ada.md", { note_type: "person", last: "Lovelace", full: null });
  expect(model(root).report.results).toContainEqual(expect.objectContaining({ rule_id: "FDR-234", field: "full" }));
});

test("disabled nested computed constructs block affected query models", () => {
  const root = collection();
  write(root, ".typedmark/schemas/person.md", { ...version, storage: { folder_pattern: "People", note_name_pattern: "{title}" }, frontmatter: { payload: { type: "object", nullable: true, fields: { nested: { type: "text", computed: { future: true }, nullable: true } } } } });
  const loaded = model(root, { "typedmark:queries": "0.1.0", "typedmark:reuse": "0.1.0" });
  expect(() => evaluateQuery(loaded, { specification_version: "0.1.0", note_types: ["person"], select: [{ kind: "path", as: "path" }] })).toThrow("requires Expressions");
});
