import { afterEach, expect, test } from "bun:test";
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { tmpdir } from "node:os";
import { stringify } from "yaml";
import { validateCollection } from "../src/validator";
import { queryCollection } from "../src/query";
import { resolveStoragePath } from "../src/storage";

const roots: string[] = [];
const schemaDirectory = resolve(import.meta.dir, "../../TypedMarkSpecification/schema/json-schema");
function write(root: string, path: string, data: unknown) {
  mkdirSync(dirname(join(root, path)), { recursive: true });
  writeFileSync(join(root, path), `---\n${stringify(data)}---\n`);
}
function collection(storage = {}, fields = {}, notes: Record<string, object> = {}, config = {}) {
  const root = mkdtempSync(join(tmpdir(), "typedmark-storage-")); roots.push(root);
  write(root, "typedmark.md", { specification_version: "0.1.0", name: "storage", description: "Storage.", ...config });
  write(root, ".typedmark/schemas/note.md", { specification_version: "0.1.0", description: "Note.",
    storage: { folder_pattern: "", note_name_pattern: "{title}", ...storage }, frontmatter: fields });
  for (const [path, stored] of Object.entries(notes)) write(root, path, { note_type: "note", ...stored });
  return root;
}
const run = (root: string) => validateCollection({ collectionRoot: root, schemaDirectory });
afterEach(() => { for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true }); });

const invalidDeclarations = [
  { pattern: "{missing}", fields: {}, rule: "NTS-124" },
  { pattern: "{constructor}", fields: {}, rule: "NTS-124" },
  { pattern: "{details.title}", fields: { details: { type: "object", fields: {}, nullable: true } }, rule: "NTS-125" },
  { pattern: "{code:YYYY}", fields: { code: { type: "text", nullable: true } }, rule: "NTS-127" },
  { pattern: "{when:YY}", fields: { when: { type: "date", nullable: true } }, rule: "NTS-127" },
  ...[{ type: "list", items: { type: "text" } }, { type: "tags" }, { type: "object", fields: {} }, { type: "any" }]
    .map((definition) => ({ pattern: "{data}", fields: { data: { ...definition, nullable: true } }, rule: "NTS-132" })),
];
test.each(invalidDeclarations)("active and archive declarations validate before notes exist: %j", ({ pattern, fields, rule }) => {
  for (const storage of [{ note_name_pattern: pattern }, { archive: { folder_pattern: "Archive", note_name_pattern: pattern } }]) {
    expect(run(collection(storage, fields)).results).toContainEqual(expect.objectContaining({ code: "invalid_note_type_schema", path: ".typedmark/schemas/note.md", rule_id: rule }));
  }
});

test("nullable values cannot silently suppress path validation", () => {
  const root = collection({}, {}, { "A.md": { title: null } });
  expect(run(root).results).toContainEqual(expect.objectContaining({ code: "path", rule_id: "NTS-130" }));
});

test("a literal undefined name has no sentinel behavior", () => {
  expect(run(collection({ note_name_pattern: "undefined" }, {}, { "Wrong.md": {} })).results).toContainEqual(expect.objectContaining({ code: "path", rule_id: "NTS-146" }));
  expect(run(collection({ note_name_pattern: "undefined" }, {}, { "undefined.md": {} })).valid).toBe(true);
});

test.each(["a/b", "a\\b", ".", "..", "a\u0001b"])("rejects unsafe substituted folder %j", (folder) => {
  const root = collection({ folder_pattern: "{folder}" }, { folder: { type: "text" } }, { [folder === "a/b" ? "a/b/A.md" : "A.md"]: { folder } });
  expect(run(root).results).toContainEqual(expect.objectContaining({ code: "path", rule_id: "NTS-133" }));
});

test("a matching hidden basename is still an invalid resolved note name", () => {
  const root = collection({ note_name_pattern: ".Hidden" }, {}, { ".Hidden.md": {} });
  expect(run(root).results).toContainEqual(expect.objectContaining({ code: "path", rule_id: "NTS-134" }));
});

test("formatted dates use the collection timezone and ISO week-year without writing notes", () => {
  const root = collection({ folder_pattern: "{when:GGGG}/{when:WW}", note_name_pattern: "{when:YYYY-MM-DD}-{when:Q}" },
    { when: { type: "datetime" } }, { "2020/53/2021-01-01-1.md": { when: "2020-12-31T23:30Z" } }, { timezone: "Europe/Brussels" });
  const before = readFileSync(join(root, "2020/53/2021-01-01-1.md"));
  expect(run(root)).toMatchObject({ valid: true, results: [] });
  expect(readFileSync(join(root, "2020/53/2021-01-01-1.md"))).toEqual(before);
});

test("empty substitutions cannot produce an empty basename or traversal segment", () => {
  const fields = { value: { type: "text" } };
  expect(run(collection({ note_name_pattern: "{value}" }, fields, { "A.md": { value: "" } })).results)
    .toContainEqual(expect.objectContaining({ code: "path", rule_id: "NTS-134" }));
  expect(run(collection({ folder_pattern: "..{value}" }, fields, { "A.md": { value: "" } })).results)
    .toContainEqual(expect.objectContaining({ code: "path", rule_id: "NTS-180" }));
});

test("substitution is single-pass and literals containing undefined remain ordinary text", () => {
  const root = collection({}, {}, { "{title}.md": { title: "{title}" }, "undefined.md": { title: "undefined" } });
  expect(run(root)).toMatchObject({ valid: true, results: [] });
});

test("all affixes apply in order and archive patterns replace the active branch", () => {
  const root = collection({ note_name_prefix: { pattern: "pre-" }, note_name_suffix: { pattern: "-post" },
    archive: { folder_pattern: "Archive", note_name_pattern: "{title}", note_name_prefix: { pattern: "old-" } } }, {}, {
    "pre-A-post.md": { title: "A" }, "Archive/old-B.md": { title: "B", archived: true },
  });
  expect(run(root)).toMatchObject({ valid: true, results: [] });
});

test("archive omission retains the active storage contract", () => {
  expect(run(collection({}, {}, { "A.md": { archived: true } }))).toMatchObject({ valid: true, results: [] });
});

test("year-month formatting retains four-digit years", () => {
  const root = collection({ note_name_pattern: "{when:YYYY-MM}" }, { when: { type: "date" } }, { "0001-02.md": { when: "0001-02-03" } });
  expect(run(root)).toMatchObject({ valid: true, results: [] });
});

test.each(["local", "property-set"])("abstract storage resolves after concrete %s fields are composed", (source) => {
  const root = collection({}, {}, { "X.md": { code: "X" } }, { extensions: { "typedmark:reuse": "0.1.0" } });
  write(root, ".typedmark/schemas/base.md", { specification_version: "0.1.0", description: "Base.", abstract: true,
    storage: { folder_pattern: "", note_name_pattern: "{code}" } });
  const fields = { code: { type: "text" } };
  write(root, ".typedmark/schemas/note.md", { specification_version: "0.1.0", description: "Concrete.", extends: "base",
    ...(source === "local" ? { frontmatter: fields } : { property_sets: ["shared"] }) });
  if (source === "property-set") write(root, ".typedmark/property-sets/shared.md", { specification_version: "0.1.0", description: "Fields.", property_set: "shared", frontmatter: fields });
  expect(run(root)).toMatchObject({ valid: true, results: [] });
});

test("abstract storage still rejects intrinsically unsupported formats", () => {
  const root = collection({}, {}, {}, { extensions: { "typedmark:reuse": "0.1.0" } });
  write(root, ".typedmark/schemas/base.md", { specification_version: "0.1.0", description: "Base.", abstract: true,
    storage: { folder_pattern: "", note_name_pattern: "{future_field:YY}" } });
  expect(run(root).results).toContainEqual(expect.objectContaining({ code: "invalid_note_type_schema", rule_id: "NTS-127" }));
});

test.each(["Bad/Zone", "+02:00"])("invalid collection timezone %j produces a configuration finding", (timezone) => {
  const root = collection({ note_name_pattern: "{when:YYYY}" }, { when: { type: "datetime" } }, { "2026.md": { when: "2026-01-01T00:30Z" } }, { timezone });
  expect(run(root).results).toContainEqual(expect.objectContaining({ code: "invalid_collection_configuration", rule_id: "CM-551", path: "typedmark.md" }));
});

test("suppressed timezone diagnostics cannot create a successful empty query", () => {
  const root = collection({}, {}, {}, { timezone: "Bad/Zone", validation_defaults: { invalid_collection_configuration: "off" } });
  expect(() => queryCollection({ collectionRoot: root, schemaDirectory, queryVersion: "0.1.0",
    query: { specification_version: "0.1.0", select: [{ kind: "path", as: "path" }] } })).toThrow("CM-308");
});

test("the path resolver also guards unavailable timezone conversion", () => {
  expect(resolveStoragePath({ folder_pattern: "", note_name_pattern: "{when:YYYY}" }, { when: "2026-01-01T00:30Z" }, { when: { type: "datetime" } }, "Bad/Zone"))
    .toMatchObject({ failure: { rule: "NTS-128" } });
});

test("unformatted scalar substitution does not duplicate independent field errors", () => {
  const root = collection({ note_name_pattern: "{when}" }, { when: { type: "date" } }, { "tomorrow.md": { when: "tomorrow" } });
  expect(run(root).results).toEqual([expect.objectContaining({ code: "invalid_field_value", rule_id: "FDR-13", field: "when" })]);
});
