import { afterEach, expect, test } from "bun:test";
import { dirname, join, resolve } from "node:path";
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { stringify } from "yaml";
import { readCollectionModel } from "../src/validator";
import { evaluateQuery } from "../src/query-engine";

const schemaDirectory = resolve(import.meta.dir, "../../TypedMarkSpecification/schema/json-schema");
const roots: string[] = [];
const version = { specification_version: "0.1.0", description: "Authoring." };
function write(root: string, path: string, data: unknown) {
  mkdirSync(dirname(join(root, path)), { recursive: true });
  writeFileSync(join(root, path), `---\n${stringify(data)}---\n`);
}
function collection(field: object, declared = true) {
  const root = mkdtempSync(join(tmpdir(), "typedmark-authoring-")); roots.push(root);
  write(root, "typedmark.md", { ...version, name: "authoring", extensions: declared ? { "typedmark:authoring": "0.1.0" } : {} });
  write(root, ".typedmark/schemas/note.md", { ...version, storage: { folder_pattern: "", note_name_pattern: "{title}" }, frontmatter: { value: field } });
  write(root, "A.md", { note_type: "note" });
  return root;
}
const model = (collectionRoot: string, supportedExtensions?: Record<string, string>) => readCollectionModel({ collectionRoot, schemaDirectory, supportedExtensions });
afterEach(() => { for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true }); });

test.each([
  { type: "text", generated: "ulid", nullable: true },
  { type: "text", generated: { random: 12 }, nullable: true },
  { type: "integer", generated: { sequence: {} }, nullable: true },
  { type: "text", immutable: true, nullable: true },
])("interprets authoring declarations without generating or overwriting values: %j", (field) => {
  const root = collection(field); const before = readFileSync(join(root, "A.md"));
  const loaded = model(root);
  expect(loaded.report).toMatchObject({ valid: true, evaluation: "complete", results: [], evaluated_extensions: { "typedmark:authoring": "0.1.0" } });
  expect(loaded.notes[0]!.values.value).toBeNull();
  expect(readFileSync(join(root, "A.md"))).toEqual(before);
});

test.each([
  { type: "integer", generated: "ulid" }, { type: "text", generated: { random: 0 } },
  { type: "text", generated: { sequence: {} } }, { type: "list", items: { type: "text", immutable: true }, nullable: true },
])("rejects incompatible authoring declarations: %j", (field) => {
  expect(model(collection(field)).report.results).toContainEqual(expect.objectContaining({ code: "invalid_note_type_schema" }));
});

test("requires explicit authoring activation and blocks unavailable nested contracts", () => {
  const field = { type: "object", nullable: true, fields: { value: { type: "text", immutable: true } } };
  const root = collection(field, false);
  expect(model(root).report.results).toContainEqual(expect.objectContaining({ code: "invalid_extension_declaration", extension: "typedmark:authoring" }));
  write(root, "typedmark.md", { ...version, name: "authoring", extensions: { "typedmark:authoring": "0.1.0" } });
  const loaded = model(root, {});
  expect(loaded.report.evaluation).toBe("incomplete");
  expect(() => evaluateQuery(loaded, { specification_version: "0.1.0", note_types: ["note"], select: [{ kind: "path", as: "path" }] })).toThrow("Authoring");
});

test("unavailable authoring syntax is not mistaken for invalid Core structure", () => {
  const root = collection({ type: "text", generated: { random: "future" }, nullable: true });
  const loaded = model(root, {});
  expect(loaded.report.evaluation).toBe("incomplete");
  expect(loaded.report.results.some((result) => result.code === "invalid_note_type_schema")).toBe(false);
});

test("Core generators and immutable false do not activate Authoring", () => {
  expect(model(collection({ type: "text", generated: "uuid", immutable: false, nullable: true }, false)).report).toMatchObject({ valid: true, results: [] });
});

test("disabled Authoring does not suppress independent Core semantic findings", () => {
  const root = collection({ type: "text", immutable: true, nullable: true, regex: "[" });
  expect(model(root, {}).report.results).toContainEqual(expect.objectContaining({ code: "invalid_note_type_schema", rule_id: "FND-31" }));
});

test.each([
  { type: "text", generated: { random: 12 }, max: 5, nullable: true },
  { type: "text", generated: "ulid", min: 30, nullable: true },
  { type: "text", generated: { random: 2 }, allowed_values: ["TOO-LONG"], nullable: true },
])("rejects generator domains that cannot meet declared constraints: %j", (field) => {
  expect(model(collection(field)).report.results).toContainEqual(expect.objectContaining({ rule_id: "FDR-65" }));
});

test("an unrelated vocabulary named undefined does not constrain generated fields", () => {
  const root = collection({ type: "text", generated: { random: 4 }, nullable: true });
  write(root, "typedmark.md", { ...version, name: "authoring", extensions: { "typedmark:authoring": "0.1.0" }, vocabularies: { undefined: { values: ["long-unrelated-value"] } } });
  expect(model(root).report).toMatchObject({ valid: true, results: [] });
});
