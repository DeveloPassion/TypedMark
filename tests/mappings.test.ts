import { afterEach, expect, test } from "bun:test";
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { tmpdir } from "node:os";
import { stringify } from "yaml";
import { readCollectionModel } from "../src/validator";
import { queryCollection } from "../src/query";

const schemaDirectory = resolve(import.meta.dir, "../../TypedMarkSpecification/schema/json-schema");
const roots: string[] = [];
const defaultMapping = { kind: "frontmatter_field", field: "note_type" };
const fixed = (note_type = "note", when: object = { path: { regex: ".*" } }) => ({ kind: "fixed", note_type, when });
function write(root: string, path: string, data: unknown) {
  mkdirSync(dirname(join(root, path)), { recursive: true });
  writeFileSync(join(root, path), `---\n${stringify(data)}---\n`);
}
function collection(mappings: object[], notes: Record<string, object> = { "A.md": {} }, config = {}) {
  const root = mkdtempSync(join(tmpdir(), "typedmark-mappings-")); roots.push(root);
  write(root, "typedmark.md", { specification_version: "0.1.0", name: "mappings", description: "Mappings.", note_type_mappings: mappings, ...config });
  for (const name of ["note", "other"]) write(root, `.typedmark/schemas/${name}.md`, {
    specification_version: "0.1.0", description: "Note.", storage: { folder_pattern: "", note_name_pattern: "{title}" },
  });
  for (const [path, data] of Object.entries(notes)) write(root, path, data);
  return root;
}
const model = (root: string) => readCollectionModel({ collectionRoot: root, schemaDirectory });
const query = (root: string) => queryCollection({ collectionRoot: root, schemaDirectory, queryVersion: "0.1.0",
  query: { specification_version: "0.1.0", select: [{ kind: "path", as: "path" }] } });
afterEach(() => { for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true }); });

test("the first matching rule wins without consulting later matching rules", () => {
  const root = collection([fixed("other"), fixed()]);
  const loaded = model(root);
  expect(loaded.notes.map((note) => note.noteType)).toEqual(["other"]);
  expect(loaded.report.results).toEqual([]);
});

test.each([null, 42, [], {}, "", "unknown"].map((candidate) => ({ candidate })))("a physically present invalid candidate never falls back: %j", ({ candidate }) => {
  const root = collection([defaultMapping, fixed()], { "A.md": { note_type: candidate } });
  const loaded = model(root);
  expect(loaded.notes).toEqual([]);
  expect(loaded.report.results).toContainEqual(expect.objectContaining({ code: "invalid_note_type_mapping", path: "A.md", rule_id: "CM-114" }));
  expect(query(root).rows).toEqual([]);
});

test("an absent stored field allows a later mapping and never uses schema defaults", () => {
  const root = collection([defaultMapping, fixed("other")]);
  expect(model(root).notes[0]?.noteType).toBe("other");
});

test("stored note_type must agree with path association without being rewritten", () => {
  const root = collection([fixed("other"), defaultMapping], { "A.md": { note_type: "note" } });
  const before = readFileSync(join(root, "A.md"));
  const loaded = model(root);
  expect(loaded.notes[0]?.noteType).toBe("other");
  expect(loaded.report.results).toContainEqual(expect.objectContaining({ code: "invalid_field_value", rule_id: "MN-40", field: "note_type" }));
  expect(readFileSync(join(root, "A.md"))).toEqual(before);
});

test("tag mappings ignore non-string entries without hiding field errors", () => {
  const root = collection([{ kind: "tag", tag: "project", note_type: "note" }], { "A.md": { tags: [42, "project/active"] } });
  const loaded = model(root);
  expect(loaded.notes[0]?.noteType).toBe("note");
  expect(loaded.report.results).toContainEqual(expect.objectContaining({ code: "invalid_field_value", field: "tags" }));
});

test("an abstract stored candidate remains untyped and is not a query candidate", () => {
  const root = collection([defaultMapping, fixed()], { "A.md": { note_type: "base" } }, { extensions: { "typedmark:reuse": "0.1.0" } });
  write(root, ".typedmark/schemas/base.md", { specification_version: "0.1.0", description: "Abstract.", abstract: true });
  expect(model(root).report.results).toContainEqual(expect.objectContaining({ code: "invalid_note_type_mapping", rule_id: "CM-114" }));
  expect(query(root).rows).toEqual([]);
});

test("unreachable invalid mapping declarations still invalidate association", () => {
  const root = collection([fixed(), fixed("missing")]);
  expect(model(root).report.results).toContainEqual(expect.objectContaining({ code: "invalid_note_type_mapping", path: "typedmark.md", rule_id: "CM-83" }));
  expect(() => query(root)).toThrow("CM-308");
});

test.each([
  fixed("missing"), { kind: "tag", tag: "project", note_type: "missing" },
  { kind: "folder", folder: "Notes/", note_type: "missing" },
  fixed("note", { path: { regex: "[" } }), fixed("note", { frontmatter: { title: { regex: "[" } } }),
])("invalid mapping declarations fail even in an empty collection: %j", (mapping) => {
  const root = collection([mapping], {}, { validation_defaults: { invalid_note_type_mapping: "off" } });
  expect(() => query(root)).toThrow("CM-308");
  const unsuppressed = collection([mapping], {});
  expect(model(unsuppressed).report.results).toContainEqual(expect.objectContaining({ code: "invalid_note_type_mapping", path: "typedmark.md" }));
});
