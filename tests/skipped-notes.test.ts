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
