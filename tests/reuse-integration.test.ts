import { afterEach, expect, test } from "bun:test";
import { dirname, join, resolve } from "node:path";
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { stringify } from "yaml";
import { readCollectionModel, validateCollection } from "../src/validator";
import { evaluateQuery } from "../src/query-engine";

const schemaDirectory = resolve(import.meta.dir, "../../TypedMarkSpecification/schema/json-schema");
const roots: string[] = [];
const version = { specification_version: "0.1.0", description: "Reuse." };
const extensions = { "typedmark:reuse": "0.1.0", "typedmark:queries": "0.1.0", "typedmark:views": "0.1.0" };
const storage = { folder_pattern: "Notes", note_name_pattern: "{title}" };
const query = { specification_version: "0.1.0", note_types: ["base"], where: { kind: "field" as const, field: "status", operator: "equals", value: "ready" }, select: [{ kind: "path" as const, as: "path" }] };
function write(root: string, path: string, data: unknown, body = "") {
  mkdirSync(dirname(join(root, path)), { recursive: true });
  writeFileSync(join(root, path), `---\n${stringify(data)}---\n${body}`);
}
function collection() {
  const root = mkdtempSync(join(tmpdir(), "typedmark-reuse-")); roots.push(root);
  write(root, "typedmark.md", { ...version, name: "reuse", extensions, default_property_sets: ["shared"] });
  write(root, ".typedmark/property-sets/shared.md", { ...version, property_set: "shared", frontmatter: { status: { type: "text", default_value: "ready" } } });
  write(root, ".typedmark/schemas/base.md", { ...version, abstract: true, storage, count: { min: 1 }, headings: { required_h2: ["Notes"] },
    frontmatter: { reason: { type: "text", nullable: true } }, conditions: [{ when: { status: { equals: "ready" } }, then: { require: ["reason"] } }],
  });
  write(root, ".typedmark/schemas/note.md", { ...version, extends: "base" });
  write(root, "Notes/A.md", { note_type: "note", reason: "Prepared." }, "## Notes\n");
  return root;
}
const model = (root: string) => readCollectionModel({ collectionRoot: root, schemaDirectory });
afterEach(() => { for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true }); });

test("one effective schema supplies fields, queries, datasets, views, headings and concrete counts without writes", () => {
  const root = collection();
  write(root, ".typedmark/datasets/notes.md", { ...version, dataset: "notes", row_identity: "path", query });
  write(root, ".typedmark/views/notes.md", { ...version, view: "notes", dataset: "notes", presentation: { layout: "table", fields: [{ column: "path" }] } });
  const before = readFileSync(join(root, "Notes/A.md"));
  const loaded = model(root);
  expect(loaded.report).toMatchObject({ evaluation: "complete", valid: true, results: [], evaluated_extensions: extensions });
  expect(loaded.schemas.get("note")).toMatchObject({ note_type: "note", label: "note", abstract: false, storage });
  expect(loaded.notes[0]?.values.status).toBe("ready");
  expect(evaluateQuery(loaded, query)).toMatchObject({ evaluation: "complete", rows: [{ path: "Notes/A.md" }] });
  expect(validateCollection({ collectionRoot: root, schemaDirectory }).valid).toBe(true);
  expect(readFileSync(join(root, "Notes/A.md"))).toEqual(before);
});

test("inherited conditions preserve explicit null and invalidate query values", () => {
  const root = collection(); write(root, "Notes/A.md", { note_type: "note", reason: null }, "## Notes\n");
  const loaded = model(root);
  expect(loaded.report.results).toContainEqual(expect.objectContaining({ code: "missing_required_field", rule_id: "NTS-90", path: "Notes/A.md", field: "reason" }));
  expect(() => evaluateQuery(loaded, query)).toThrow("CM-308");
});

test("validates condition references after composition, including removed fields", () => {
  const root = collection(); write(root, ".typedmark/schemas/note.md", { ...version, extends: "base", frontmatter_remove: ["reason"] });
  expect(model(root).report.results).toContainEqual(expect.objectContaining({ code: "invalid_note_type_schema", rule_id: "NTS-87", path: ".typedmark/schemas/note.md" }));
});

test("does not interpret conditions or composition when Reuse is deliberately excluded", () => {
  const root = collection(); write(root, "Notes/A.md", { note_type: "note", reason: null });
  const loaded = readCollectionModel({ collectionRoot: root, schemaDirectory, supportedExtensions: { "typedmark:queries": "0.1.0" } });
  expect(loaded.report.evaluation).toBe("incomplete");
  expect(loaded.report.results.some((item) => item.rule_id === "NTS-90")).toBe(false);
  expect(() => evaluateQuery(loaded, query)).toThrow("requires Reuse");
});

test.each(["parent", "property-set"])("unsupported %s versions block dependent queries at the source artifact", (source) => {
  const root = collection();
  const path = source === "parent" ? ".typedmark/schemas/base.md" : ".typedmark/property-sets/shared.md";
  const data = source === "parent" ? { abstract: true, future_key: true } : { property_set: "shared", frontmatter: {}, future_key: true };
  write(root, path, { ...version, ...data, specification_version: "0.2.0" });
  const loaded = model(root);
  expect(loaded.report).toMatchObject({ evaluation: "incomplete", valid: false });
  expect(loaded.report.results).toContainEqual(expect.objectContaining({ code: "unsupported_specification_version", path }));
  expect(loaded.report.results.some((item) => item.path === path && item.code.startsWith("invalid_"))).toBe(false);
  try { evaluateQuery(loaded, { ...query, note_types: ["note"] }); throw new Error("Expected query to be unavailable"); }
  catch (error) { expect(error).toMatchObject({ unavailable: { specificationVersion: "0.2.0", path } }); }
});

test("a newer compatible property-set patch keeps dependent query evaluation incomplete", () => {
  const root = collection(); write(root, ".typedmark/property-sets/shared.md", { ...version, specification_version: "0.1.1", property_set: "shared", frontmatter: { status: { type: "text", default_value: "ready" } } });
  const loaded = model(root);
  expect(loaded.report.evaluation).toBe("incomplete");
  expect(evaluateQuery(loaded, query)).toMatchObject({ evaluation: "incomplete", rows: [{ path: "Notes/A.md" }] });
});

test("invalid inheritance cannot be queried as a valid local schema", () => {
  const root = collection(); write(root, ".typedmark/schemas/note.md", { ...version, extends: "missing", storage });
  const loaded = model(root);
  expect(loaded.report.results).toContainEqual(expect.objectContaining({ rule_id: "NTS-36" }));
  expect(() => evaluateQuery(loaded, { ...query, note_types: ["note"] })).toThrow("CM-308");
});

test("even unused property sets validate field constraints and relationship references", () => {
  const root = collection();
  write(root, ".typedmark/property-sets/invalid.md", { ...version, property_set: "invalid", frontmatter: { value: { type: "text", regex: "[" } } });
  expect(model(root).report.results).toContainEqual(expect.objectContaining({ code: "invalid_property_set", path: ".typedmark/property-sets/invalid.md", rule_id: "FND-31" }));
});

test("abstract relationship cardinality counts descendants once under the most specific declaration", () => {
  const root = collection();
  write(root, ".typedmark/schemas/person.md", { ...version, abstract: true });
  write(root, ".typedmark/schemas/customer.md", { ...version, extends: "person", storage });
  write(root, ".typedmark/schemas/member.md", { ...version, extends: "person", storage });
  write(root, ".typedmark/schemas/note.md", { ...version, extends: "base", relationships: { belongs_to: { allowed_note_types: {} }, related_to: { allowed_note_types: { person: { min: 1, max: 1 }, customer: { min: 1, max: 1 } } } } });
  write(root, "Notes/Customer.md", { note_type: "customer" });
  write(root, "Notes/Member.md", { note_type: "member" });
  write(root, "Notes/A.md", { note_type: "note", reason: "Prepared." }, "## Notes\n[[Customer]] [[Customer]] [[Member]]");
  expect(model(root).report).toMatchObject({ valid: true, results: [] });
  write(root, "Notes/Member.md", { note_type: "member", deleted: true });
  expect(model(root).report.results).toContainEqual(expect.objectContaining({ code: "invalid_relationship_instance", path: "Notes/A.md", relationship: "related_to" }));
});

test("abstract target expansion exposes overlapping relationship kinds", () => {
  const root = collection();
  write(root, ".typedmark/schemas/child.md", { ...version, extends: "base" });
  write(root, ".typedmark/schemas/note.md", { ...version, extends: "base", relationships: { belongs_to: { allowed_note_types: { base: {} } }, related_to: { allowed_note_types: { child: {} } } } });
  expect(model(root).report.results).toContainEqual(expect.objectContaining({ code: "invalid_relationship_definition", rule_id: "RHT-21", path: ".typedmark/schemas/note.md" }));
});

test("inbound relationship queries retain unavailability from an unmodeled source type", () => {
  const root = collection();
  write(root, ".typedmark/schemas/future.md", { ...version, specification_version: "0.2.0", future_key: true });
  write(root, "Notes/Future.md", { note_type: "future" }, "[[A]]");
  const loaded = model(root);
  try {
    evaluateQuery(loaded, { ...query, note_types: ["note"], where: { kind: "relationship", relationship: "related_to", direction: "inbound" } });
    throw new Error("Expected unavailable relationship model");
  } catch (error) { expect(error).toMatchObject({ unavailable: { specificationVersion: "0.2.0", path: ".typedmark/schemas/future.md" } }); }
});

test("disabled Reuse does not validate malformed extension-owned constructs", () => {
  const root = collection();
  write(root, ".typedmark/schemas/note.md", { ...version, extends: "base", conditions: "future syntax", property_sets: false });
  const loaded = readCollectionModel({ collectionRoot: root, schemaDirectory, supportedExtensions: {} });
  expect(loaded.report.evaluation).toBe("incomplete");
  expect(loaded.report.results.filter((item) => item.code === "invalid_note_type_schema")).toEqual([]);
});

test("unknown newer-patch constructs produce warnings and incomplete best-effort evaluation", () => {
  const root = collection();
  write(root, ".typedmark/property-sets/shared.md", { ...version, specification_version: "0.1.1", property_set: "shared", new_key: true, frontmatter: { status: { type: "text", default_value: "ready" } } });
  const loaded = model(root);
  expect(loaded.report.evaluation).toBe("incomplete");
  expect(loaded.report.results).toContainEqual(expect.objectContaining({ code: "unknown_field", severity: "warn", path: ".typedmark/property-sets/shared.md" }));
  expect(loaded.report.results.some((item) => item.code === "invalid_property_set")).toBe(false);
  expect(evaluateQuery(loaded, query).evaluation).toBe("incomplete");
});

test("reuse reference diagnostics respect collection severity policy", () => {
  const root = collection();
  write(root, "typedmark.md", { ...version, name: "reuse", extensions, default_property_sets: ["missing"], validation_defaults: { invalid_property_set: "warn", invalid_note_type_schema: "info" } });
  write(root, ".typedmark/schemas/note.md", { ...version, extends: "absent" });
  const results = model(root).report.results;
  expect(results).toContainEqual(expect.objectContaining({ code: "invalid_property_set", severity: "warn", rule_id: "CM-137" }));
  expect(results).toContainEqual(expect.objectContaining({ code: "invalid_note_type_schema", severity: "info", rule_id: "NTS-36" }));
});

test("malformed collection vocabularies produce a configuration finding without crashing Reuse", () => {
  const root = collection();
  write(root, "typedmark.md", { ...version, name: "reuse", extensions, vocabularies: null });
  write(root, ".typedmark/property-sets/unused.md", { ...version, property_set: "unused", frontmatter: { value: { type: "text", allowed_values_from: "missing" } } });
  expect(model(root).report.results).toContainEqual(expect.objectContaining({ code: "invalid_collection_configuration" }));
});

test("link-existence checks apply only to stored links, including property-set contributions", () => {
  const root = collection();
  write(root, ".typedmark/property-sets/shared.md", { ...version, property_set: "shared", frontmatter: { status: { type: "text", default_value: "ready" }, link: { type: "link", format: "note_link", default_value: "[[Missing]]", validate_exists: true } } });
  expect(model(root).report).toMatchObject({ valid: true, results: [] });
  write(root, "Notes/A.md", { note_type: "note", reason: "Prepared.", link: "[[Missing]]" }, "## Notes\n");
  expect(model(root).report.results).toContainEqual(expect.objectContaining({ code: "invalid_note_link", rule_id: "FDR-153", field: "link" }));
});

test("a stored link outside inherited field targets is a field-value failure", () => {
  const root = collection();
  write(root, ".typedmark/schemas/person.md", { ...version, storage });
  write(root, ".typedmark/schemas/note.md", { ...version, extends: "base", frontmatter: { link: { type: "link", format: "note_link", targets: ["person"] } } });
  write(root, "Notes/A.md", { note_type: "note", reason: "Prepared.", link: "[[Notes/A]]" }, "## Notes\n");
  expect(model(root).report.results).toContainEqual(expect.objectContaining({ code: "invalid_field_value", rule_id: "FDR-160", field: "link", path: "Notes/A.md" }));
});

test.each([true, false])("collection-level Reuse syntax is not interpreted when unavailable: declared=%j", (declared) => {
  const root = collection();
  write(root, "typedmark.md", { ...version, name: "reuse", extensions: declared ? { "typedmark:reuse": "0.2.0" } : {}, default_property_sets: "future-syntax" });
  const loaded = model(root);
  expect(loaded.report.results.some((item) => item.code === "invalid_collection_configuration")).toBe(false);
  expect(loaded.report.results).toContainEqual(expect.objectContaining({ code: declared ? "unsupported_extension" : "invalid_extension_declaration", path: "typedmark.md" }));
});

test("ordinary link failures do not hide unsatisfied abstract relationship cardinality", () => {
  const root = collection();
  write(root, ".typedmark/schemas/person.md", { ...version, abstract: true });
  write(root, ".typedmark/schemas/note.md", { ...version, extends: "base", frontmatter: { link: { type: "link", format: "note_link", validate_exists: true, relationship_kind: "related_to" } }, relationships: { belongs_to: { allowed_note_types: {} }, related_to: { allowed_note_types: { person: { min: 1 } } } } });
  write(root, "Notes/A.md", { note_type: "note", reason: "Prepared.", link: "[[Missing]]" }, "## Notes\n");
  const results = model(root).report.results;
  expect(results).toContainEqual(expect.objectContaining({ code: "invalid_note_link", rule_id: "FDR-153" }));
  expect(results).toContainEqual(expect.objectContaining({ code: "invalid_relationship_instance", relationship: "related_to" }));
});

test.each([
  [{ specification_version: "0.1.0", property_set: "invalid" }, "invalid_property_set", "CM-146"],
  [{ ...version, property_set: "invalid", frontmatter: {}, unknown_key: true }, "unknown_field", "CM-534"],
] as const)("property-set shape findings identify the actual rule: %j", (data, code, rule) => {
  const root = collection(); write(root, ".typedmark/property-sets/invalid.md", data);
  expect(model(root).report.results).toContainEqual(expect.objectContaining({ code, severity: "error", rule_id: rule, path: ".typedmark/property-sets/invalid.md" }));
});
