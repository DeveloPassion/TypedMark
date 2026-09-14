import { afterEach, expect, test } from "bun:test";
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { stringify } from "yaml";
import { readCollectionModel, validateCollection } from "../src/validator";
import { queryCollection, QueryError } from "../src/query";
import { SchemaRegistry } from "../src/schema-registry";

const schemaDirectory = resolve(import.meta.dir, "../../TypedMarkSpecification/schema/json-schema");
const registry = new SchemaRegistry(schemaDirectory);
const roots: string[] = [];
function collection(config: Record<string, unknown> = {}) {
  const root = mkdtempSync(join(tmpdir(), "typedmark-root-versions-")); roots.push(root);
  mkdirSync(join(root, ".typedmark/schemas"), { recursive: true });
  writeFileSync(join(root, "typedmark.md"), `---\n${stringify({ specification_version: "0.1.0", name: "root-versions", description: "Root versions.", ...config })}---\n`);
  writeFileSync(join(root, ".typedmark/schemas/note.md"), "---\nspecification_version: 0.1.0\ndescription: Note.\nstorage: {folder_pattern: '', note_name_pattern: '{title}'}\n---\n");
  writeFileSync(join(root, "Note.md"), "---\nnote_type: note\n---\n");
  return root;
}
const run = (root: string) => validateCollection({ collectionRoot: root, schemaDirectory });
const query = (root: string) => queryCollection({ collectionRoot: root, schemaDirectory, queryVersion: "0.1.0",
  query: { specification_version: "0.1.0", select: [{ kind: "path", as: "path" }] } });
afterEach(() => { for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true }); });

test.each(["0.1.1", "0.1.9007199254740993"])("newer root %s reports the evaluated edition and remains incomplete", (version) => {
  const root = collection({ specification_version: version });
  const before = readFileSync(join(root, "typedmark.md"));
  const report = run(root);
  expect(report).toMatchObject({ specification_version: "0.1.0", evaluation: "incomplete", valid: false, results: [] });
  expect(registry.validate("validation-report.schema.json", report)).toEqual([]);
  expect(query(root)).toMatchObject({ evaluation: "incomplete", rows: [{ path: "Note.md" }] });
  expect(readFileSync(join(root, "typedmark.md"))).toEqual(before);
});

test.each(["0.0.9", "0.2.0", "9.0.0"])("unsupported root %s never claims child interpretation", (version) => {
  const root = collection({ specification_version: version, extensions: { "typedmark:reuse": "0.1.0" } });
  const report = run(root);
  expect(registry.validate("validation-report.schema.json", report)).toEqual([]);
  expect(report).toMatchObject({ specification_version: "0.1.0", evaluation: "incomplete", valid: false,
    required_extensions: { "typedmark:reuse": "0.1.0" }, evaluated_extensions: {},
    results: [expect.objectContaining({ code: "unsupported_specification_version", rule_id: "FND-92", path: "typedmark.md" })] });
});

test("unsupported root stays unavailable to queries when the finding is suppressed", () => {
  const root = collection({ specification_version: "9.0.0", validation_defaults: { unsupported_specification_version: "off" } });
  expect(run(root)).toMatchObject({ evaluation: "incomplete", valid: false, results: [] });
  let error: unknown;
  try { query(root); } catch (caught) { error = caught; }
  expect(error).toBeInstanceOf(QueryError);
  expect(error).toMatchObject({ rule_id: "CM-308", unavailable: { specificationVersion: "9.0.0", path: "typedmark.md" } });
});

test("unknown root editions are not rejected using an implemented edition's artifact shape", () => {
  const report = run(collection({ specification_version: "9.0.0", metadata_directory: { future: true } }));
  expect(report.results).toEqual([expect.objectContaining({ code: "unsupported_specification_version", rule_id: "FND-92" })]);
});

test.each(["0.1.bad", "9.bad", "0.1.00", "0.1.0\n", "0.1.0+build", null, ["0.1.1"], { toString: 0, valueOf: 0 }].map((version) => ({ version })))
  ("malformed root %j cannot become the report edition or an unsupported-version claim", ({ version }) => {
    const report = run(collection({ specification_version: version }));
    expect(report).toMatchObject({ specification_version: "0.1.0", evaluation: "complete", valid: false });
    expect(report.results).toEqual([expect.objectContaining({ code: "invalid_collection_configuration" })]);
    expect(registry.validate("validation-report.schema.json", report)).toEqual([]);
  });

test.each(["0.1.1", "9.0.0", "invalid"])("referenceEdition %s cannot claim unimplemented report semantics", (referenceEdition) => {
  expect(() => validateCollection({ collectionRoot: collection(), schemaDirectory, referenceEdition })).toThrow(RangeError);
});

test("an explicit implemented report edition does not override a newer root contract", () => {
  expect(validateCollection({ collectionRoot: collection({ specification_version: "0.1.1" }), schemaDirectory, referenceEdition: "0.1.0" }))
    .toMatchObject({ specification_version: "0.1.0", evaluation: "incomplete", valid: false });
});

test("known shape errors under a newer root remain invalid, not unsupported", () => {
  const root = collection({ specification_version: "0.1.1", metadata_directory: 17 });
  const report = run(root);
  expect(registry.validate("validation-report.schema.json", report)).toEqual([]);
  expect(report).toMatchObject({ evaluation: "incomplete", valid: false,
    results: [expect.objectContaining({ code: "invalid_collection_configuration" })] });
  let error: unknown;
  try { query(root); } catch (caught) { error = caught; }
  expect(error).toBeInstanceOf(QueryError);
  expect(error).toMatchObject({ rule_id: "CM-308", unavailable: undefined });
});

test.each(["missing", "unparseable"])("%s root configuration still emits a supported report edition", (kind) => {
  const root = collection();
  if (kind === "missing") rmSync(join(root, "typedmark.md"));
  else writeFileSync(join(root, "typedmark.md"), "---\nname: [\n---\n");
  const report = run(root);
  expect(report).toMatchObject({ specification_version: "0.1.0", valid: false });
  expect(registry.validate("validation-report.schema.json", report)).toEqual([]);
});

test.each([
  { version: "0.1.0", evaluation: "complete", severity: "error", rule: "CM-534" },
  { version: "0.1.1", evaluation: "incomplete", severity: "warn", rule: "FND-11" },
])("root structural diagnostics follow the evaluated version: %j", ({ version, evaluation, severity, rule }) => {
  const root = collection({ specification_version: version, future_key: true,
    validation_defaults: { unknown_field: "off", invalid_collection_configuration: "off" } });
  const report = run(root);
  expect(report).toMatchObject({ specification_version: "0.1.0", evaluation, valid: false,
    results: [expect.objectContaining({ code: "unknown_field", severity, rule_id: rule, path: "typedmark.md" })] });
  if (version === "0.1.1") expect(query(root)).toMatchObject({ evaluation: "incomplete", rows: [{ path: "Note.md" }] });
});

test("known mapping operands are not unknown keys from rejected schema branches", () => {
  const report = run(collection({ note_type_mappings: [{ kind: "folder", folder: 17, note_type: "note" }],
    validation_defaults: { invalid_collection_configuration: "off" } }));
  expect(report.results).toEqual([]);
});

test.each([
  { kind: "folder", folder: "Notes/", note_type: "note", future: true },
  { kind: "fixed", note_type: "note", when: { path: { equals: "Note.md", future: true } } },
])("newer known mapping branches tolerate unknown structure with warnings: %j", (mapping) => {
  const root = collection({ specification_version: "0.1.1", note_type_mappings: [mapping, { kind: "frontmatter_field", field: "note_type" }] });
  const report = run(root);
  expect(report).toMatchObject({ evaluation: "incomplete", results: [expect.objectContaining({ code: "unknown_field", severity: "warn", rule_id: "FND-11" })] });
  expect(query(root)).toMatchObject({ evaluation: "incomplete", rows: [{ path: "Note.md" }] });
});

test("best-effort projection preserves opaque values and source bytes", () => {
  const root = collection({ specification_version: "0.1.1", future_key: true, x_editor: { future_key: "opaque" },
    note_type_mappings: [{ kind: "fixed", note_type: "note", when: { frontmatter: { description: { equals: { future_key: "value" } } } } },
      { kind: "frontmatter_field", field: "note_type" }] });
  const before = readFileSync(join(root, "typedmark.md"));
  const model = readCollectionModel({ collectionRoot: root, schemaDirectory });
  expect(model.config.x_editor).toEqual({ future_key: "opaque" });
  expect(model.config.note_type_mappings[0].when.frontmatter.description.equals).toEqual({ future_key: "value" });
  expect(model.config.future_key).toBeUndefined();
  expect(readFileSync(join(root, "typedmark.md"))).toEqual(before);
});

test("best-effort projection retains capability-owned declarations for negotiation", () => {
  const report = run(collection({ specification_version: "0.1.1", future_key: true, default_property_sets: ["shared"] }));
  expect(report.results).toContainEqual(expect.objectContaining({ code: "invalid_extension_declaration", rule_id: "EXT-16", extension: "typedmark:reuse" }));
});

test("structural projection does not change aliased vendor or literal values", () => {
  const shared = { exists: true, future: "opaque" };
  const root = collection({ specification_version: "0.1.1", x_editor: shared,
    note_type_mappings: [{ kind: "fixed", note_type: "note", when: { frontmatter: {
      title: shared, description: { equals: shared },
    } } }, { kind: "frontmatter_field", field: "note_type" }] });
  const before = readFileSync(join(root, "typedmark.md"));
  const model = readCollectionModel({ collectionRoot: root, schemaDirectory });
  expect(model.config.x_editor).toEqual(shared);
  expect(model.config.note_type_mappings[0].when.frontmatter.description.equals).toEqual(shared);
  expect(model.config.note_type_mappings[0].when.frontmatter.title).toEqual({ exists: true });
  expect(readFileSync(join(root, "typedmark.md"))).toEqual(before);
});
