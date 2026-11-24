import { afterEach, expect, test } from "bun:test";
import { cpSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { queryCollection } from "../src/query";

const specification = resolve(import.meta.dir, "../../TypedMarkSpecification");
const schemaDirectory = join(specification, "schema/json-schema");
const roots: string[] = [];
afterEach(() => {
  for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true });
});

// The query pilot plus a project with an invalid status and a task whose project link escapes the root.
function collection() {
  const root = mkdtempSync(join(tmpdir(), "typedmark-skipped-"));
  roots.push(root);
  cpSync(join(specification, "schema/fixtures/golden/query-pilot-valid/collection"), root, { recursive: true });
  writeFileSync(join(root, "Projects/Broken.md"), "---\nnote_type: project\nid: broken\nstatus: 7\n---\n");
  writeFileSync(join(root, "Tasks/Third.md"), "---\nnote_type: task\npriority: 1\nproject: '[[broken]]'\n---\n");
  writeFileSync(join(root, "Tasks/Escaping.md"), "---\nnote_type: task\npriority: 3\nproject: '[[../../Outside]]'\n---\n");
  return root;
}
const run = (root: string, query: object) => queryCollection({ collectionRoot: root, schemaDirectory, queryVersion: "0.1.0", query });

test("valid rows remain while notes without a model are left out and listed (CM-619, CM-620)", () => {
  const root = collection();
  const result = run(root, { specification_version: "0.1.0", note_types: ["task"], select: [{ kind: "path", as: "path" }] });
  expect(result).toMatchObject({
    evaluation: "complete",
    rows: [{ path: "Tasks/First.md" }, { path: "Tasks/Second.md" }, { path: "Tasks/Third.md" }],
    skipped: ["Tasks/Escaping.md"],
  });
});

test("relationship traversal leaves out unusable targets and sources (CM-619)", () => {
  const root = collection();
  const outbound = run(root, {
    specification_version: "0.1.0",
    note_types: ["task"],
    where: { kind: "relationship", relationship: "belongs_to", note_types: ["project"] },
    select: [{ kind: "path", as: "path" }],
  });
  // Third.md belongs to the invalid project, so it has no usable parent.
  expect(outbound).toMatchObject({ rows: [{ path: "Tasks/First.md" }, { path: "Tasks/Second.md" }], skipped: ["Projects/Broken.md", "Tasks/Escaping.md"] });
  const inbound = run(root, {
    specification_version: "0.1.0",
    note_types: ["project"],
    where: { kind: "relationship", relationship: "belongs_to", direction: "inbound", note_types: ["task"] },
    select: [{ kind: "path", as: "path" }],
  });
  expect(inbound).toMatchObject({ rows: [{ path: "Projects/Alpha.md" }], skipped: ["Projects/Broken.md", "Tasks/Escaping.md"] });
});

test("a result with nothing left out has no skipped list", () => {
  const result = run(join(specification, "schema/fixtures/golden/query-pilot-valid/collection"), {
    specification_version: "0.1.0",
    select: [{ kind: "path", as: "path" }],
  });
  expect(result.skipped).toBeUndefined();
});

test("each left-out note carries at least one reason, in path order (QRY-3)", () => {
  const root = collection();
  writeFileSync(join(root, "Tasks/Unclosed.md"), "---\nnote_type: task\npriority: [\n---\n");
  const result = run(root, { specification_version: "0.1.0", select: [{ kind: "path", as: "path" }] });
  expect(result.skipped_details!.map((detail) => detail.path)).toEqual(result.skipped!);
  for (const detail of result.skipped_details!) expect(detail.results.length).toBeGreaterThan(0);
  const escaping = result.skipped_details!.find((detail) => detail.path === "Tasks/Escaping.md")!;
  expect(escaping!.results[0]).toMatchObject({ code: "invalid_note_link", rule_id: "NL-16", field: "project" });
  expect(escaping!.results[0]!.message).not.toContain("NL-16:");
});

test("a field problem is reported with its field and rule (QRY-3)", () => {
  const result = run(collection(), { specification_version: "0.1.0", note_types: ["project"], select: [{ kind: "path", as: "path" }] });
  expect(result.skipped_details).toEqual([
    { path: "Projects/Broken.md", results: [expect.objectContaining({ code: "invalid_field_value", field: "status" })] },
  ]);
});

test("a result with nothing left out has no reasons either", () => {
  const result = run(join(specification, "schema/fixtures/golden/query-pilot-valid/collection"), {
    specification_version: "0.1.0",
    select: [{ kind: "path", as: "path" }],
  });
  expect(result.skipped_details).toBeUndefined();
});

// Frontmatter that cannot be parsed has no type of its own, so a folder mapping makes it a candidate.
function brokenFrontmatter(severity?: string) {
  const root = collection();
  const defaults = severity ? `validation_defaults:\n  invalid_note_frontmatter: ${severity}\n` : "";
  writeFileSync(
    join(root, "typedmark.md"),
    `---\nspecification_version: 0.1.0\nname: broken-frontmatter\ndescription: Folder-mapped tasks.\n${defaults}note_type_mappings:\n  - {kind: frontmatter_field, field: note_type}\n  - {kind: folder, folder: Tasks/, note_type: task}\n---\n`,
  );
  writeFileSync(join(root, "Tasks/Unclosed.md"), "---\npriority: [\n---\n");
  writeFileSync(join(root, "Tasks/Sequence.md"), "---\n- a\n- b\n---\n");
  writeFileSync(join(root, "Tasks/Duplicate.md"), "---\npriority: 1\npriority: 2\n---\n");
  return run(root, { specification_version: "0.1.0", note_types: ["task"], select: [{ kind: "path", as: "path" }] });
}
const broken = ["Tasks/Duplicate.md", "Tasks/Sequence.md", "Tasks/Unclosed.md"];

test("a note whose frontmatter cannot be parsed is left out with the parser finding (CM-619, QRY-3)", () => {
  const result = brokenFrontmatter();
  expect(result.rows.map((row) => row.path)).toEqual(["Tasks/First.md", "Tasks/Second.md", "Tasks/Third.md"]);
  expect(result.skipped).toEqual(["Tasks/Duplicate.md", "Tasks/Escaping.md", "Tasks/Sequence.md", "Tasks/Unclosed.md"]);
  for (const detail of result.skipped_details!.filter((entry) => broken.includes(entry.path))) {
    expect(detail.results).toEqual([{ code: "invalid_note_frontmatter", rule_id: "MN-118", message: expect.any(String) }]);
    expect(detail.results[0]!.message).not.toBe("The note's frontmatter could not be resolved");
  }
  expect(result.skipped_details!.find((entry) => entry.path === "Tasks/Sequence.md")!.results[0]!.message).toContain("mapping");
});

test("a lowered frontmatter severity keeps the finding as the reason (QRY-3)", () => {
  for (const severity of ["warn", "info"]) {
    const result = brokenFrontmatter(severity);
    const unclosed = result.skipped_details!.find((entry) => entry.path === "Tasks/Unclosed.md")!;
    expect(unclosed.results).toEqual([{ code: "invalid_note_frontmatter", rule_id: "MN-118", message: expect.stringContaining("Flow sequence") }]);
  }
});

test("a frontmatter finding turned off still leaves the note out, with the generic reason (QRY-3)", () => {
  const result = brokenFrontmatter("off");
  expect(result.skipped).toContain("Tasks/Unclosed.md");
  for (const detail of result.skipped_details!.filter((entry) => broken.includes(entry.path)))
    expect(detail.results).toEqual([{ code: "invalid_note_frontmatter", rule_id: "MN-118", message: "The note's frontmatter could not be resolved" }]);
});

// Tasks typed by tag, a capture typed by folder, and notes whose frontmatter cannot be parsed (QRY-5 to QRY-7).
const unreadableVector = join(specification, "schema/fixtures/golden/query-unreadable-notes/collection");
const unreadableQuery = (note_types?: string[]) =>
  queryCollection({
    collectionRoot: unreadableVector,
    schemaDirectory,
    queryVersion: "0.1.0",
    query: { specification_version: "0.1.0", ...(note_types ? { note_types } : {}), select: [{ kind: "path", as: "path" }] },
  });

test("a note whose type cannot be known is reported apart, only where an admitted type stores notes (QRY-5, QRY-7)", () => {
  const all = unreadableQuery();
  expect(all.rows).toEqual([{ path: "Tasks/Open.md" }]);
  expect(all.skipped).toEqual(["Inbox/Broken.md"]);
  expect(all.unreadable?.map((detail) => detail.path)).toEqual(["Tasks/Duplicate.md", "Tasks/Unclosed.md"]);
  for (const detail of all.unreadable!) expect(detail.results[0]).toMatchObject({ code: "invalid_note_frontmatter", rule_id: "MN-118" });
  expect(unreadableQuery(["task"]).unreadable?.map((detail) => detail.path)).toEqual(["Tasks/Duplicate.md", "Tasks/Unclosed.md"]);
  expect(unreadableQuery(["capture"]).unreadable).toBeUndefined();
});

test("unreadable notes do not make the evaluation incomplete (QRY-6)", () => {
  expect(unreadableQuery(["task"]).evaluation).toBe("complete");
});
