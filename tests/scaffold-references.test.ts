import { afterEach, expect, test } from "bun:test";
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { tmpdir } from "node:os";
import { stringify } from "yaml";
import { SchemaRegistry } from "../src/schema-registry";
import { validateCollection } from "../src/validator";
import { checkMigrationReadiness } from "../src/system";
import type { ExtensionMap, ValidationMode } from "../src/types";

type Data = Record<string, unknown>;
const roots: string[] = [];
const schemaDirectory = resolve(import.meta.dir, "../../TypedMarkSpecification/schema/json-schema");
const registry = new SchemaRegistry(schemaDirectory);
const extensions = { "typedmark:systems": "0.1.0", "typedmark:reuse": "0.1.0" };
function write(root: string, path: string, data: Data) {
  mkdirSync(dirname(join(root, path)), { recursive: true });
  writeFileSync(join(root, path), `---\n${stringify(data)}---\n`);
}
function system(noteType: string, config: Data = {}, schema: Data = {}) {
  const root = mkdtempSync(join(tmpdir(), "typedmark-scaffold-references-")); roots.push(root);
  write(root, "typedmark.md", { specification_version: "0.1.0", name: "scaffold-system", description: "Scaffold references.", version: "1.0.0",
    scaffold: { notes: [{ path: "Starter.md", note_type: noteType }] }, extensions, ...config });
  write(root, ".typedmark/schemas/note.md", { specification_version: "0.1.0", description: "Note.", storage: { folder_pattern: "", note_name_pattern: "{title}" }, ...schema });
  write(root, ".typedmark/schemas/base.md", { specification_version: "0.1.0", description: "Base.", abstract: true });
  return root;
}
const run = (root: string, mode: ValidationMode = "system_definition", supportedExtensions?: ExtensionMap) =>
  validateCollection({ collectionRoot: root, schemaDirectory, mode, supportedExtensions });
afterEach(() => { for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true }); });

test.each(["missing", "base"])("scaffold target %s must resolve to a concrete note type", (noteType) => {
  const root = system(noteType);
  const before = readFileSync(join(root, "typedmark.md"));
  const report = run(root);
  expect(registry.validate("validation-report.schema.json", report)).toEqual([]);
  expect(report).toMatchObject({ evaluation: "complete", valid: false, evaluated_extensions: extensions });
  expect(report.results).toEqual([expect.objectContaining({ code: "invalid_system", rule_id: "SCE-17", path: "typedmark.md", note_type: noteType })]);
  expect(readFileSync(join(root, "typedmark.md"))).toEqual(before);
});

test.each(["instantiated_collection", "both"] as const)("scaffold references are checked in %s mode", (mode) => {
  expect(run(system("missing"), mode).results).toContainEqual(expect.objectContaining({ rule_id: "SCE-17" }));
});

test("scaffold references accept local and inherited concrete types", () => {
  expect(run(system("note"))).toMatchObject({ valid: true, results: [] });
  expect(run(system("note", {}, { extends: "base" }))).toMatchObject({ valid: true, results: [] });
});

test.each(["error", "warn", "info", "off"])("scaffold diagnostics honor %s without approving a strict version no-op", (severity) => {
  const root = system("missing", { validation_defaults: { invalid_system: severity } });
  const report = run(root);
  expect(report.evaluation).toBe("complete");
  expect(report.valid).toBe(severity !== "error");
  expect(report.results).toEqual(severity === "off" ? [] : [expect.objectContaining({ code: "invalid_system", rule_id: "SCE-17", severity })]);
  expect(checkMigrationReadiness({ systemRoot: root, fromVersion: "1.0.0", schemaDirectory }).status).toBe("manual_resolution_required");
});

test("unsupported target versions do not claim Systems interpretation or invent scaffold errors", () => {
  const root = system("note", { validation_defaults: { unsupported_specification_version: "off" } }, { specification_version: "9.0.0", abstract: true });
  const report = run(root);
  expect(report).toMatchObject({ evaluation: "incomplete", valid: false, results: [] });
  expect(report.evaluated_extensions).toEqual({ "typedmark:reuse": "0.1.0" });
});

test("disabled Reuse leaves scaffold target interpretation incomplete", () => {
  const root = system("note", {}, { extends: "base" });
  const report = run(root, "system_definition", { "typedmark:systems": "0.1.0" });
  expect(report.evaluation).toBe("incomplete");
  expect(report.evaluated_extensions).toEqual({});
  expect(report.results.filter((finding) => finding.code === "invalid_system")).toEqual([]);
});

test.each([
  { declared: extensions, supported: { "typedmark:reuse": "0.1.0" } },
  { declared: { ...extensions, "typedmark:systems": "9.0.0" }, supported: extensions },
  { declared: { "typedmark:reuse": "0.1.0" }, supported: extensions },
])("uninterpreted Systems does not diagnose scaffold references: %j", ({ declared, supported }) => {
  const report = run(system("missing", { extensions: declared }), "system_definition", supported);
  expect(report.results.some((finding) => finding.rule_id === "SCE-17")).toBe(false);
  expect(report.evaluated_extensions).not.toHaveProperty("typedmark:systems");
});

test.each([{}, { notes: [] }, { folders: ["Notes"] }])("empty scaffold has no target model dependency: %j", (scaffold) => {
  const report = run(system("note", { scaffold }), "system_definition", { "typedmark:systems": "0.1.0" });
  expect(report.evaluated_extensions).toEqual({ "typedmark:systems": "0.1.0" });
  expect(report.results.filter((finding) => finding.code === "invalid_system")).toEqual([]);
});

test("a newer compatible concrete target remains best-effort without a scaffold error", () => {
  const report = run(system("note", {}, { specification_version: "0.1.1" }));
  expect(report).toMatchObject({ evaluation: "incomplete", valid: false, results: [] });
  expect(report.evaluated_extensions).toEqual(extensions);
});

test("unsupported history does not hide independently known scaffold failures", () => {
  const root = system("missing");
  write(root, ".typedmark/history.md", { specification_version: "9.0.0", history: [] });
  const report = run(root);
  expect(report.results).toContainEqual(expect.objectContaining({ rule_id: "SCE-17" }));
  expect(report.evaluation).toBe("incomplete");
  expect(report.evaluated_extensions).not.toHaveProperty("typedmark:systems");
});

test("invalid sibling references remain visible beside an unavailable target", () => {
  const root = system("note", { scaffold: { notes: [{ path: "Future.md", note_type: "note" }, { path: "Missing.md", note_type: "missing" }] } }, { specification_version: "9.0.0" });
  const report = run(root);
  expect(report.evaluation).toBe("incomplete");
  expect(report.results.filter((finding) => finding.rule_id === "SCE-17").map((finding) => finding.note_type)).toEqual(["missing"]);
});

test("unavailable property-set dependencies prevent full scaffold interpretation", () => {
  const root = system("note", { default_property_sets: ["future"] });
  write(root, ".typedmark/property-sets/future.md", { specification_version: "9.0.0", property_set: "future", description: "Future fields." });
  const report = run(root);
  expect(report.evaluation).toBe("incomplete");
  expect(report.evaluated_extensions).not.toHaveProperty("typedmark:systems");
  expect(report.results.some((finding) => finding.rule_id === "SCE-17")).toBe(false);
});

test("known invalid schemas retain their own diagnostic instead of becoming missing types", () => {
  const report = run(system("note", {}, { storage: null }));
  expect(report).toMatchObject({ evaluation: "complete", valid: false });
  expect(report.results.some((finding) => finding.code === "invalid_note_type_schema")).toBe(true);
  expect(report.results.some((finding) => finding.rule_id === "SCE-17")).toBe(false);
});
