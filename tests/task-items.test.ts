import { afterEach, expect, test } from "bun:test";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { stringify } from "yaml";
import { evaluateQueryWithColumns, type Descriptor } from "../src/query-engine";
import { taskItems } from "../src/task-items";
import { readCollectionModel, validateCollection } from "../src/validator";

const specification = resolve(import.meta.dir, "../../TypedMarkSpecification");
const schemaDirectory = join(specification, "schema/json-schema");
const roots: string[] = [];
afterEach(() => {
  for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true });
});

test("task items follow the CommonMark block structure and count file lines (ITM-6 to ITM-12)", () => {
  const body = ["# Plan", "- [ ]\tTabbed", "- [🔥] Hot  ", "<div>", "- [ ] In HTML", "</div>", "", "* [x] Done\r", "  1. [ ] Nested"].join("\n");
  expect(taskItems(body, 4)).toEqual([
    { text: "Tabbed", status: " ", checked: false, line: 5, depth: 0, parent_line: null, heading: "Plan" },
    { text: "Hot", status: "🔥", checked: true, line: 6, depth: 0, parent_line: null, heading: "Plan" },
    { text: "Done", status: "x", checked: true, line: 11, depth: 0, parent_line: null, heading: "Plan" },
    { text: "Nested", status: " ", checked: false, line: 12, depth: 1, parent_line: 11, heading: "Plan" },
  ]);
  // A paragraph that only continues on the item's next line, and brackets without a status, are not items.
  expect(taskItems("-\n  [ ] Later line\n- [ab] Two\n- [ ]x")).toEqual([]);
});

test("item rows carry their line, and item predicates stay out of related notes (ITM-14, ITM-17)", () => {
  const collectionRoot = join(specification, "schema/fixtures/golden/task-items-valid/collection");
  const model = readCollectionModel({ collectionRoot, schemaDirectory });
  const query: Descriptor = {
    specification_version: "0.1.0",
    note_types: ["project"],
    rows: "items",
    select: [{ kind: "item", property: "text", as: "text" }],
  };
  const evaluation = evaluateQueryWithColumns(model, query);
  expect(evaluation.result.rows).toEqual([{ text: "Book the venue" }, { text: "Brief [[2026-10-30]] about [[Launch]], [[Missing]] and [[2026-10-30|today]]" }]);
  expect(evaluation).toMatchObject({ paths: ["Projects/Launch.md", "Projects/Launch.md"], lines: [4, 5] });
  const related = {
    ...query,
    where: { kind: "relationship", relationship: "related_to", where: { kind: "item", property: "checked", operator: "equals", value: true } },
  } as unknown as Descriptor;
  expect(() => evaluateQueryWithColumns(model, related)).toThrow("ITM-14");
  expect(() => evaluateQueryWithColumns(model, { ...query, rows: undefined })).toThrow("ITM-14");
});

test("a saved view over item rows needs the items declaration (EXT-16)", () => {
  const root = mkdtempSync(join(tmpdir(), "typedmark-items-"));
  roots.push(root);
  const write = (path: string, data: unknown, body = "") => {
    mkdirSync(dirname(join(root, path)), { recursive: true });
    writeFileSync(join(root, path), `---\n${stringify(data)}---\n${body}`);
  };
  write("typedmark.md", {
    specification_version: "0.1.0",
    name: "items",
    description: "Items.",
    extensions: { "typedmark:queries": "0.1.0", "typedmark:views": "0.1.0" },
  });
  write(".typedmark/schemas/note.md", { specification_version: "0.1.0", description: "Note.", storage: { folder_pattern: "Notes" } });
  write("Notes/A.md", { note_type: "note" }, "- [ ] One\n");
  write(".typedmark/views/items.md", {
    specification_version: "0.1.0",
    view: "items",
    description: "Items.",
    query: { specification_version: "0.1.0", rows: "items", select: [{ kind: "item", property: "text", as: "text" }] },
    presentation: { layout: "list", fields: [{ column: "text" }] },
  });
  const report = validateCollection({ collectionRoot: root, schemaDirectory });
  expect(report.results).toContainEqual(expect.objectContaining({ rule_id: "EXT-16", extension: "typedmark:items", path: ".typedmark/views/items.md" }));
});

test("item links hold each resolved managed note once and match by containment (ITM-16, ITM-19)", () => {
  const collectionRoot = join(specification, "schema/fixtures/golden/task-items-valid/collection");
  const model = readCollectionModel({ collectionRoot, schemaDirectory });
  const query = (where: unknown): Descriptor =>
    ({
      specification_version: "0.1.0",
      rows: "items",
      where,
      select: [{ kind: "item", property: "links", as: "links" }],
    }) as Descriptor;
  const both = { kind: "item", property: "links", operator: "contains_all", value: ["Daily/2026-10-30.md", "Projects/Launch.md"] };
  expect(evaluateQueryWithColumns(model, query(both)).result.rows).toEqual([{ links: ["Daily/2026-10-30.md", "Projects/Launch.md"] }]);
  const missing = { kind: "item", property: "links", operator: "contains_all", value: ["Daily/2026-10-30.md", "Missing.md"] };
  expect(evaluateQueryWithColumns(model, query(missing)).result.rows).toEqual([]);
  expect(() => evaluateQueryWithColumns(model, query({ kind: "item", property: "text", operator: "contains_any", value: ["x"] }))).toThrow("ITM-16");
  expect(() => evaluateQueryWithColumns(model, query({ kind: "item", property: "links", operator: "contains_any", value: ["Launch"] }))).toThrow("ITM-16");
  const ordered = { ...query(undefined), order_by: [{ column: "links" }] } as Descriptor;
  expect(() => evaluateQueryWithColumns(model, ordered)).toThrow("CM-374");
});
