import { expect, test } from "bun:test";
import { join, resolve } from "node:path";
import { readCollectionModel } from "../src/validator";
import { SchemaRegistry } from "../src/schema-registry";
import { validateViews } from "../src/views";
import { arrangeTree, treeMove, viewTree, type TreeNode } from "../src/tree-views";

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
