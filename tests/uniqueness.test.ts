import { afterEach, expect, test } from "bun:test";
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { tmpdir } from "node:os";
import { stringify } from "yaml";
import { validateCollection } from "../src/validator";

type Data = Record<string, any>;
const roots: string[] = [];
const schemaDirectory = resolve(import.meta.dir, "../../TypedMarkSpecification/schema/json-schema");
function write(root: string, path: string, data: unknown) {
  mkdirSync(dirname(join(root, path)), { recursive: true });
  writeFileSync(join(root, path), `---\n${stringify(data)}---\n`);
}
function collection(types: Record<string, Data>, notes: Record<string, Data>, config: Data = {}) {
  const root = mkdtempSync(join(tmpdir(), "typedmark-uniqueness-")); roots.push(root);
  write(root, "typedmark.md", { specification_version: "0.1.0", name: "uniqueness", description: "Uniqueness.", ...config });
  for (const [type, fields] of Object.entries(types)) write(root, `.typedmark/schemas/${type}.md`, {
    specification_version: "0.1.0", description: "Note.", storage: { folder_pattern: "", note_name_pattern: "{title}" }, frontmatter: fields,
  });
  for (const [path, data] of Object.entries(notes)) write(root, path, data);
  return root;
}
const run = (root: string) => validateCollection({ collectionRoot: root, schemaDirectory });
const duplicates = (root: string) => run(root).results.filter((finding) => finding.code === "duplicate_unique_value");
afterEach(() => { for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true }); });

test.each([
  { definition: { type: "text" }, left: "e\u0301", right: "é" },
  { definition: { type: "link", format: "note_link" }, left: "[[e\u0301]]", right: "[[é]]" },
  { definition: { type: "datetime" }, left: "2026-01-01T11:00Z", right: "2026-01-01T12:00+01:00" },
  { definition: { type: "datetime" }, left: "2026-01-01T11:00Z", right: "2026-01-01T12:00", timezone: "Europe/Brussels" },
  { definition: { type: "number" }, left: -0, right: 0 },
  { definition: { type: "checkbox" }, left: false, right: false },
  { definition: { type: "text" }, left: "", right: "" },
])("uniqueness uses the declared equality domain: %j", ({ definition, left, right, ...config }) => {
  const root = collection({ note: { value: { ...definition, unique: true } } }, {
    "A.md": { note_type: "note", value: left }, "B.md": { note_type: "note", value: right },
  }, config);
  expect(duplicates(root)).toEqual([expect.objectContaining({ path: "B.md", rule_id: "FDR-83", field: "value", note_type: "note" })]);
});

test("collection uniqueness includes same-typed fields without a repeated declaration", () => {
  const root = collection({ alpha: { value: { type: "text", unique: "collection" } }, beta: { value: { type: "text" } } }, {
    "A.md": { note_type: "alpha", value: "shared" }, "B.md": { note_type: "beta", value: "shared" },
  });
  expect(duplicates(root)).toEqual([expect.objectContaining({ path: "B.md", rule_id: "FDR-84" })]);
});

test("a collection-wide declaration applies even when its declaring type has no notes", () => {
  const root = collection({ alpha: { value: { type: "text", unique: "collection" } }, beta: { value: { type: "text" } } }, {
    "A.md": { note_type: "beta", value: "shared" }, "B.md": { note_type: "beta", value: "shared" },
  });
  expect(duplicates(root)).toEqual([expect.objectContaining({ path: "B.md", rule_id: "FDR-84" })]);
});

test("collection uniqueness keeps integer and number property types separate", () => {
  const root = collection({ alpha: { value: { type: "integer", unique: "collection" } }, beta: { value: { type: "number", unique: "collection" } } }, {
    "A.md": { note_type: "alpha", value: 1 }, "B.md": { note_type: "beta", value: 1 },
  });
  expect(duplicates(root)).toEqual([]);
});

test("time equality spans different valid formats of the same property type", () => {
  const root = collection({ alpha: { value: { type: "time", format: "hh:mm", unique: "collection" } }, beta: { value: { type: "time", format: "hh:mm:ss" } } }, {
    "A.md": { note_type: "alpha", value: "12:00" }, "B.md": { note_type: "beta", value: "12:00:00" },
  });
  expect(duplicates(root)).toEqual([expect.objectContaining({ path: "B.md", rule_id: "FDR-84" })]);
});

test("effective defaults participate without being written", () => {
  const root = collection({ note: { value: { type: "text", default_value: "same", unique: true } } }, {
    "A.md": { note_type: "note" }, "B.md": { note_type: "note", value: "same" },
  });
  const before = readFileSync(join(root, "A.md"));
  expect(duplicates(root)).toHaveLength(1);
  expect(readFileSync(join(root, "A.md"))).toEqual(before);
});

test("local scope and case-sensitive equality do not merge unrelated values", () => {
  const field = { value: { type: "text", unique: true } };
  const root = collection({ alpha: field, beta: field }, {
    "A.md": { note_type: "alpha", value: "same" }, "B.md": { note_type: "beta", value: "same" }, "C.md": { note_type: "alpha", value: "Same" },
  });
  expect(duplicates(root)).toEqual([]);
});

test("absent, null, and invalid temporal values cannot crash uniqueness", () => {
  const root = collection({ note: { value: { type: "datetime", nullable: true, unique: true } } }, {
    "A.md": { note_type: "note" }, "B.md": { note_type: "note", value: null },
    "C.md": { note_type: "note", value: "invalid" }, "D.md": { note_type: "note", value: "invalid" },
  });
  expect(duplicates(root)).toEqual([]);
  expect(run(root).results.filter((finding) => finding.code === "invalid_field_value")).toHaveLength(2);
});

test("Core identifier uniqueness includes deleted and archived notes across types", () => {
  const root = collection({ alpha: {}, beta: {} }, {
    "A.md": { note_type: "alpha", id: "same" }, "B.md": { note_type: "beta", id: "same", deleted: true, archived: true },
  });
  expect(duplicates(root)).toEqual([expect.objectContaining({ path: "B.md", rule_id: "MN-48", field: "id" })]);
});
