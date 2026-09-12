import { afterEach, expect, test } from "bun:test";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { tmpdir } from "node:os";
import { stringify } from "yaml";
import { validateCollection } from "../src/validator";

const roots: string[] = [];
const schemaDirectory = resolve(import.meta.dir, "../../TypedMarkSpecification/schema/json-schema");
function write(root: string, path: string, data: unknown) {
  mkdirSync(dirname(join(root, path)), { recursive: true });
  writeFileSync(join(root, path), `---\n${stringify(data)}---\n`);
}
function collection(count: object, notes: Record<string, object> = {}) {
  const root = mkdtempSync(join(tmpdir(), "typedmark-counts-")); roots.push(root);
  write(root, "typedmark.md", { specification_version: "0.1.0", name: "counts", description: "Count constraints." });
  write(root, ".typedmark/schemas/note.md", { specification_version: "0.1.0", description: "Note.", count,
    storage: { folder_pattern: "", note_name_pattern: "{title}" } });
  for (const [path, stored] of Object.entries(notes)) write(root, path, { note_type: "note", ...stored });
  return root;
}
const run = (root: string) => validateCollection({ collectionRoot: root, schemaDirectory });
afterEach(() => { for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true }); });

test.each([{}, { "A.md": {} }] as Array<Record<string, object>>)("inverted count ranges invalidate the schema, not an arbitrary population: %j", (notes) => {
  const report = run(collection({ min: 2, max: 1 }, notes));
  expect(report.results).toEqual([expect.objectContaining({ code: "invalid_note_type_schema", rule_id: "NTS-69", path: ".typedmark/schemas/note.md" })]);
});

test.each([{ min: 0 }, { max: 0 }, { min: 0, max: 0 }, {}])("zero/omitted bounds accept an empty collection: %j", (count) => {
  expect(run(collection(count))).toMatchObject({ valid: true, results: [] });
});

test("valid bounds still report an actual note-count violation", () => {
  expect(run(collection({ min: 1 })).results).toContainEqual(expect.objectContaining({ code: "invalid_note_count", rule_id: "NTS-71", note_type: "note" }));
});

test("deleted and archived notes still belong to the concrete type count", () => {
  expect(run(collection({ min: 2, max: 2 }, { "A.md": { deleted: true }, "B.md": { archived: true } })))
    .toMatchObject({ valid: true, results: [] });
});

test("abstract count declarations validate even without instances", () => {
  const root = collection({ min: 0 });
  write(root, "typedmark.md", { specification_version: "0.1.0", name: "counts", description: "Count constraints.", extensions: { "typedmark:reuse": "0.1.0" } });
  write(root, ".typedmark/schemas/base.md", { specification_version: "0.1.0", description: "Base.", abstract: true, count: { min: 2, max: 1 } });
  expect(run(root).results).toContainEqual(expect.objectContaining({ code: "invalid_note_type_schema", rule_id: "NTS-69", path: ".typedmark/schemas/base.md" }));
});
