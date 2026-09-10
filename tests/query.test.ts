import { afterEach, expect, test } from "bun:test";
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { stringify } from "yaml";
import { queryCollection } from "../src/query";
import { parseMarkdown } from "../src/frontmatter";

const schemaDirectory = resolve(import.meta.dir, "../../TypedMarkSpecification/schema/json-schema");
const roots: string[] = [];
const pathColumn = { kind: "path", as: "path" };

function collection(notes: Record<string, Record<string, unknown>>, extraFields: Record<string, unknown> = {}, config: Record<string, unknown> = {}) {
  const root = mkdtempSync(join(tmpdir(), "typedmark-query-"));
  roots.push(root);
  const write = (path: string, data: unknown, body = "") => {
    mkdirSync(dirname(join(root, path)), { recursive: true });
    writeFileSync(join(root, path), `---\n${stringify(data)}---\n${body}`);
  };
  write("typedmark.md", { specification_version: "0.1.0", name: "query", description: "Query tests.", ...config });
  write(".typedmark/schemas/note.md", {
    specification_version: "0.1.0", description: "Note.", storage: { folder_pattern: "Notes", note_name_pattern: "{title}" },
    frontmatter: {
      status: { type: "text", default_value: "draft" }, score: { type: "number", nullable: true },
      due: { type: "datetime", nullable: true },
      details: { type: "object", nullable: true, fields: { rank: { type: "integer", default_value: 3 } } },
      ...extraFields,
    },
  });
  for (const [name, data] of Object.entries(notes)) write(`Notes/${name}.md`, { note_type: "note", ...data });
  return root;
}
const run = (root: string, descriptor: Record<string, unknown> = {}) => queryCollection({
  collectionRoot: root, schemaDirectory, queryVersion: "0.1.0",
  query: { specification_version: "0.1.0", select: [pathColumn], ...descriptor },
});
afterEach(() => { for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true }); });

test("uses effective values for predicates and stored values for projection and exists", () => {
  const root = collection({ Defaulted: {}, Stored: { status: "draft" } });
  expect(run(root, { where: { kind: "field", field: "status", operator: "equals", value: "draft" }, select: [{ kind: "field", field: "status", as: "status" }] }).rows)
    .toEqual([{ status: null }, { status: "draft" }]);
  expect(run(root, { where: { kind: "field", field: "status", operator: "exists", value: false } }).rows)
    .toEqual([{ path: "Notes/Defaulted.md" }]);
});

test("recurses object defaults without inventing absent or null objects", () => {
  const root = collection({ Concrete: { details: {} }, Absent: {}, Null: { details: null } });
  expect(run(root, { where: { kind: "field", field: "details.rank", operator: "equals", value: 3 } }).rows)
    .toEqual([{ path: "Notes/Concrete.md" }]);
  expect(run(root, { where: { kind: "field", field: "details.rank", operator: "exists", value: true } }).rows).toEqual([]);
});

test("excludes deleted, untyped, metadata, excluded paths, and nested collections", () => {
  const root = collection({ Active: {}, Deleted: { deleted: true } }, {}, { exclude_paths: ["Notes/Excluded.md"] });
  writeFileSync(join(root, "Notes", "Untyped.md"), "ordinary prose");
  writeFileSync(join(root, "Notes", "Excluded.md"), "---\nnote_type: note\n---\n");
  mkdirSync(join(root, "nested"));
  writeFileSync(join(root, "nested", "typedmark.md"), "malformed child configuration");
  writeFileSync(join(root, "nested", "Child.md"), "---\nnote_type: note\n---\n");
  expect(run(root).rows).toEqual([{ path: "Notes/Active.md" }]);
  expect(run(root, { include_deleted: true }).rows).toEqual([{ path: "Notes/Active.md" }, { path: "Notes/Deleted.md" }]);
});

test("sorts before limiting and grouping, with null placement independent of direction", () => {
  const root = collection({ A: { score: null, status: "open" }, B: { score: 2, status: "open" }, C: { score: 10, status: "closed" }, D: { score: 2, status: "open" } });
  const result = run(root, {
    select: [{ kind: "field", field: "score", as: "score" }, { kind: "field", field: "status", as: "status" }],
    order_by: [{ column: "score", direction: "desc", nulls: "last" }], group_by: ["status"], limit: 3,
  });
  expect(result.rows).toEqual([{ score: 10, status: "closed" }, { score: 2, status: "open" }, { score: 2, status: "open" }]);
  expect(result.groups?.map((group) => [group.key, group.rows.length])).toEqual([[ ["closed"], 1 ], [ ["open"], 2 ]]);
});

test("does not short-circuit invalid boolean children", () => {
  const root = collection({ A: { score: 1 } });
  expect(() => run(root, { where: { kind: "any", predicates: [
    { kind: "path", operator: "under", value: "Notes/" },
    { kind: "field", field: "score", operator: "regex", value: "x" },
  ] } })).toThrow("CM-345");
});

test.each([
  { select: [pathColumn, pathColumn] },
  { order_by: [{ column: "missing" }] },
  { group_by: ["missing"] },
  { note_types: ["missing"] },
  { where: { kind: "path", operator: "regex", value: "[" } },
  { where: { kind: "relationship", relationship: "related_to", count: { min: 2, max: 1 } } },
])("rejects invalid query semantics even for an empty result: %j", (query) => {
  expect(() => run(collection({}), query)).toThrow();
});

test("maps fields with explicit conversion and preserves source provenance", () => {
  const root = collection({ A: { estimate: 3 } }, { estimate: { type: "integer" } });
  const column = { kind: "mapped_field", as: "effort", definition: { type: "number" }, sources: [{ note_types: ["note"], field: "estimate", conversion: "lossless" }] };
  const result = run(root, { select: [column] });
  expect(result.rows).toEqual([{ effort: 3 }]);
  expect(result.provenance[0]?.effort).toEqual({ path: "Notes/A.md", field: "estimate", source_backed: true });
  expect(() => run(root, { select: [{ ...column, sources: [{ note_types: ["note"], field: "estimate" }] }] })).toThrow("CM-484");
});

test("rejects incompatible values instead of rounding, defaulting, or dropping a mapped row", () => {
  const root = collection({ A: { score: 3.5 } });
  expect(() => run(root, { select: [{ kind: "mapped_field", as: "effort", definition: { type: "integer", nullable: true }, sources: [{ note_types: ["note"], field: "score", conversion: "conditional" }] }] }))
    .toThrow("CM-488");
});

test("normalizes text equality and orders datetime instants", () => {
  const root = collection({ A: { status: "e\u0301", due: "2026-01-01T10:00Z" }, B: { status: "é", due: "2026-01-01T12:30+02:00" } });
  expect(run(root, { where: { kind: "field", field: "status", operator: "equals", value: "é" }, select: [pathColumn, { kind: "field", field: "due", as: "due" }], order_by: [{ column: "due", direction: "desc" }] }).rows.map((row) => row.path))
    .toEqual(["Notes/B.md", "Notes/A.md"]);
});

test("requires an explicit supported operation contract and leaves collection files unchanged", () => {
  const root = collection({ A: {} });
  const before = readFileSync(join(root, "typedmark.md"));
  expect(() => queryCollection({ collectionRoot: root, schemaDirectory, queryVersion: "0.2.0", query: { specification_version: "0.1.0", select: [pathColumn] } })).toThrow("QRY-2");
  run(root);
  expect(readFileSync(join(root, "typedmark.md"))).toEqual(before);
});

function relationships(root: string, kind: "belongs_to" | "related_to") {
  const file = join(root, ".typedmark/schemas/note.md");
  const schema = parseMarkdown(readFileSync(file, "utf8")).data;
  schema.relationships = {
    belongs_to: { allowed_note_types: kind === "belongs_to" ? { note: {} } : {} },
    related_to: { allowed_note_types: kind === "related_to" ? { note: {} } : {} },
  };
  writeFileSync(file, `---\n${stringify(schema)}---\n`);
}

test("queries unique resolved relationships outbound and inbound with recursive predicates", () => {
  const root = collection({ A: { parents: ["[[b]]", "[[b|Again]]"] }, B: { id: "b" }, C: { parents: ["[[b]]"] } }, {
    parents: { type: "list", items: { type: "link", format: "note_link" }, default_value: [], relationship_kind: "belongs_to" },
  });
  relationships(root, "belongs_to");
  expect(run(root, { where: { kind: "relationship", relationship: "belongs_to", count: { min: 1, max: 1 } } }).rows)
    .toEqual([{ path: "Notes/A.md" }, { path: "Notes/C.md" }]);
  expect(run(root, { where: { kind: "relationship", relationship: "belongs_to", direction: "inbound", count: { min: 2 }, where: {
    kind: "field", field: "status", operator: "equals", value: "draft",
  } } }).rows).toEqual([{ path: "Notes/B.md" }]);
});

test("body links contribute declared related targets while code and assets do not", () => {
  const root = collection({ Source: {}, Target: {}, Other: {} });
  relationships(root, "related_to");
  writeFileSync(join(root, "Notes/Source.md"), "---\nnote_type: note\n---\n[[Target]] ![[Target]] ![diagram](diagram.svg)\n`[[Other]]`\n\n```md\n[[Other]]\n```\n");
  writeFileSync(join(root, "Notes/diagram.svg"), "<svg/>");
  expect(run(root, { where: { kind: "relationship", relationship: "related_to", count: { min: 1, max: 1 } } }).rows)
    .toEqual([{ path: "Notes/Source.md" }]);
});

test("does not let unrelated schema errors or optional contracts block a Core query", () => {
  const root = collection({ A: {} }, {}, { extensions: { "typedmark:automation": "0.1.0" } });
  writeFileSync(join(root, ".typedmark/schemas/bad.md"), "---\nspecification_version: 0.1.0\ndescription: Bad.\nfrontmatter: invalid\n---\n");
  writeFileSync(join(root, "Notes/Bad.md"), "---\nnote_type: bad\n---\n");
  const selected = run(root, { note_types: ["note"] });
  expect(selected.rows).toEqual([{ path: "Notes/A.md" }]);
  expect(selected.evaluation).toBe("complete");
  expect(() => run(root)).toThrow("CM-308");
});

test("prevalidates mapped source contracts even when there are no rows", () => {
  const root = collection({}, { estimate: { type: "integer" } });
  const mapped = { kind: "mapped_field", as: "effort", definition: { type: "number", nullable: true }, sources: [{ note_types: ["note"], field: "estimate" }] };
  expect(() => run(root, { select: [mapped] })).toThrow("CM-484");
  expect(() => run(root, { select: [{ ...mapped, sources: [{ note_types: ["note"], field: "typo" }] }] })).toThrow("CM-481");
  expect(() => run(root, { select: [{ ...mapped, definition: { type: "integer", min: 5, max: 1 } }] })).toThrow("FDR-195");
  expect(() => run(root, { select: [{ ...mapped, definition: { type: "integer", allowed_values: ["x"] } }] })).toThrow("FDR-198");
});

test("validates declared mapped sources outside the candidate type filter", () => {
  const root = collection({}, { estimate: { type: "integer" } });
  const schema = parseMarkdown(readFileSync(join(root, ".typedmark/schemas/note.md"), "utf8")).data as Record<string, any>;
  schema.frontmatter.estimate = { type: "text" };
  writeFileSync(join(root, ".typedmark/schemas/other.md"), `---\n${stringify(schema)}---\n`);
  expect(() => run(root, { note_types: ["note"], select: [{ kind: "mapped_field", as: "effort", definition: { type: "number", nullable: true }, sources: [
    { note_types: ["note"], field: "estimate", conversion: "lossless" },
    { note_types: ["other"], field: "estimate", conversion: "conditional" },
  ] }] })).toThrow("CM-488");
});

test("tracks best-effort schema versions reached through relationship predicates", () => {
  const root = collection({ Source: { parent: "[[Target]]" }, Target: { note_type: "area" } }, {
    parent: { type: "link", format: "note_link", nullable: true, relationship_kind: "belongs_to" },
  });
  const file = join(root, ".typedmark/schemas/note.md");
  const schema = parseMarkdown(readFileSync(file, "utf8")).data;
  schema.relationships = { belongs_to: { allowed_note_types: { area: {} } }, related_to: { allowed_note_types: {} } };
  writeFileSync(file, `---\n${stringify(schema)}---\n`);
  writeFileSync(join(root, ".typedmark/schemas/area.md"), `---\n${stringify({ ...schema, specification_version: "0.1.1" })}---\n`);
  expect(run(root, { note_types: ["note"], where: { kind: "relationship", relationship: "belongs_to", where: { kind: "field", field: "status", operator: "equals", value: "draft" } } }).evaluation)
    .toBe("incomplete");
});

test("deleted targets remain resolvable but do not satisfy relationship counts", () => {
  const root = collection({ Source: { parent: "[[Target]]" }, Target: { deleted: true } }, {
    parent: { type: "link", format: "note_link", nullable: true, validate_exists: true, relationship_kind: "belongs_to" },
  });
  relationships(root, "belongs_to");
  expect(run(root, { where: { kind: "relationship", relationship: "belongs_to" } }).rows).toEqual([]);
});

test("does not treat unknown stored properties as declared query field paths", () => {
  const root = collection({ A: { unexpected: true } });
  expect(run(root, { where: { kind: "field", field: "unexpected", operator: "exists", value: true } }).rows).toEqual([]);
});

test("does not group booleans and numbers through coercion", () => {
  const root = collection({ A: { score: 0 }, B: { note_type: "other", score: false } });
  const schema = parseMarkdown(readFileSync(join(root, ".typedmark/schemas/note.md"), "utf8")).data as Record<string, any>;
  schema.frontmatter.score = { type: "checkbox", nullable: true };
  writeFileSync(join(root, ".typedmark/schemas/other.md"), `---\n${stringify(schema)}---\n`);
  const result = run(root, { select: [{ kind: "field", field: "score", as: "score" }], group_by: ["score"] });
  expect(result.groups?.map((group) => group.key)).toEqual([[0], [false]]);
});

test("rejects ordering list columns even with no candidate values", () => {
  expect(() => run(collection({}), { select: [{ kind: "field", field: "tags", as: "tags" }], order_by: [{ column: "tags" }] }))
    .toThrow("CM-374");
});

test("keeps generated Core timestamps read-only in projection provenance", () => {
  const result = run(collection({ A: { created_at: "2026-01-01T10:00Z" } }), { select: [{ kind: "field", field: "created_at", as: "created" }] });
  expect(result.provenance[0]?.created?.source_backed).toBe(false);
});

test("rejects unsupported artifact compatibility lines for admitted types", () => {
  const root = collection({ A: {} });
  const file = join(root, ".typedmark/schemas/note.md");
  writeFileSync(file, readFileSync(file, "utf8").replace("0.1.0", "0.0.1"));
  expect(() => run(root)).toThrow("CM-308");
});
