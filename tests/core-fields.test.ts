import { afterEach, expect, test } from "bun:test";
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { tmpdir } from "node:os";
import { stringify } from "yaml";
import { readCollectionModel, validateCollection } from "../src/validator";

const roots: string[] = [];
const schemaDirectory = resolve(import.meta.dir, "../../TypedMarkSpecification/schema/json-schema");
function write(root: string, path: string, data: unknown) {
  mkdirSync(dirname(join(root, path)), { recursive: true });
  writeFileSync(join(root, path), `---\n${stringify(data)}---\n`);
}
function collection(stored = {}, fields = {}, config = {}, schema = {}) {
  const root = mkdtempSync(join(tmpdir(), "typedmark-core-fields-")); roots.push(root);
  write(root, "typedmark.md", { specification_version: "0.1.0", name: "core-fields", description: "Core fields.", ...config });
  write(root, ".typedmark/schemas/note.md", { specification_version: "0.1.0", description: "Note.",
    storage: { folder_pattern: "", note_name_pattern: "A" }, frontmatter: fields, ...schema });
  write(root, "A.md", { note_type: "note", ...stored });
  return root;
}
const run = (root: string) => validateCollection({ collectionRoot: root, schemaDirectory });
afterEach(() => { for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true }); });

test("an omitted identifier remains absent but a stored null is not a valid identifier", () => {
  const root = collection();
  expect(run(root)).toMatchObject({ valid: true, results: [] });
  expect(readCollectionModel({ collectionRoot: root, schemaDirectory }).notes[0]?.values.id).toBeNull();
  write(root, "A.md", { note_type: "note", id: null });
  const before = readFileSync(join(root, "A.md"));
  expect(run(root).results).toContainEqual(expect.objectContaining({ code: "missing_required_field", rule_id: "MN-99", field: "id" }));
  expect(readFileSync(join(root, "A.md"))).toEqual(before);
});

test.each([
  { aliases: [""], rule: "MN-35" }, { aliases: ["same", "same"], rule: "MN-35" },
  { aliases: ["é", "e\u0301"], rule: "MN-35" },
  ...["a/b", "a\\b", "a#b", "a^b", "a|b", "a\nb", "a\rb"].map((alias) => ({ aliases: [alias], rule: "MN-82" })),
])("Core aliases retain their base value restrictions: %j", ({ aliases, rule }) => {
  const root = collection({ aliases }, { aliases: { type: "list", items: { type: "text" } } });
  expect(run(root).results).toContainEqual(expect.objectContaining({ code: "invalid_field_value", field: "aliases", rule_id: rule }));
});

test("non-empty aliases preserve whitespace and case without normalization writes", () => {
  const root = collection({ aliases: [" ", "Name", "name", "e\u0301"], id: "stable-id", title: null });
  const before = readFileSync(join(root, "A.md"));
  expect(run(root)).toMatchObject({ valid: true, results: [] });
  expect(readFileSync(join(root, "A.md"))).toEqual(before);
});

test.each([[""], ["same", "same"], ["bad/alias"]].map((default_value) => ({ default_value })))("Core alias defaults cannot weaken the base contract: %j", ({ default_value }) => {
  const root = collection({}, { aliases: { type: "list", items: { type: "text" }, default_value } });
  expect(run(root).results).toContainEqual(expect.objectContaining({ code: "invalid_note_type_schema", rule_id: "FDR-4" }));
});

test("tags and mandatory tags compare NFC values without rewriting stored spelling", () => {
  const root = collection({ tags: ["e\u0301"] }, {}, { mandatory_tags: ["é"] }, { mandatory_tags: ["é"] });
  const before = readFileSync(join(root, "A.md"));
  expect(run(root)).toMatchObject({ valid: true, results: [] });
  expect(readFileSync(join(root, "A.md"))).toEqual(before);
});

test("mandatory tags require an exact entry rather than only a descendant", () => {
  const root = collection({ tags: ["é/child"] }, {}, { mandatory_tags: ["é"] });
  expect(run(root).results).toContainEqual(expect.objectContaining({ code: "invalid_field_value", rule_id: "MN-128", field: "tags" }));
});

test.each(["collection", "schema"])("mandatory tag declarations accept decomposed spelling at %s scope", (scope) => {
  const declaration = { mandatory_tags: ["e\u0301"] };
  const root = collection({ tags: ["é"] }, {}, scope === "collection" ? declaration : {}, scope === "schema" ? declaration : {});
  const path = join(root, scope === "collection" ? "typedmark.md" : ".typedmark/schemas/note.md");
  const before = readFileSync(path);
  expect(run(root)).toMatchObject({ valid: true, results: [] });
  expect(readFileSync(path)).toEqual(before);
});

test.each(["collection", "schema"])("mandatory tag declarations reject NFC duplicates at %s scope", (scope) => {
  const declaration = { mandatory_tags: ["Å", "Å"] };
  const root = collection({ tags: ["Å"] }, {}, scope === "collection" ? declaration : {}, scope === "schema" ? declaration : {});
  expect(run(root).results).toContainEqual(expect.objectContaining({ code: scope === "collection" ? "invalid_collection_configuration" : "invalid_note_type_schema" }));
});
