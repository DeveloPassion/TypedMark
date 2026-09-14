import { afterEach, expect, test } from "bun:test";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { stringify } from "yaml";
import { validateCollection } from "../src/validator";
import { queryCollection } from "../src/query";
import { SchemaRegistry } from "../src/schema-registry";
import { checkMigrationReadiness, instantiateSystem } from "../src/system";

const schemaDirectory = resolve(import.meta.dir, "../../TypedMarkSpecification/schema/json-schema");
const registry = new SchemaRegistry(schemaDirectory);
const roots: string[] = [];
const kept = { "example:future": "9.0.0-rc.1+build", "typedmark:reuse": "0.1.0" };
function collection(config: Record<string, unknown> = {}) {
  const root = mkdtempSync(join(tmpdir(), "typedmark-malformed-extensions-")); roots.push(root);
  mkdirSync(join(root, ".typedmark/schemas"), { recursive: true });
  writeFileSync(join(root, "typedmark.md"), `---\n${stringify({ specification_version: "0.1.0", name: "extensions", description: "Malformed declarations.", ...config })}---\n`);
  writeFileSync(join(root, ".typedmark/schemas/note.md"), "---\nspecification_version: 0.1.0\ndescription: Note.\nstorage: {folder_pattern: '', note_name_pattern: '{title}'}\n---\n");
  writeFileSync(join(root, "Note.md"), "---\nnote_type: note\n---\n");
  return root;
}
const run = (root: string) => validateCollection({ collectionRoot: root, schemaDirectory });
const query = (root: string) => queryCollection({ collectionRoot: root, schemaDirectory, queryVersion: "0.1.0",
  query: { specification_version: "0.1.0", select: [{ kind: "path", as: "path" }] } });
afterEach(() => { for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true }); });

test.each([
  ...[null, [], false, "all", 17].map((extensions) => ({ extensions, required: {}, rule: "EXT-2" })),
  ...["bad", "Example:review", "example:review\n", "__proto__"].map((id) => ({ extensions: { ...kept, [id]: "1.0.0" }, required: kept, rule: "EXT-4" })),
  ...[17, "1", "^1.0.0", "0.1.0\n", { toString: 0, valueOf: 0 }].map((version) => ({ extensions: { ...kept, "typedmark:queries": version }, required: kept, rule: "EXT-6" })),
])("malformed declaration retains only well-formed entries: %j", ({ extensions, required, rule }) => {
  const root = collection({ extensions });
  const before = readFileSync(join(root, "typedmark.md"));
  const report = run(root);
  expect(registry.validate("validation-report.schema.json", report)).toEqual([]);
  expect(report.required_extensions).toEqual(required);
  expect(report.evaluated_extensions).toEqual({});
  expect(report.evaluation).toBe("incomplete");
  expect(report.valid).toBe(false);
  expect(report.results).toEqual([expect.objectContaining({ code: "invalid_extension_declaration", rule_id: rule, path: "typedmark.md" })]);
  expect(readFileSync(join(root, "typedmark.md"))).toEqual(before);
});

test.each(["off", "error", "warn", "info"])("malformed declaration completeness survives severity %s", (severity) => {
  const root = collection({ extensions: { "typedmark:reuse": "0.1.0", "typedmark:queries": 17 },
    validation_defaults: { invalid_extension_declaration: severity, invalid_collection_configuration: "off" } });
  const report = run(root);
  expect(registry.validate("validation-report.schema.json", report)).toEqual([]);
  expect(report).toMatchObject({ evaluation: "incomplete", valid: false, required_extensions: { "typedmark:reuse": "0.1.0" }, evaluated_extensions: {} });
  expect(report.results).toEqual(severity === "off" ? [] : [expect.objectContaining({ code: "invalid_extension_declaration", severity, rule_id: "EXT-6" })]);
  expect(() => query(root)).toThrow("CM-308");
});

test.each(["!!set {typedmark:reuse: null}", "!!omap [{example:future: 9.0.0}]"])("tagged YAML declaration %s is not an empty mapping", (declaration) => {
  const root = collection();
  const path = join(root, "typedmark.md");
  const before = readFileSync(path, "utf8").replace("---\n", `---\nextensions: ${declaration}\n`);
  writeFileSync(path, before);
  const report = run(root);
  expect(registry.validate("validation-report.schema.json", report)).toEqual([]);
  expect(report).toMatchObject({ evaluation: "incomplete", valid: false, required_extensions: {}, evaluated_extensions: {} });
  expect(report.results).toEqual([expect.objectContaining({ code: "invalid_extension_declaration", rule_id: "EXT-2" })]);
  expect(readFileSync(path, "utf8")).toBe(before);
});

test.each([{}, { extensions: {} }])("absent and empty declarations stay valid: %j", (config) => {
  expect(run(collection(config))).toMatchObject({ valid: true, evaluation: "complete", required_extensions: {}, results: [] });
});

test("well-formed unsupported contracts are retained and negotiated normally", () => {
  const report = run(collection({ extensions: kept }));
  expect(report).toMatchObject({ evaluation: "incomplete", required_extensions: kept, evaluated_extensions: { "typedmark:reuse": "0.1.0" },
    results: [expect.objectContaining({ code: "unsupported_extension", extension: "example:future" })] });
});

test("unsupported Core keeps a portable requirement map without wrong-edition diagnostics", () => {
  const report = run(collection({ specification_version: "9.0.0", extensions: { ...kept, bad: "1.0.0" } }));
  expect(registry.validate("validation-report.schema.json", report)).toEqual([]);
  expect(report).toMatchObject({ evaluation: "incomplete", required_extensions: kept, evaluated_extensions: {},
    results: [expect.objectContaining({ code: "unsupported_specification_version", rule_id: "FND-92" })] });
});

test("each malformed entry has a separate declaration finding", () => {
  const report = run(collection({ extensions: { ...kept, bad: "1.0.0", "typedmark:queries": 17 } }));
  expect(report.results.map((finding) => finding.rule_id)).toEqual(["EXT-4", "EXT-6"]);
  expect(report.required_extensions).toEqual(kept);
});

test("newer compatible Core does not turn malformed requirements into unsupported versions", () => {
  const report = run(collection({ specification_version: "0.1.1", extensions: { ...kept, "typedmark:queries": 17 } }));
  expect(report).toMatchObject({ evaluation: "incomplete", required_extensions: kept,
    results: [expect.objectContaining({ code: "invalid_extension_declaration", rule_id: "EXT-6" })] });
});

test.each(["bogus", true, { toString: 0 }])("invalid diagnostic severity %j cannot corrupt the report", (severity) => {
  const report = run(collection({ extensions: { "typedmark:reuse": 17 }, validation_defaults: { invalid_extension_declaration: severity } }));
  expect(registry.validate("validation-report.schema.json", report)).toEqual([]);
  expect(report.results).toContainEqual(expect.objectContaining({ code: "invalid_extension_declaration", severity: "error" }));
});

test("malformed declarations prevent system instantiation and no-op readiness", async () => {
  const root = collection({ version: "1.0.0", scaffold: {}, extensions: { "typedmark:systems": "0.1.0", "typedmark:queries": 17 },
    validation_defaults: { invalid_extension_declaration: "off", invalid_collection_configuration: "off" } });
  const targetParent = mkdtempSync(join(tmpdir(), "typedmark-malformed-target-")); roots.push(targetParent);
  const target = join(targetParent, "instance");
  expect(checkMigrationReadiness({ systemRoot: root, fromVersion: "1.0.0", schemaDirectory }).status).toBe("manual_resolution_required");
  await expect(instantiateSystem({ sourceRoot: root, targetRoot: target, collectionName: "instance", schemaDirectory })).rejects.toThrow();
  expect(existsSync(target)).toBe(false);
});
