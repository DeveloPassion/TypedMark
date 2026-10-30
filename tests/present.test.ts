import { afterEach, expect, test } from "bun:test";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { stringify } from "yaml";
import { presentView, renderPresentation } from "../src/present";

const specification = resolve(import.meta.dir, "../../TypedMarkSpecification");
const schemaDirectory = join(specification, "schema/json-schema");
const golden = (name: string) => join(specification, "schema/fixtures/golden", name, "collection");
const roots: string[] = [];
afterEach(() => {
  for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true });
});

function collection(views: Record<string, unknown>) {
  const root = mkdtempSync(join(tmpdir(), "typedmark-present-"));
  roots.push(root);
  const write = (path: string, data: unknown) => {
    mkdirSync(dirname(join(root, path)), { recursive: true });
    writeFileSync(join(root, path), `---\n${stringify(data)}---\n`);
  };
  write("typedmark.md", {
    specification_version: "0.1.0",
    name: "present",
    description: "Presentation.",
    extensions: { "typedmark:queries": "0.1.0", "typedmark:views": "0.1.0" },
  });
  write(".typedmark/schemas/task.md", {
    specification_version: "0.1.0",
    description: "Task.",
    storage: { folder_pattern: "Tasks" },
    frontmatter: { status: { type: "text", nullable: true }, area: { type: "text", nullable: true }, rank: { type: "number", nullable: true } },
  });
  const tasks: Array<[string, string | null, string | null, number | null]> = [
    ["A", "todo", "home", 2],
    ["B", "done", null, null],
    ["C", "todo", "home", 1],
    ["D", "blocked", "work", null],
  ];
  for (const [name, status, area, rank] of tasks) write(`Tasks/${name}.md`, { note_type: "task", status, area, rank });
  for (const [id, data] of Object.entries(views))
    write(`.typedmark/views/${id}.md`, { specification_version: "0.1.0", view: id, description: "A view.", ...(data as object) });
  return root;
}
const query = {
  specification_version: "0.1.0",
  note_types: ["task"],
  select: [
    { kind: "path", as: "path" },
    { kind: "field", field: "status", as: "status" },
    { kind: "field", field: "area", as: "area" },
    { kind: "field", field: "rank", as: "rank" },
  ],
};

test("a board fills declared columns by rank, then an unmapped column, per lane (CM-439 to CM-444, CM-570, CM-578)", () => {
  const root = collection({
    board: {
      query,
      presentation: {
        layout: "board",
        fields: [{ column: "path" }],
        board: { column: "status", columns: [{ value: "todo", label: "To do" }, { value: "done" }], rank: "rank", lanes: { column: "area" } },
      },
    },
  });
  const board = presentView(root, schemaDirectory, "board");
  const outline = board.lanes!.map((lane) => [lane.label, lane.columns.map((column) => [column.label, column.rows.map((row) => row.path)])]);
  expect(outline).toEqual([
    [
      "home",
      [
        ["To do", ["Tasks/C.md", "Tasks/A.md"]],
        ["done", []],
      ],
    ],
    [
      "work",
      [
        ["To do", []],
        ["done", []],
        ["Other", ["Tasks/D.md"]],
      ],
    ],
    [
      "None",
      [
        ["To do", []],
        ["done", ["Tasks/B.md"]],
      ],
    ],
  ]);
  expect(renderPresentation(board)).toContain("# home\n\n## To do (2)\n- Tasks/C.md\n- Tasks/A.md\n");
});

test("grouped lists keep each group's own rows, and cards print every field (CM-430 to CM-432)", () => {
  const root = collection({
    grouped: { query: { ...query, group_by: ["status"] }, presentation: { layout: "list", fields: [{ column: "path" }, { column: "area", label: "Area" }] } },
    cards: { query, presentation: { layout: "cards", fields: [{ column: "path" }, { column: "status", label: "Status" }] } },
  });
  const grouped = presentView(root, schemaDirectory, "grouped");
  expect(grouped.groups!.map((group) => [group.key, group.rows.map((row) => row.path)])).toEqual([
    [["todo"], ["Tasks/A.md", "Tasks/C.md"]],
    [["done"], ["Tasks/B.md"]],
    [["blocked"], ["Tasks/D.md"]],
  ]);
  expect(renderPresentation(grouped)).toContain("## todo\n- Tasks/A.md  ·  Area: home\n- Tasks/C.md  ·  Area: home\n");
  expect(renderPresentation(presentView(root, schemaDirectory, "cards"))).toContain("path: Tasks/A.md\nStatus: todo\n\npath: Tasks/B.md");
});

test("trees present context rows on their own note and mark rolled-up values (CM-592, CM-616)", () => {
  const tree = presentView(golden("tree-view-valid"), schemaDirectory, "work-breakdown");
  expect(tree.tree![0]).toMatchObject({ path: "Projects/Launch.md", context: true, values: { path: "Projects/Launch.md" } });
  const rolled = presentView(golden("tree-rollups-valid"), schemaDirectory, "breakdown");
  expect(rolled.tree![0]!.derived.length).toBeGreaterThan(0);
  expect(renderPresentation(rolled).split("\n")[2]).toContain("*");
});

test("calendars and timelines read in the collection timezone, and item rows stay distinct (CM-598, CM-602, ITM-2)", () => {
  const calendar = presentView(golden("calendar-views-valid"), schemaDirectory, "task-calendar");
  expect(calendar.days!.map((day) => [day.day, day.entries.map((entry) => `${entry.dimension}:${entry.path}`)])).toEqual([
    ["2026-10-28", ["Due:Tasks/Review.md", "Scheduled:Tasks/Write.md"]],
    ["2026-10-30", ["Due:Tasks/Write.md"]],
  ]);
  expect(renderPresentation(presentView(golden("calendar-views-valid"), schemaDirectory, "plan"))).toContain("- 2026-10-26 → 2026-10-30  Tasks/Write.md");
  const items = presentView(golden("task-items-valid"), schemaDirectory, "open-items");
  expect(items.rows!.map((row) => `${row.path}:${row.line}`)).toEqual([
    "Daily/2026-10-29.md:5",
    "Daily/2026-10-30.md:9",
    "Daily/2026-10-30.md:12",
    "Daily/2026-10-30.md:21",
    "Daily/2026-10-30.md:26",
  ]);
});

test("an invalid or unknown view is reported, not partly shown", () => {
  expect(() => presentView(golden("task-items-invalid"), schemaDirectory, "energy-board")).toThrow("ITM-18");
  expect(() => presentView(golden("task-items-valid"), schemaDirectory, "missing")).toThrow("CM-409");
});
