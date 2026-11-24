import { afterEach, expect, test } from "bun:test";
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { markerArchived } from "../src/archive-markers";
import { applyEdit, planEdit } from "../src/edits";
import { queryCollection } from "../src/query";
import { planRetype } from "../src/retype";
import { validateCollection } from "../src/validator";

const schemaDirectory = resolve(import.meta.dir, "../../TypedMarkSpecification/schema/json-schema");
const roots: string[] = [];
afterEach(() => {
  for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true });
});

function write(root: string, path: string, content: string) {
  mkdirSync(dirname(join(root, path)), { recursive: true });
  writeFileSync(join(root, path), content);
}

const MARKERS = 'archive_markers:\n  - path: {under: "Archives/"}\n  - frontmatter: {tags: {contains_any: [archived]}}\n';
const PROJECT = [
  "---",
  "specification_version: 0.1.0",
  "description: A project, archived by year.",
  "storage:",
  "  folder_pattern: Projects",
  '  archive: {folder_pattern: "Archives/Projects/{date_archived:YYYY}"}',
  "frontmatter:",
  "  status: {type: text, nullable: false}",
  "  date_archived: {type: date, nullable: true}",
  "---",
  "",
].join("\n");

function collection(declared = true, markers = MARKERS) {
  const root = mkdtempSync(join(tmpdir(), "typedmark-archive-markers-"));
  roots.push(root);
  const extensions = declared ? 'extensions: {"typedmark:archive-markers": "0.1.0"}\n' : "";
  write(root, "typedmark.md", `---\nspecification_version: 0.1.0\nname: markers\ndescription: Archived by folder.\n${extensions}${markers}---\n`);
  write(root, ".typedmark/schemas/project.md", PROJECT);
  write(root, ".typedmark/schemas/task.md", PROJECT.replace("A project", "A task").replaceAll("Projects", "Tasks"));
  return root;
}
const note = (fields: string) => `---\nnote_type: project\n${fields}---\n`;

test("a matching marker archives an unstored note, and a stored value wins (ARC-6, ARC-7)", () => {
  const config = { extensions: { "typedmark:archive-markers": "0.1.0" }, archive_markers: [{ path: { under: "Archives/" } }] };
  expect(markerArchived(config, "Archives/Projects/2026/A.md", {})).toBe(true);
  expect(markerArchived(config, "Projects/A.md", {})).toBe(false);
  expect(markerArchived(config, "Archives/Projects/2026/A.md", { archived: false })).toBeUndefined();
  // Without the declaration, markers do not apply (ARC-3).
  expect(markerArchived({ archive_markers: config.archive_markers }, "Archives/A.md", {})).toBeUndefined();
  // Frontmatter predicates fail without frontmatter (CM-105).
  const tagged = { ...config, archive_markers: [{ frontmatter: { tags: { contains_any: ["archived"] } } }] };
  expect(markerArchived(tagged, "Projects/A.md", { tags: ["archived"] })).toBe(true);
  expect(markerArchived(tagged, "Projects/A.md", { tags: ["archived"] }, false)).toBe(false);
});

test("folder- and tag-archived notes select the archive storage, which still checks the year (ARC-8, ARC-9)", () => {
  const root = collection();
  write(root, "Projects/Launch.md", note("status: active\n"));
  write(root, "Archives/Projects/2026/Rollout.md", note("status: done\ndate_archived: 2026-11-04\n"));
  write(root, "Archives/Projects/2025/Late.md", note("status: done\ndate_archived: 2026-01-02\n"));
  write(root, "Archives/Projects/2026/Tagged.md", note("status: done\ndate_archived: 2026-03-01\ntags: [archived]\n"));
  write(root, "Archives/Projects/2026/Kept.md", note("archived: false\nstatus: done\ndate_archived: 2026-03-01\n"));
  const report = validateCollection({ collectionRoot: root, schemaDirectory });
  expect(report.evaluated_extensions).toEqual({ "typedmark:archive-markers": "0.1.0" });
  expect(report.results.map((result) => [result.path, result.rule_id])).toEqual([
    ["Archives/Projects/2025/Late.md", "NTS-146"],
    ["Archives/Projects/2026/Kept.md", "NTS-146"],
  ]);
  const query = (value: boolean) =>
    queryCollection({
      collectionRoot: root,
      schemaDirectory,
      queryVersion: "0.1.0",
      query: {
        specification_version: "0.1.0",
        where: { kind: "field", field: "archived", operator: "equals", value },
        select: [{ kind: "path", as: "path" }],
        order_by: [{ column: "path", direction: "asc" }],
      },
    }).rows.map((row) => row.path);
  expect(query(true)).toEqual(["Archives/Projects/2025/Late.md", "Archives/Projects/2026/Rollout.md", "Archives/Projects/2026/Tagged.md"]);
  expect(query(false)).toEqual(["Archives/Projects/2026/Kept.md", "Projects/Launch.md"]);
}, 60_000);

test("undeclared markers are reported and ignored; a bad pattern stops association (ARC-2, ARC-3)", () => {
  const undeclared = collection(false);
  write(undeclared, "Archives/Projects/2026/Rollout.md", note("status: done\ndate_archived: 2026-11-04\n"));
  const report = validateCollection({ collectionRoot: undeclared, schemaDirectory });
  expect(report.results.map((result) => [result.path, result.rule_id])).toEqual([
    ["Archives/Projects/2026/Rollout.md", "NTS-146"],
    ["typedmark.md", "EXT-16"],
  ]);
  const broken = collection(true, 'archive_markers:\n  - path: {regex: "("}\n');
  write(broken, "Projects/Launch.md", note("status: active\n"));
  const brokenReport = validateCollection({ collectionRoot: broken, schemaDirectory });
  expect(brokenReport.results.map((result) => [result.code, result.rule_id])).toEqual([["invalid_collection_configuration", "FND-31"]]);
  expect(brokenReport.evaluation).toBe("incomplete");
});

test("re-filing keeps a marker-archived note in its archive, and leaving every marker stores archived (ARC-10 to ARC-12)", () => {
  const root = collection();
  write(root, "Archives/Projects/2026/Rollout.md", note("status: done\ndate_archived: 2026-11-04\n"));
  // An edit to a value the archive storage reads re-files the note under the archive contract.
  const refile = planEdit(root, schemaDirectory, { path: "Archives/Projects/2026/Rollout.md", set: { date_archived: "2025-12-30" } });
  expect(refile.unresolved).toEqual([]);
  expect(refile.moves).toEqual([{ from: "Archives/Projects/2026/Rollout.md", to: "Archives/Projects/2025/Rollout.md" }]);
  // Still under a marker: archived is not written.
  expect(refile.files[0]!.content).not.toContain("archived: true");
  // A move out of every marker stores the archived state.
  const out = planEdit(root, schemaDirectory, { path: "Archives/Projects/2026/Rollout.md", renameTo: "Old/Rollout.md" });
  expect(out.unresolved).toEqual([]);
  expect(out.files[0]!.path).toBe("Old/Rollout.md");
  expect(out.files[0]!.content).toContain("archived: true");
  // Asking to unarchive stores the caller's value instead.
  const unarchive = planEdit(root, schemaDirectory, { path: "Archives/Projects/2026/Rollout.md", set: { archived: false } });
  expect(unarchive.moves).toEqual([{ from: "Archives/Projects/2026/Rollout.md", to: "Projects/Rollout.md" }]);
  expect(unarchive.files[0]!.content).toContain("archived: false");
  applyEdit(root, out);
  expect(readFileSync(join(root, "Old/Rollout.md"), "utf8")).toContain("archived: true");
});

test("re-typing a marker-archived note files it under the target's archive contract (ARC-11)", () => {
  const root = collection();
  write(root, "Archives/Projects/2026/Rollout.md", note("status: done\ndate_archived: 2026-11-04\n"));
  const plan = planRetype(root, schemaDirectory, "Archives/Projects/2026/Rollout.md", "task");
  expect(plan.unresolved).toEqual([]);
  expect(plan.targetPath).toBe("Archives/Tasks/2026/Rollout.md");
});
