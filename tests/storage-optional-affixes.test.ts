import { afterEach, expect, test } from "bun:test";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { tmpdir } from "node:os";
import { stringify } from "yaml";
import { storageAccepts } from "../src/automation-rules";
import { validateCollection } from "../src/validator";
import { checkStoragePath, namePart, resolveStoragePath, titleFallback } from "../src/storage";

const roots: string[] = [];
const schemaDirectory = resolve(import.meta.dir, "../../TypedMarkSpecification/schema/json-schema");
function write(root: string, path: string, data: unknown, body = "") {
  mkdirSync(dirname(join(root, path)), { recursive: true });
  writeFileSync(join(root, path), `---\n${stringify(data)}---\n${body}`);
}
function collection(schema: object, notes: Record<string, [object, string?]>) {
  const root = mkdtempSync(join(tmpdir(), "typedmark-optional-affix-"));
  roots.push(root);
  write(root, "typedmark.md", { specification_version: "0.1.0", name: "optional-affix", description: "Optional affixes." });
  write(root, ".typedmark/schemas/note.md", { specification_version: "0.1.0", description: "Note.", ...schema });
  for (const [path, [stored, body]] of Object.entries(notes)) write(root, path, { note_type: "note", ...stored }, body);
  return root;
}
const run = (root: string) => validateCollection({ collectionRoot: root, schemaDirectory }).results;
afterEach(() => {
  for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true });
});

const decorated = { folder_pattern: "notes", note_name_suffix: { pattern: " (Permanent)", optional: true } };

test("an optional suffix may be present or absent (NTS-188, NTS-189)", () => {
  expect(checkStoragePath(decorated, "notes/Idea.md", {}, {}, "UTC")).toEqual({ path: "notes/Idea.md" });
  expect(checkStoragePath(decorated, "notes/Idea (Permanent).md", {}, {}, "UTC")).toEqual({ path: "notes/Idea (Permanent).md" });
  expect(checkStoragePath(decorated, "elsewhere/Idea.md", {}, {}, "UTC")).toEqual({ path: "notes/<free name>.md" });
});

test("an optional affix is removed only when text remains (NTS-189)", () => {
  expect(namePart(decorated, "notes/ (Permanent).md", {}, {}, "UTC")).toEqual({ name: " (Permanent)", prefix: false, suffix: false });
  expect(namePart(decorated, "notes/Idea (Permanent).md", {}, {}, "UTC")).toEqual({ name: "Idea", prefix: false, suffix: true });
});

test("required affixes keep their mismatch and empty-name failures (NTS-181, NTS-192)", () => {
  const storage = { folder_pattern: "Projects", note_name_suffix: { pattern: " (Project)" } };
  expect(checkStoragePath(storage, "Projects/Launch.md", {}, {}, "UTC")).toEqual({ path: "Projects/<free name> (Project).md" });
  expect(checkStoragePath(storage, "Projects/ (Project).md", {}, {}, "UTC")).toEqual({ failure: expect.objectContaining({ rule: "NTS-181" }) });
  const overlapping = { folder_pattern: "", note_name_prefix: { pattern: "ab" }, note_name_suffix: { pattern: "ba" } };
  expect(namePart(overlapping, "aba.md", {}, {}, "UTC")).toEqual({ name: "aba", prefix: false, suffix: false });
});

test("writers omit an optional affix unless asked (NTS-190)", () => {
  expect(resolveStoragePath(decorated, {}, {}, "UTC", "Idea")).toEqual({ path: "notes/Idea.md" });
  expect(resolveStoragePath(decorated, {}, {}, "UTC", "Idea", undefined, { prefix: false, suffix: true })).toEqual({ path: "notes/Idea (Permanent).md" });
});

test("the title fallback is the name part, never resolving affixes from the title (NTS-192, NTS-193)", () => {
  const fields = { day: { type: "date" as const } };
  const dated = { folder_pattern: "journal", note_name_prefix: { pattern: "{day} " } };
  expect(titleFallback(dated, "journal/2026-10-22 Standup.md", { day: "2026-10-22" }, fields, "UTC")).toBe("Standup");
  expect(titleFallback(dated, "journal/2026-10-22 Standup.md", {}, fields, "UTC")).toBe("2026-10-22 Standup");
  const titled = { folder_pattern: "", note_name_prefix: { pattern: "{title} " } };
  expect(titleFallback(titled, "A B.md", { title: "A" }, { title: { type: "text" as const } }, "UTC")).toBe("A B");
  const archived = { ...decorated, archive: { folder_pattern: "Archive", note_name_suffix: { pattern: " (Old)" } } };
  expect(titleFallback(archived, "Archive/Idea (Old).md", { archived: true }, {}, "UTC")).toBe("Idea");
});

test("validation uses the name-part title for headings (RHT-53)", () => {
  const root = collection(
    { storage: decorated, headings: { require_h1_title: true } },
    {
      "notes/Idea (Permanent).md": [{}, "\n# Idea\n"],
      "notes/Other (Permanent).md": [{}, "\n# Other (Permanent)\n"],
    },
  );
  const headings = run(root).filter((result) => result.rule_id === "RHT-53");
  expect(headings.map((result) => result.path)).toEqual(["notes/Other (Permanent).md"]);
});

test("automation targeting accepts either form of an optional affix", () => {
  expect(storageAccepts("notes/Idea.md", decorated)).toBe(true);
  expect(storageAccepts("notes/Idea (Permanent).md", decorated)).toBe(true);
  expect(storageAccepts("Projects/Launch.md", { folder_pattern: "Projects", note_name_suffix: { pattern: " (Project)" } })).toBe(false);
});
