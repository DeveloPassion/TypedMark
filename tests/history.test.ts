import { afterEach, expect, test } from "bun:test";
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { tmpdir } from "node:os";
import { stringify } from "yaml";
import { validateCollection } from "../src/validator";
import { checkMigrationReadiness } from "../src/system";

type Data = Record<string, any>;
const roots: string[] = [];
const schemaDirectory = resolve(import.meta.dir, "../../TypedMarkSpecification/schema/json-schema");
const entries = [{ version: "0.1.0", changes: [] }, { version: "0.2.0", changes: [] }];
function write(root: string, path: string, data: unknown) {
  mkdirSync(dirname(join(root, path)), { recursive: true });
  writeFileSync(join(root, path), `---\n${stringify(data)}---\n`);
}
function system(history: Data = {}, config: Data = {}) {
  const root = mkdtempSync(join(tmpdir(), "typedmark-history-")); roots.push(root);
  write(root, "typedmark.md", { specification_version: "0.1.0", name: "history-system", description: "History.", version: "0.2.0", scaffold: {}, extensions: { "typedmark:systems": "0.1.0" }, ...config });
  write(root, ".typedmark/schemas/note.md", { specification_version: "0.1.0", description: "Note.", storage: { folder_pattern: "", note_name_pattern: "{title}" } });
  write(root, ".typedmark/history.md", { specification_version: "0.1.0", history: entries, ...history });
  return root;
}
const run = (root: string) => validateCollection({ collectionRoot: root, schemaDirectory, mode: "system_definition" });
afterEach(() => { for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true }); });

test.each(["9.0.0", "0.0.9"])("history selects its own unsupported Core compatibility line %s", (version) => {
  const root = system({ specification_version: version });
  const before = readFileSync(join(root, ".typedmark/history.md"));
  const report = run(root);
  expect(report).toMatchObject({ evaluation: "incomplete", valid: false, evaluated_extensions: {} });
  expect(report.results).toContainEqual(expect.objectContaining({ code: "unsupported_specification_version", rule_id: "FND-92", path: ".typedmark/history.md" }));
  expect(readFileSync(join(root, ".typedmark/history.md"))).toEqual(before);
});

test("compatible newer history is best-effort, not unsupported or invalid solely by version", () => {
  const report = run(system({ specification_version: "0.1.1" }));
  expect(report).toMatchObject({ evaluation: "incomplete", valid: false, evaluated_extensions: { "typedmark:systems": "0.1.0" }, results: [] });
});

test("history version incompleteness survives suppressed diagnostics", () => {
  expect(run(system({ specification_version: "9.0.0" }, { validation_defaults: { unsupported_specification_version: "off" } })))
    .toMatchObject({ evaluation: "incomplete", valid: false, results: [] });
});

test.each([
  { version: "0.1.0", severity: "error", rule: "CM-534", evaluation: "complete" },
  { version: "0.1.1", severity: "warn", rule: "FND-11", evaluation: "incomplete" },
])("unknown history structure follows the evaluated version: %j", ({ version, severity, rule, evaluation }) => {
  const report = run(system({ specification_version: version, future_key: true }, { validation_defaults: { unknown_field: "off" } }));
  expect(report.evaluation).toBe(evaluation);
  expect(report.results).toEqual([expect.objectContaining({ code: "unknown_field", severity, rule_id: rule, path: ".typedmark/history.md" })]);
});

test.each([
  { data: { specification_version: "0.1.bad" }, rule: "FND-5" },
  { data: { history: "not-a-list" }, rule: "SCE-96" },
  { data: { history: [{ version: "0.2.0" }] }, rule: "SCE-97" },
  { data: { history: [{ version: "invalid", changes: [] }] }, rule: "SCE-98" },
  { data: { history: [{ version: "0.2.0", changes: [{ op: "unknown" }] }] }, rule: "SCE-101" },
  { data: { history: [{ version: "0.2.0", changes: [{ op: { toString: "invalid" } }] }] }, rule: "SCE-101" },
  { data: { history: [{ version: "0.2.0", changes: [{ op: "add_field", field: "title", note_type: "note", property_set: "shared" }] }] }, rule: "SCE-102" },
])("history shape diagnostics identify the actual violated contract: %j", ({ data, rule }) => {
  const report = run(system(data));
  expect(report.results).toEqual([expect.objectContaining({ code: "invalid_history", rule_id: rule, path: ".typedmark/history.md" })]);
});

test("a missing release list does not also produce a last-version mismatch", () => {
  const root = system(); write(root, ".typedmark/history.md", { specification_version: "0.1.0" });
  expect(run(root).results).toEqual([expect.objectContaining({ code: "invalid_history", rule_id: "SCE-95" })]);
});

test("composition diagnostics validate local provenance without resolving sources", () => {
  const root = system({}, { composition: { sources: [
    { name: "history-system", version: "0.2.0" }, { name: "external", version: "1.0.0" }, { name: "external", version: "1.0.0" },
  ] } });
  expect(run(root).results).toEqual([
    expect.objectContaining({ code: "invalid_composition", rule_id: "CM-130", path: "typedmark.md" }),
    expect.objectContaining({ code: "invalid_composition", rule_id: "CM-131", path: "typedmark.md" }),
  ]);
});

test("readiness never approves an unevaluated history, even for a version no-op", () => {
  const root = system({ specification_version: "9.0.0" });
  for (const fromVersion of ["0.1.0", "0.2.0"]) expect(checkMigrationReadiness({ systemRoot: root, fromVersion, schemaDirectory }).status).toBe("manual_resolution_required");
});

test("valid history is not a substitute for target-aware migration impact analysis", () => {
  const root = system();
  expect(checkMigrationReadiness({ systemRoot: root, fromVersion: "0.1.0", schemaDirectory }).status).toBe("manual_resolution_required");
  expect(checkMigrationReadiness({ systemRoot: root, fromVersion: "0.2.0", schemaDirectory })).toEqual({ status: "ready", reasons: [] });
});

test("valid field-operation operands are not unknown keys from other schema branches", () => {
  expect(run(system({ history: [{ version: "0.2.0", changes: [{ op: "add_field", note_type: "note", field: "title" }] }] })))
    .toMatchObject({ valid: true, results: [] });
});

test("best-effort history retains future-operation warnings without mutating source", () => {
  const root = system({ specification_version: "0.1.1", history: [{ version: "0.2.0", changes: [{ op: "future_operation", payload: {} }] }] });
  const before = readFileSync(join(root, ".typedmark/history.md"));
  expect(run(root)).toMatchObject({ evaluation: "incomplete", valid: false,
    results: [expect.objectContaining({ code: "unknown_field", severity: "warn", rule_id: "FND-11" })] });
  expect(readFileSync(join(root, ".typedmark/history.md"))).toEqual(before);
});

test.each(["0.1.bad", "0.1.00"])("malformed history version %s cannot enable best-effort warnings", (version) => {
  const report = run(system({ specification_version: version, future_key: true }));
  expect(report.results).toContainEqual(expect.objectContaining({ code: "unknown_field", severity: "error", rule_id: "CM-534" }));
  expect(report.results.some((finding) => finding.rule_id === "FND-11")).toBe(false);
});

test("unknown operation diagnostics are specific rather than oneOf branch noise", () => {
  const report = run(system({ history: [{ version: "0.2.0", changes: [{ op: "unknown" }] }] }));
  expect(report.results[0]?.message).toContain("unknown");
  expect(report.results[0]!.message.length).toBeLessThan(250);
  expect(report.results[0]?.message).not.toContain("note_type");
});

test("malformed target configuration returns manual readiness instead of throwing", () => {
  const root = system();
  writeFileSync(join(root, "typedmark.md"), "---\nversion: [\n---\n");
  expect(checkMigrationReadiness({ systemRoot: root, fromVersion: "0.2.0", schemaDirectory }).status).toBe("manual_resolution_required");
});

test.each(["missing", "invalid-utf8"])("%s target configuration cannot appear ready", (kind) => {
  const root = system();
  if (kind === "missing") rmSync(join(root, "typedmark.md"));
  else writeFileSync(join(root, "typedmark.md"), Buffer.from([0xff]));
  expect(checkMigrationReadiness({ systemRoot: root, fromVersion: "0.2.0", schemaDirectory }).status).toBe("manual_resolution_required");
});

test("suppressed configuration failures still block readiness", () => {
  const root = system({}, { timezone: "Invalid/Zone", validation_defaults: { invalid_collection_configuration: "off" } });
  expect(checkMigrationReadiness({ systemRoot: root, fromVersion: "0.2.0", schemaDirectory }).status).toBe("manual_resolution_required");
});

test("readiness uses the NFC-resolved metadata directory inside its snapshot", () => {
  const root = system({}, { metadata_directory: "é" });
  write(root, "e\u0301/schemas/note.md", { specification_version: "0.1.0", description: "Note.", storage: { folder_pattern: "", note_name_pattern: "{title}" } });
  write(root, "e\u0301/history.md", { specification_version: "0.1.0", history: entries });
  const readiness = checkMigrationReadiness({ systemRoot: root, fromVersion: "0.1.0", schemaDirectory });
  expect(readiness.status).toBe("manual_resolution_required");
  expect(readiness.reasons[0]).toContain("impact analysis");
});

test.each(["history", "schema", "property-set", "automation"])("suppressed invalid %s artifacts cannot make a no-op ready", (artifact) => {
  const root = system({}, { extensions: { "typedmark:systems": "0.1.0", "typedmark:reuse": "0.1.0", "typedmark:automation": "0.1.0" },
    validation_defaults: { invalid_history: "off", invalid_note_type_schema: "off", invalid_property_set: "off", invalid_automation: "off" } });
  if (artifact === "history") write(root, ".typedmark/history.md", { specification_version: "0.1.0", history: [{ version: "0.2.0" }] });
  if (artifact === "schema") write(root, ".typedmark/schemas/note.md", { specification_version: "0.1.0", description: "Missing storage." });
  if (artifact === "property-set") write(root, ".typedmark/property-sets/broken.md", { specification_version: "0.1.0", description: "Invalid default.", property_set: "broken", frontmatter: { value: { type: "integer", default_value: "wrong" } } });
  if (artifact === "automation") write(root, ".typedmark/automations/broken.md", { specification_version: "0.1.0", automation: "broken", description: "Missing required trigger/actions." });
  const before = readFileSync(join(root, "typedmark.md"));
  expect(run(root).valid).toBe(true);
  expect(checkMigrationReadiness({ systemRoot: root, fromVersion: "0.2.0", schemaDirectory }).status).toBe("manual_resolution_required");
  expect(readFileSync(join(root, "typedmark.md"))).toEqual(before);
});
