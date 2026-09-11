import { afterEach, expect, test } from "bun:test";
import { dirname, join, resolve } from "node:path";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { stringify } from "yaml";
import { readCollectionModel, validateCollection } from "../src/validator";

const schemaDirectory = resolve(import.meta.dir, "../../TypedMarkSpecification/schema/json-schema");
const roots: string[] = [];
function write(root: string, path: string, data: unknown) {
  mkdirSync(dirname(join(root, path)), { recursive: true });
  writeFileSync(join(root, path), `---\n${stringify(data)}---\n`);
}
function collection(config = {}) {
  const root = mkdtempSync(join(tmpdir(), "typedmark-discovery-")); roots.push(root);
  write(root, "typedmark.md", { specification_version: "0.1.0", name: "discovery", description: "Discovery.", ...config });
  write(root, ".typedmark/schemas/note.md", { specification_version: "0.1.0", description: "Note.", storage: { folder_pattern: "", note_name_pattern: "{title}" } });
  write(root, "A.md", { note_type: "note" });
  return root;
}
afterEach(() => { for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true }); });

test("direct model and snapshot validation share default Git exclusions", () => {
  const root = collection(); write(root, ".git/Hidden.md", { note_type: "missing" });
  const input = { collectionRoot: root, schemaDirectory };
  expect(readCollectionModel(input).documents.map((document) => document.path)).toEqual(["A.md"]);
  expect(validateCollection(input)).toMatchObject({ valid: true, results: [] });
});

test("explicit empty exclusions and hidden ordinary files remain collection content", () => {
  const root = collection({ exclude_paths: [] });
  write(root, ".git/Untyped.md", {}); write(root, ".hidden.md", {});
  expect(readCollectionModel({ collectionRoot: root, schemaDirectory }).documents.map((document) => document.path)).toEqual([".git/Untyped.md", ".hidden.md", "A.md"]);
});

test("zero-level glob matches exclude notes while metadata remains available", () => {
  const root = collection({ exclude_paths: ["**/*.md"] });
  expect(validateCollection({ collectionRoot: root, schemaDirectory })).toMatchObject({ valid: true, results: [] });
  const loaded = readCollectionModel({ collectionRoot: root, schemaDirectory });
  expect(loaded.documents).toEqual([]); expect(loaded.schemas.has("note")).toBe(true);
});

test.each(["cache", "cache/*"])("directory matches do not exclude unmatched descendant notes: %s", (pattern) => {
  const root = collection({ exclude_paths: [pattern] }); write(root, "cache/sub/Deep.md", {});
  expect(readCollectionModel({ collectionRoot: root, schemaDirectory }).documents.map((document) => document.path)).toContain("cache/sub/Deep.md");
});

test("NFC-equivalent metadata names retain their physical spelling for reads", () => {
  const root = collection({ metadata_directory: "é", exclude_paths: ["**"] });
  write(root, "e\u0301/schemas/note.md", { specification_version: "0.1.0", description: "Note.", storage: { folder_pattern: "", note_name_pattern: "{title}" } });
  const input = { collectionRoot: root, schemaDirectory };
  expect(readCollectionModel(input).schemas.has("note")).toBe(true);
  expect(validateCollection(input)).toMatchObject({ valid: true, results: [] });
});
