import { afterEach, expect, test } from "bun:test";
import { dirname, join, resolve } from "node:path";
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { stringify } from "yaml";
import { parseMarkdown } from "../src/frontmatter";
import { validateCollection } from "../src/validator";

const schemaDirectory = resolve(import.meta.dir, "../../TypedMarkSpecification/schema/json-schema");
const roots: string[] = [];
const query = { specification_version: "0.1.0", note_types: ["note"], select: [
  { kind: "path", as: "path" }, { kind: "field", field: "status", as: "status" }, { kind: "field", field: "score", as: "score" },
] };
const dataset = { specification_version: "0.1.0", dataset: "notes", description: "Notes.", row_identity: "path", query };
const view = { specification_version: "0.1.0", view: "notes", description: "Notes.", dataset: "notes", presentation: {
  layout: "table", fields: [{ column: "path" }, { column: "status" }],
} };

function write(root: string, path: string, data: unknown, body = "") {
  mkdirSync(dirname(join(root, path)), { recursive: true });
  writeFileSync(join(root, path), `---\n${stringify(data)}---\n${body}`);
}
function collection() {
  const root = mkdtempSync(join(tmpdir(), "typedmark-views-")); roots.push(root);
  write(root, "typedmark.md", { specification_version: "0.1.0", name: "views", description: "Views.", extensions: { "typedmark:queries": "0.1.0", "typedmark:views": "0.1.0" } });
  write(root, ".typedmark/schemas/note.md", { specification_version: "0.1.0", description: "Note.",
    storage: { folder_pattern: "Notes", note_name_pattern: "{title}" },
    frontmatter: { status: { type: "text", nullable: true }, score: { type: "number", nullable: true } },
  });
  write(root, "Notes/A.md", { note_type: "note", status: "open", score: 1 });
  write(root, "Notes/B.md", { note_type: "note", status: "closed", score: 2 });
  return root;
}
const run = (root: string) => validateCollection({ collectionRoot: root, schemaDirectory });
afterEach(() => { for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true }); });

test("validates a dataset, a referencing view, and an embedded query as complete without writes", () => {
  const root = collection();
  write(root, ".typedmark/datasets/notes.md", dataset);
  write(root, ".typedmark/views/notes.md", view);
  write(root, ".typedmark/views/embedded.md", { ...view, view: "embedded", dataset: undefined, query });
  const before = readFileSync(join(root, ".typedmark/datasets/notes.md"));
  expect(run(root)).toMatchObject({ evaluation: "complete", valid: true, evaluated_extensions: { "typedmark:queries": "0.1.0", "typedmark:views": "0.1.0" }, results: [] });
  expect(readFileSync(join(root, ".typedmark/datasets/notes.md"))).toEqual(before);
});

test.each([
  [{ row_identity: "missing" }, "CM-508"],
  [{ query: { ...query, specification_version: "0.1.1" } }, "CM-506"],
  [{ query: { ...query, order_by: [{ column: "missing" }] } }, "CM-369"],
  [{ query: { ...query, where: { kind: "field", field: "score", operator: "regex", value: "x" } } }, "CM-345"],
])("reports dataset contract failures: %j", (override, rule) => {
  const root = collection(); write(root, ".typedmark/datasets/notes.md", { ...dataset, ...override });
  expect(run(root).results).toContainEqual(expect.objectContaining({ code: "invalid_dataset", path: ".typedmark/datasets/notes.md", dataset: "notes", rule_id: rule }));
});

test.each(["duplicate", "null"])("rejects %s dataset identities", (kind) => {
  const root = collection();
  write(root, "Notes/B.md", { note_type: "note", status: kind === "duplicate" ? "open" : null });
  write(root, ".typedmark/datasets/notes.md", { ...dataset, row_identity: "status" });
  expect(run(root).results).toContainEqual(expect.objectContaining({ code: "invalid_dataset", rule_id: kind === "duplicate" ? "CM-510" : "CM-509" }));
});

test("does not hide an absent non-nullable projected value behind its Core default", () => {
  const root = collection();
  write(root, ".typedmark/schemas/note.md", { specification_version: "0.1.0", description: "Note.", storage: { folder_pattern: "Notes", note_name_pattern: "{title}" },
    frontmatter: { status: { type: "text", nullable: true }, score: { type: "number", default_value: 5 } },
  });
  write(root, "Notes/B.md", { note_type: "note", status: "closed" });
  write(root, ".typedmark/datasets/notes.md", dataset);
  expect(run(root).results).toContainEqual(expect.objectContaining({ code: "invalid_dataset", rule_id: "CM-529" }));
});

test.each([
  [{ dataset: "missing" }, "CM-520"],
  [{ presentation: { layout: "table", fields: [{ column: "missing" }] } }, "CM-425"],
  [{ presentation: { layout: "table", fields: [{ column: "path" }, { column: "path" }] } }, "CM-426"],
  [{ dataset: undefined, query: { ...query, specification_version: "0.1.1" } }, "CM-420"],
])("reports view contract failures: %j", (override, rule) => {
  const root = collection(); write(root, ".typedmark/datasets/notes.md", dataset); write(root, ".typedmark/views/notes.md", { ...view, ...override });
  expect(run(root).results).toContainEqual(expect.objectContaining({ code: "invalid_view", view: "notes", rule_id: rule }));
});

test.each([
  [[{ value: "open" }, { value: "closed" }, { value: "empty" }], undefined],
  [[{ value: "é" }, { value: "e\u0301" }], "CM-438"],
  [[{ value: 123 }], "CM-437"],
])("validates board values against the typed column contract: %j", (columns, rule) => {
  const root = collection(); write(root, ".typedmark/datasets/notes.md", dataset);
  write(root, ".typedmark/views/notes.md", { ...view, presentation: { layout: "board", fields: [{ column: "path" }], board: { column: "status", columns } } });
  const report = run(root);
  if (rule) expect(report.results).toContainEqual(expect.objectContaining({ code: "invalid_view", rule_id: rule }));
  else expect(report).toMatchObject({ evaluation: "complete", valid: true, results: [] });
});

test("keeps deliberately excluded query evaluation incomplete", () => {
  const root = collection(); write(root, ".typedmark/datasets/notes.md", dataset);
  const report = validateCollection({ collectionRoot: root, schemaDirectory, supportedExtensions: { "typedmark:views": "0.1.0" } });
  expect(report).toMatchObject({ evaluation: "incomplete", valid: false });
  expect(report.evaluated_extensions).not.toHaveProperty("typedmark:queries");
  expect(report.evaluated_extensions).not.toHaveProperty("typedmark:views");
});

test("does not claim complete query interpretation for an unsupported owning surface", () => {
  const root = collection();
  write(root, "typedmark.md", { specification_version: "0.1.0", name: "views", description: "Views.", extensions: {
    "typedmark:queries": "0.1.0", "typedmark:views": "0.1.0", "typedmark:expansion": "0.1.0", "typedmark:expressions": "0.1.0",
  } });
  write(root, ".typedmark/datasets/notes.md", dataset);
  const report = run(root);
  expect(report).toMatchObject({ evaluation: "incomplete", valid: false });
  expect(report.evaluated_extensions).not.toHaveProperty("typedmark:queries");
  expect(report.results.filter((result) => result.code === "unsupported_extension").map((result) => result.extension))
    .toEqual(["typedmark:expansion", "typedmark:expressions"]);
});

test("reports an unavailable reused model without inventing invalid dataset fields", () => {
  const root = collection();
  const config = parseMarkdown(readFileSync(join(root, "typedmark.md"), "utf8")).data as Record<string, any>;
  config.extensions["typedmark:reuse"] = "0.1.0"; write(root, "typedmark.md", config);
  const schema = parseMarkdown(readFileSync(join(root, ".typedmark/schemas/note.md"), "utf8")).data;
  write(root, ".typedmark/schemas/note.md", { ...schema, extends: "base" });
  write(root, ".typedmark/schemas/base.md", { specification_version: "0.1.0", description: "Base.", abstract: true, frontmatter: { inherited: { type: "text", nullable: true } } });
  write(root, ".typedmark/datasets/notes.md", { ...dataset, query: { ...query, select: [{ kind: "path", as: "path" }, { kind: "field", field: "inherited", as: "inherited" }] } });
  const report = run(root);
  expect(report.evaluation).toBe("incomplete");
  expect(report.results.filter((result) => result.code === "invalid_dataset")).toEqual([]);
  expect(report.results.filter((result) => result.code === "unsupported_extension").map((result) => result.extension)).toEqual(["typedmark:reuse"]);
  expect(report.evaluated_extensions).not.toHaveProperty("typedmark:views");
});

test("marks best-effort artifacts incomplete even when their shape fails first", () => {
  const root = collection();
  write(root, ".typedmark/datasets/notes.md", { ...dataset, specification_version: "0.1.1", description: undefined });
  const report = run(root);
  expect(report.evaluation).toBe("incomplete");
  expect(report.results).toContainEqual(expect.objectContaining({ code: "invalid_dataset", rule_id: "CM-499" }));
});

test("does not reclassify an unsupported Core version as an invalid dataset", () => {
  const root = collection();
  const config = parseMarkdown(readFileSync(join(root, "typedmark.md"), "utf8")).data;
  write(root, "typedmark.md", { ...config, specification_version: "0.0.1" });
  write(root, ".typedmark/datasets/notes.md", dataset);
  const report = run(root);
  expect(report.evaluation).toBe("incomplete");
  expect(report.results).toContainEqual(expect.objectContaining({ code: "unsupported_specification_version", rule_id: "FND-92" }));
  expect(report.results.filter((result) => result.code === "invalid_dataset")).toEqual([]);
  expect(report.results.filter((result) => result.code === "unsupported_specification_version").map((result) => result.path)).toEqual(["typedmark.md"]);
});

test.each(["0.2.bad", "0.1.bad"])("treats malformed owner version %s as invalid data", (version) => {
  const root = collection(); write(root, ".typedmark/datasets/notes.md", { ...dataset, specification_version: version });
  const report = run(root);
  expect(report).toMatchObject({ evaluation: "complete", valid: false });
  expect(report.results).toContainEqual(expect.objectContaining({ code: "invalid_dataset", rule_id: "CM-499" }));
  expect(report.results.some((result) => result.code === "unsupported_specification_version")).toBe(false);
});

test("reports an independently known query/owner version mismatch before compatibility negotiation", () => {
  const root = collection(); write(root, ".typedmark/datasets/notes.md", { ...dataset, query: { ...query, specification_version: "0.2.0" } });
  expect(run(root).results).toContainEqual(expect.objectContaining({ code: "invalid_dataset", rule_id: "CM-506" }));
});

test("requires explicit mappings for heterogeneous dataset columns", () => {
  const root = collection();
  const schema = parseMarkdown(readFileSync(join(root, ".typedmark/schemas/note.md"), "utf8")).data as Record<string, any>;
  schema.frontmatter.score.type = "integer"; write(root, ".typedmark/schemas/other.md", schema);
  write(root, "Notes/B.md", { note_type: "other", status: "closed", score: 2 });
  const mixed = { ...query, note_types: ["note", "other"] };
  write(root, ".typedmark/datasets/notes.md", { ...dataset, query: mixed });
  expect(run(root).results).toContainEqual(expect.objectContaining({ code: "invalid_dataset", rule_id: "CM-528" }));
  write(root, ".typedmark/datasets/notes.md", { ...dataset, query: { ...mixed, select: [
    { kind: "path", as: "path" }, { kind: "mapped_field", as: "score", definition: { type: "number", nullable: true }, sources: [
      { note_types: ["note"], field: "score" }, { note_types: ["other"], field: "score", conversion: "lossless" },
    ] },
  ] } });
  expect(run(root)).toMatchObject({ evaluation: "complete", valid: true, results: [] });
}, 30_000);

test("ignores artifact bodies and inert vendor query metadata", () => {
  const root = collection();
  write(root, ".typedmark/datasets/notes.md", { ...dataset, x_preview: { query: { invalid: true } } }, "---\nquery: definitely-not-a-query\n---\n");
  expect(run(root)).toMatchObject({ evaluation: "complete", valid: true, results: [] });
});

test("does not claim query interpretation when its artifact owner is undeclared", () => {
  const root = collection();
  write(root, "typedmark.md", { specification_version: "0.1.0", name: "views", description: "Views.", extensions: { "typedmark:queries": "0.1.0" } });
  write(root, ".typedmark/datasets/notes.md", dataset);
  const report = run(root);
  expect(report).toMatchObject({ evaluation: "incomplete", valid: false, evaluated_extensions: {} });
  expect(report.results).toContainEqual(expect.objectContaining({ code: "invalid_extension_declaration", extension: "typedmark:views" }));
});

test("rejects a saved-view projection whose source field is undeclared", () => {
  const root = collection();
  write(root, ".typedmark/views/notes.md", { ...view, dataset: undefined, query: { ...query, select: [{ kind: "field", field: "missing", as: "missing" }] },
    presentation: { layout: "table", fields: [{ column: "missing" }] },
  });
  expect(run(root).results).toContainEqual(expect.objectContaining({ code: "invalid_view", rule_id: "CM-449" }));
});
