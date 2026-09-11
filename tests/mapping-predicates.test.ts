import { afterEach, expect, test } from "bun:test";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { tmpdir } from "node:os";
import { stringify } from "yaml";
import { readCollectionModel } from "../src/validator";

const schemaDirectory = resolve(import.meta.dir, "../../TypedMarkSpecification/schema/json-schema");
const roots: string[] = [];
function write(root: string, path: string, data: unknown) {
  mkdirSync(dirname(join(root, path)), { recursive: true });
  writeFileSync(join(root, path), `---\n${stringify(data)}---\n`);
}
function collection(mapping: object, notes: Record<string, object> = { "A.md": {} }) {
  const root = mkdtempSync(join(tmpdir(), "typedmark-predicates-")); roots.push(root);
  write(root, "typedmark.md", { specification_version: "0.1.0", name: "predicates", description: "Predicates.", note_type_mappings: [mapping] });
  write(root, ".typedmark/schemas/note.md", { specification_version: "0.1.0", description: "Note.",
    storage: { folder_pattern: "", note_name_pattern: "{title}" }, frontmatter: { sample: { type: "any", nullable: true, default_value: "default" } } });
  for (const [path, data] of Object.entries(notes)) write(root, path, data);
  return root;
}
const fixed = (when: object) => ({ kind: "fixed", note_type: "note", when });
const paths = (root: string) => readCollectionModel({ collectionRoot: root, schemaDirectory }).notes.map((note) => note.path);
afterEach(() => { for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true }); });

test.each([
  { predicate: { exists: true }, stored: {}, matches: false },
  { predicate: { exists: false }, stored: {}, matches: true },
  { predicate: { exists: false }, stored: { sample: null }, matches: false },
  { predicate: { equals: null }, stored: {}, matches: false },
  { predicate: { equals: null }, stored: { sample: null }, matches: true },
  { predicate: { equals: "default" }, stored: {}, matches: false },
  { predicate: { equals: { b: [1, 2], a: "é" } }, stored: { sample: { a: "e\u0301", b: [1, 2] } }, matches: true },
  { predicate: { equals: [2, 1] }, stored: { sample: [1, 2] }, matches: false },
  { predicate: { equals: 1 }, stored: { sample: "1" }, matches: false },
  { predicate: { regex: "é" }, stored: { sample: "e\u0301" }, matches: true },
  { predicate: { regex: "." }, stored: { sample: "😀" }, matches: true },
  { predicate: { regex: "x" }, stored: { sample: "x\n" }, matches: false },
  { predicate: { regex: "." }, stored: { sample: 3 }, matches: false },
  { predicate: { contains_any: ["é", "b"] }, stored: { sample: ["e\u0301"] }, matches: true },
  { predicate: { contains_all: ["é", "b"] }, stored: { sample: ["e\u0301", "b"] }, matches: true },
  { predicate: { contains_all: ["é", "b"] }, stored: { sample: ["é"] }, matches: false },
  { predicate: { contains_any: ["a"] }, stored: { sample: ["a", 3] }, matches: false },
  { predicate: { contains_any: ["a"] }, stored: { sample: "a" }, matches: false },
  { predicate: { equals: "x", regex: "y" }, stored: { sample: "x" }, matches: false },
  { predicate: { exists: false, equals: null }, stored: {}, matches: false },
])("frontmatter predicates use stored YAML values and AND semantics: %j", ({ predicate, stored, matches }) => {
  const root = collection(fixed({ frontmatter: { sample: predicate } }), { "A.md": stored });
  expect(paths(root)).toEqual(matches ? ["A.md"] : []);
});

test("body-only notes fail frontmatter predicates but an empty block can match", () => {
  const root = collection(fixed({ frontmatter: { sample: { exists: false } } }), { "Empty.md": {} });
  writeFileSync(join(root, "Body.md"), "Just a body.\n");
  expect(paths(root)).toEqual(["Empty.md"]);
});

test("predicate names identify NFC-equivalent stored keys", () => {
  const root = collection(fixed({ frontmatter: { "é": { exists: true, equals: 1 } } }), { "A.md": { "e\u0301": 1 } });
  expect(paths(root)).toEqual(["A.md"]);
});

test.each([
  { mapping: { kind: "folder", folder: "é/", note_type: "note" }, path: "e\u0301/A.md", stored: {} },
  { mapping: fixed({ path: { under: "e\u0301/" } }), path: "é/A.md", stored: {} },
  { mapping: fixed({ path: { equals: "é/A.md" } }), path: "e\u0301/A.md", stored: {} },
  { mapping: fixed({ path: { regex: "é/.*" } }), path: "e\u0301/A.md", stored: {} },
  { mapping: { kind: "tag", tag: "é", note_type: "note" }, path: "A.md", stored: { tags: ["e\u0301/child"] } },
])("mapping strings compare NFC paths and tags: %j", ({ mapping, path, stored }) => {
  expect(paths(collection(mapping, { [path]: stored }))).toEqual([path.normalize("NFC")]);
});

test("all path and frontmatter conditions must match together", () => {
  const root = collection(fixed({ path: { equals: "A.md", regex: "B.*" }, frontmatter: { sample: { exists: false } } }));
  expect(paths(root)).toEqual([]);
});
