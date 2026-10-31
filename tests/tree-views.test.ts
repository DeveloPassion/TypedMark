import { expect, test } from "bun:test";
import { join, resolve } from "node:path";
import { readCollectionModel } from "../src/validator";
import { SchemaRegistry } from "../src/schema-registry";
import { validateViews } from "../src/views";
import { evaluateQueryWithColumns } from "../src/query-engine";
import { arrangeTree, rollUp, treeListMove, treeMove, viewRollups, viewTree, type RolledNode, type TreeNode } from "../src/tree-views";

const specification = resolve(import.meta.dir, "../../TypedMarkSpecification");
const schemaDirectory = join(specification, "schema/json-schema");

// Paths with context rows marked, indented by depth.
function outline(forest: TreeNode[], depth = 0): string[] {
  return forest.flatMap((node) => [`${"  ".repeat(depth)}${node.path}${node.context ? " (context)" : ""}`, ...outline(node.children, depth + 1)]);
}

test("rows sit under every parent in query order, cutting cycles (CM-586 to CM-589)", () => {
  const forest = arrangeTree([
    { path: "b", parents: [] },
    { path: "a", parents: [] },
    { path: "c", parents: ["a", "b", "c"] },
    { path: "x", parents: ["y"] },
    { path: "y", parents: ["x", "outside"] },
  ]);
  expect(outline(forest)).toEqual(["b", "  c", "a", "  c", "x", "  y"]);
});

test("context ancestors take their earliest descendant's position (CM-591, CM-592)", () => {
  const above: Record<string, string[]> = { project: ["area"], area: [], other: [] };
  const rows = [
    { path: "first", parents: [] },
    { path: "task", parents: ["project"] },
    { path: "late", parents: ["other"] },
  ];
  const contextParents = (path: string) => above[path];
  expect(outline(arrangeTree(rows, { context: "ancestors", contextParents }))).toEqual([
    "first",
    "area (context)",
    "  project (context)",
    "    task",
    "other (context)",
    "  late",
  ]);
  expect(outline(arrangeTree(rows, { contextParents }))).toEqual(["first", "task", "late"]);
  expect(outline(arrangeTree(rows, { context: "ancestors", contextParents: () => undefined }))).toEqual(["first", "task", "late"]);
});

test("the golden tree views resolve parents through note links", () => {
  const collectionRoot = join(specification, "schema/fixtures/golden/tree-view-valid/collection");
  const model = readCollectionModel({ collectionRoot, schemaDirectory });
  const views = validateViews(collectionRoot, ".typedmark", model, new SchemaRegistry(schemaDirectory));
  expect(views.results).toEqual([]);
  const tree = (id: string, context?: "ancestors") => {
    const source = views.sources.get(`view:${id}`)!;
    return viewTree(model, source.query!, source.evaluation!, { parent: id === "work-breakdown" ? "parent" : "parents", context });
  };
  expect(outline(tree("work-breakdown", "ancestors"))).toEqual(["Projects/Launch.md (context)", "  Tasks/Design.md", "    Tasks/Sketch.md"]);
  expect(outline(tree("shared-work"))).toEqual(["Tasks/Design.md", "  Tasks/Sketch.md", "    Tasks/Review.md"]);
});

test("moves write or remove the parent link and refuse cycles and context rows (CM-594, CM-595)", () => {
  const forest = arrangeTree(
    [
      { path: "Tasks/Design.md", parents: ["Projects/Launch.md"] },
      { path: "Tasks/Sketch.md", parents: ["Tasks/Design.md"] },
      { path: "Tasks/Review.md", parents: [] },
    ],
    { context: "ancestors", contextParents: () => [] },
  );
  expect(treeMove(forest, "parent", "Tasks/Review.md", "Tasks/Sketch.md")).toEqual({ kind: "set_field", field: "parent", value: "[[Tasks/Sketch]]" });
  expect(treeMove(forest, "parent", "Tasks/Review.md", "Projects/Launch.md")).toEqual({ kind: "set_field", field: "parent", value: "[[Projects/Launch]]" });
  expect(treeMove(forest, "parent", "Tasks/Design.md", null)).toEqual({ kind: "unset_field", field: "parent" });
  expect(() => treeMove(forest, "parent", "Tasks/Design.md", "Tasks/Sketch.md")).toThrow("CM-595");
  expect(() => treeMove(forest, "parent", "Tasks/Design.md", "Tasks/Design.md")).toThrow("CM-595");
  expect(() => treeMove(forest, "parent", "Projects/Launch.md", null)).toThrow("CM-595");
});

test("a list move changes one occurrence in its slot and keeps the other parents (CM-617, CM-618)", () => {
  const forest = arrangeTree(
    [
      { path: "goal", parents: [] },
      { path: "alpha", parents: [] },
      { path: "beta", parents: [] },
      { path: "task", parents: ["alpha", "outside", "beta"] },
      { path: "loose", parents: [] },
    ],
    { context: "ancestors", contextParents: () => [] },
  );
  const items = ["[[alpha]]", "[[outside]]", "[[beta]]"];
  const resolve = (item: unknown) => String(item).slice(2, -2);
  const move = (from: string | null, to: string | null, list = items) => treeListMove(forest, "parents", "task", from, to, list, resolve);
  expect(move("alpha", "goal")).toEqual({ kind: "set_field", field: "parents", value: ["[[goal]]", "[[outside]]", "[[beta]]"] });
  expect(move("beta", "goal")).toEqual({ kind: "set_field", field: "parents", value: ["[[alpha]]", "[[outside]]", "[[goal]]"] });
  // The target is already a parent: only the old parent's items go, duplicates included.
  expect(move("alpha", "beta", ["[[alpha]]", "[[beta]]", "[[alpha]]"])).toEqual({ kind: "set_field", field: "parents", value: ["[[beta]]"] });
  // Duplicates of the old parent collapse into the one slot.
  expect(move("alpha", "goal", ["[[alpha]]", "[[beta]]", "[[alpha]]"])).toEqual({ kind: "set_field", field: "parents", value: ["[[goal]]", "[[beta]]"] });
  expect(move("alpha", null)).toEqual({ kind: "set_field", field: "parents", value: ["[[outside]]", "[[beta]]"] });
  expect(move("alpha", null, ["[[alpha]]"])).toEqual({ kind: "unset_field", field: "parents" });
  expect(move("alpha", "alpha")).toEqual({ kind: "set_field", field: "parents", value: items });
  expect(treeListMove(forest, "parents", "loose", null, "goal", [], resolve)).toEqual({ kind: "set_field", field: "parents", value: ["[[goal]]"] });
  expect(() => move("goal", "beta")).toThrow("CM-617");
  expect(() => move(null, "goal")).toThrow("CM-617");
  expect(() => treeListMove(forest, "parents", "alpha", null, "task", ["[[x]]"], resolve)).toThrow("CM-595");
});

// Rolled-up values per occurrence, with derived values marked.
function rolled(forest: RolledNode[], depth = 0): string[] {
  return forest.flatMap((node) => [
    `${"  ".repeat(depth)}${node.path} ${Object.entries(node.values)
      .map(([column, { value, derived }]) => `${column}=${value}${derived ? "*" : ""}`)
      .join(" ")}`,
    ...rolled(node.children, depth + 1),
  ]);
}

test("the golden breakdown counts a shared task once, weights progress and finishes done rows (CM-612 to CM-615)", () => {
  const collectionRoot = join(specification, "schema/fixtures/golden/tree-rollups-valid/collection");
  const model = readCollectionModel({ collectionRoot, schemaDirectory });
  const views = validateViews(collectionRoot, ".typedmark", model, new SchemaRegistry(schemaDirectory));
  expect(views.results).toEqual([]);
  const source = views.sources.get("view:breakdown")!;
  const forest = viewTree(model, source.query!, source.evaluation!, { parent: "parent" });
  const rollups = [
    { column: "path", aggregate: "count" as const },
    { column: "estimate", aggregate: "sum" as const },
    { column: "progress", aggregate: "weighted_mean" as const, weight: "estimate", state: "status", done_value: 100 },
  ];
  expect(rolled(viewRollups(model, source.query!, source.evaluation!, forest, rollups))).toEqual([
    // Shared sits under Ops and Review but counts once for Launch: 6, not 8.
    "Tasks/Launch.md path=6* estimate=6* progress=50*",
    "  Tasks/Build.md path=1 estimate=3 progress=50",
    "  Tasks/Docs.md path=1 estimate=1 progress=100",
    "  Tasks/Ops.md path=2* estimate=2* progress=25*",
    "    Tasks/Shared.md path=1 estimate=2 progress=25",
    "  Tasks/Review.md path=2* estimate=2* progress=25*",
    "    Tasks/Shared.md path=1 estimate=2 progress=25",
  ]);
});

test("own values win, context rows are not counted, and zero weights fall back to the plain mean (CM-612 to CM-614)", () => {
  const forest = arrangeTree(
    [
      { path: "a", parents: ["ctx"] },
      { path: "b", parents: ["ctx"] },
      { path: "c", parents: ["owned"] },
      { path: "owned", parents: [] },
    ],
    { context: "ancestors", contextParents: () => [] },
  );
  const values: Record<string, Record<string, unknown>> = {
    a: { score: 2, size: 0 },
    b: { score: 6, size: null },
    c: { score: 9, size: 1 },
    owned: { score: 1, size: 5 },
    ctx: { score: null, size: null },
  };
  const own = (path: string, column: string) => values[path]![column] ?? null;
  const rollups = (aggregate: "min" | "max" | "count" | "weighted_mean") => [
    { column: "score", aggregate, ...(aggregate === "weighted_mean" ? { weight: "size" } : {}) },
  ];
  expect(rolled(rollUp(forest, rollups("weighted_mean"), own, () => false))).toEqual([
    "ctx score=4*",
    "  a score=2",
    "  b score=6",
    "owned score=1",
    "  c score=9",
  ]);
  expect(rolled(rollUp(forest, rollups("min"), own, () => false))[0]).toBe("ctx score=2*");
  expect(rolled(rollUp(forest, rollups("max"), own, () => false))[0]).toBe("ctx score=6*");
  expect(rolled(rollUp(forest, rollups("count"), own, () => false))).toEqual(["ctx score=2*", "  a score=1", "  b score=1", "owned score=2*", "  c score=1"]);
});

test("a mapped parent reads each type's own field, for result and context rows (CM-583, CM-591)", () => {
  const collectionRoot = join(specification, "schema/fixtures/golden/tree-view-valid/collection");
  const model = readCollectionModel({ collectionRoot, schemaDirectory });
  const views = validateViews(collectionRoot, ".typedmark", model, new SchemaRegistry(schemaDirectory));
  const source = views.sources.get("view:goal-breakdown")!;
  const tasksOnly = { ...source.query!, note_types: ["task"] };
  const evaluation = evaluateQueryWithColumns(model, tasksOnly);
  // Launch's own parent is read through the project mapping, so the goal shows above it.
  expect(outline(viewTree(model, tasksOnly, evaluation, { parent: "parent", context: "ancestors" }))).toEqual([
    "Goals/Grow.md (context)",
    "  Projects/Launch.md (context)",
    "    Tasks/Design.md",
    "      Tasks/Sketch.md",
    "    Tasks/Review.md",
  ]);
});
