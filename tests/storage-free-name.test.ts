import { afterEach, expect, test } from "bun:test";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { tmpdir } from "node:os";
import { stringify } from "yaml";
import { validateCollection } from "../src/validator";
import { checkStoragePath, resolveStoragePath } from "../src/storage";

const roots: string[] = [];
const schemaDirectory = resolve(import.meta.dir, "../../TypedMarkSpecification/schema/json-schema");
function write(root: string, path: string, data: unknown) {
  mkdirSync(dirname(join(root, path)), { recursive: true });
  writeFileSync(join(root, path), `---\n${stringify(data)}---\n`);
}
// Unlike storage.test.ts, the storage block is used as given: free names omit note_name_pattern.
function collection(storage: object, fields = {}, notes: Record<string, object> = {}) {
  const root = mkdtempSync(join(tmpdir(), "typedmark-free-name-")); roots.push(root);
  write(root, "typedmark.md", { specification_version: "0.1.0", name: "free-name", description: "Free names." });
  write(root, ".typedmark/schemas/note.md", { specification_version: "0.1.0", description: "Note.", storage, frontmatter: fields });
  for (const [path, stored] of Object.entries(notes)) write(root, path, { note_type: "note", ...stored });
  return root;
}
const run = (root: string) => validateCollection({ collectionRoot: root, schemaDirectory });
const pathResults = (root: string) => run(root).results.filter((result) => result.code === "path");
afterEach(() => { for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true }); });

const slug = "^[a-z0-9]+(?:[.-][a-z0-9]+)*$";
const day = { day: { type: "date" } };
const journal = { folder_pattern: "journal", note_name_prefix: { pattern: "{day:YYYY-MM-DD} " }, note_name_regex: "^\\S.*$" };

test("a free name accepts any author-chosen basename independent of the stored title", () => {
  const root = collection({ folder_pattern: "contacts" }, {}, {
    "contacts/smith.john.md": { title: "John Smith" }, "contacts/Jane Doe 📇.md": {}, "contacts/x.md": { title: null },
  });
  expect(run(root)).toMatchObject({ valid: true, results: [] });
});

test("note_name_regex fully matches the free name (NTS-182)", () => {
  const root = collection({ folder_pattern: "notes", note_name_regex: slug }, {}, {
    "notes/net.proto.bgp.md": { title: "Border Gateway Protocol" }, "notes/growth-mindset.md": {},
    "notes/Net Proto BGP.md": {}, "notes/bgp.md.bak.md": {}, "notes/ok-but-trailing-.md": {},
  });
  expect(pathResults(root).map((result) => [result.path, result.rule_id]).sort()).toEqual([
    ["notes/Net Proto BGP.md", "NTS-182"], ["notes/ok-but-trailing-.md", "NTS-182"],
  ]);
});

test("affixes resolve from fields and bound the free name", () => {
  const root = collection(journal, day, {
    "journal/2026-10-22 Standup.md": { day: "2026-10-22" },
    "journal/2026-10-21 Standup.md": { day: "2026-10-22" },
    "journal/Standup.md": { day: "2026-10-22" },
    "journal/2026-10-22  Indented.md": { day: "2026-10-22" },
    "journal/2026-10-22 .md": { day: "2026-10-22" },
    "journal/Undated.md": {},
  });
  expect(pathResults(root).map((result) => [result.path, result.rule_id]).sort()).toEqual([
    ["journal/2026-10-21 Standup.md", "NTS-146"],
    ["journal/2026-10-22  Indented.md", "NTS-182"],
    ["journal/2026-10-22 .md", "NTS-181"],
    ["journal/Standup.md", "NTS-146"],
    ["journal/Undated.md", "NTS-130"],
  ]);
});

test("a free name outside the resolved folder is a path mismatch", () => {
  const results = pathResults(collection({ folder_pattern: "notes" }, {}, { "elsewhere/a.md": {}, "a.md": {}, "notes/deeper/a.md": {} }));
  expect(results.map((result) => [result.path, result.rule_id]).sort()).toEqual([
    ["a.md", "NTS-146"], ["elsewhere/a.md", "NTS-146"], ["notes/deeper/a.md", "NTS-146"],
  ]);
  expect(results[0]!.message).toContain("notes/<free name>.md");
});

test("safety rules still apply to free names", () => {
  const results = pathResults(collection({ folder_pattern: "" }, {}, { ".Hidden.md": {} }));
  expect(results).toEqual([expect.objectContaining({ path: ".Hidden.md", rule_id: "NTS-134" })]);
});

test("an archive block without name keys keeps the free name in its folder", () => {
  const storage = { folder_pattern: "notes", note_name_regex: slug, archive: { folder_pattern: "Archive/notes" } };
  const root = collection(storage, {}, {
    "Archive/notes/net.proto.bgp.md": { archived: true }, "Archive/notes/Any Name.md": { archived: true },
    "notes/archived.md": { archived: true },
  });
  expect(pathResults(root).map((result) => [result.path, result.rule_id])).toEqual([["notes/archived.md", "NTS-146"]]);
});

test("an archive branch can derive a name from an active free name", () => {
  const storage = { folder_pattern: "notes", archive: { folder_pattern: "Archive", note_name_pattern: "{code}" } };
  const root = collection(storage, { code: { type: "text", nullable: true } }, {
    "notes/anything.md": { code: "x" }, "Archive/x.md": { archived: true, code: "x" }, "Archive/y.md": { archived: true, code: "x" },
  });
  expect(pathResults(root).map((result) => [result.path, result.rule_id])).toEqual([["Archive/y.md", "NTS-146"]]);
});

test("an invalid note_name_regex makes the schema invalid in either branch (FND-31)", () => {
  for (const storage of [{ folder_pattern: "notes", note_name_regex: "^[a-z+$" },
    { folder_pattern: "notes", archive: { folder_pattern: "Archive", note_name_regex: "(" } }]) {
    expect(run(collection(storage)).results).toContainEqual(expect.objectContaining({
      code: "invalid_note_type_schema", path: ".typedmark/schemas/note.md", rule_id: "FND-31",
    }));
  }
});

test("note_name_regex cannot accompany note_name_pattern", () => {
  const results = run(collection({ folder_pattern: "notes", note_name_pattern: "{title}", note_name_regex: slug })).results;
  expect(results).toContainEqual(expect.objectContaining({ path: ".typedmark/schemas/note.md" }));
  expect(results.every((result) => result.code !== "path")).toBe(true);
});

test("writers resolve a free-name path only from a supplied name (NTS-150)", () => {
  const storage = { folder_pattern: "journal", note_name_prefix: { pattern: "{day:YYYY-MM-DD} " }, note_name_regex: "^\\S.*$" };
  const fields = { day: { type: "date" as const } };
  const values = { day: "2026-10-22" };
  expect(resolveStoragePath(storage, values, fields, "UTC")).toEqual({ failure: expect.objectContaining({ rule: "NTS-181" }) });
  expect(resolveStoragePath(storage, values, fields, "UTC", "Standup")).toEqual({ path: "journal/2026-10-22 Standup.md" });
  expect(resolveStoragePath(storage, values, fields, "UTC", " Standup")).toEqual({ failure: expect.objectContaining({ rule: "NTS-182" }) });
  expect(resolveStoragePath(storage, values, fields, "UTC", "a\u0001b")).toEqual({ failure: expect.objectContaining({ rule: "NTS-180" }) });
});

test("free-name checks compare NFC forms of the path and affixes", () => {
  const storage = { folder_pattern: "Café", note_name_prefix: { pattern: "Café " } };
  expect(checkStoragePath(storage, "Café/Café menu.md", {}, {}, "UTC")).toEqual({ path: "Café/Café menu.md" });
});
