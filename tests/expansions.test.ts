import { afterEach, expect, test } from "bun:test";
import { dirname, join, resolve } from "node:path";
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { stringify } from "yaml";
import { validateCollection } from "../src/validator";

const schemaDirectory = resolve(import.meta.dir, "../../TypedMarkSpecification/schema/json-schema");
const roots: string[] = [];
const version = { specification_version: "0.1.0", description: "Expansions." };
const extensions = { "typedmark:expansion": "0.1.0", "typedmark:expressions": "0.1.0", "typedmark:queries": "0.1.0", "typedmark:views": "0.1.0" };
const query = { specification_version: "0.1.0", note_types: ["note"], select: [{ kind: "field", field: "summary", as: "summary" }], order_by: [{ column: "summary" }] };
function write(root: string, path: string, data: unknown, body = "") {
  mkdirSync(dirname(join(root, path)), { recursive: true });
  writeFileSync(join(root, path), `---\n${stringify(data)}---\n${body}`);
}
function expansion(source: object, output = "Hello", overrides: object = {}) {
  return `<!-- typedmark:expansion ${JSON.stringify({ id: "summary", mode: "manual", state: "materialized", source, render: { item: "${value}" }, ...overrides })} -->\n${output}${output ? "\n" : ""}<!-- /typedmark:expansion -->\n`;
}
function collection() {
  const root = mkdtempSync(join(tmpdir(), "typedmark-expansion-")); roots.push(root);
  write(root, "typedmark.md", { ...version, name: "expansions", extensions });
  write(root, ".typedmark/schemas/note.md", { ...version, storage: { folder_pattern: "", note_name_pattern: "{title}" }, frontmatter: { summary: { type: "text", nullable: true, default_value: "Default" } }, relationships: { belongs_to: { allowed_note_types: {} }, related_to: { allowed_note_types: { note: {} } } } });
  write(root, "A.md", { note_type: "note", summary: "Hello" });
  return root;
}
const run = (collectionRoot: string, supportedExtensions?: Record<string, string>) => validateCollection({ collectionRoot, schemaDirectory, supportedExtensions });
afterEach(() => { for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true }); });

test.each(["auto", "manual"])("validates %s expansion output without writes and diagnoses drift", (mode) => {
  const root = collection(); const source = { kind: "self_field", field: "summary" };
  write(root, "A.md", { note_type: "note", summary: "Hello" }, expansion(source, "Hello", { mode }));
  const before = readFileSync(join(root, "A.md"));
  expect(run(root)).toMatchObject({ evaluation: "complete", valid: true, results: [] });
  expect(readFileSync(join(root, "A.md"))).toEqual(before);
  write(root, "A.md", { note_type: "note", summary: "Changed" }, expansion(source, "Hello", { mode }));
  expect(run(root).results).toContainEqual(expect.objectContaining({ code: "expansion_drift", rule_id: "RHT-164", expansion: "summary" }));
});

test("field sources read stored frontmatter, not implicit defaults", () => {
  const root = collection(); write(root, "A.md", { note_type: "note" }, expansion({ kind: "self_field", field: "summary" }, ""));
  expect(run(root)).toMatchObject({ valid: true, results: [] });
});

test.each([
  [{ kind: "note_field", note: "[[A]]", field: "summary" }, "Hello"],
  [{ kind: "note_field", note: "![[A]]", field: "summary" }, "Hello"],
  [{ kind: "file", value: "stem" }, "B"],
  [{ kind: "file", value: "filename" }, "B.md"],
  [{ kind: "file", value: "path" }, "B.md"],
  [{ kind: "relationship", relationship: "related_to" }, "[A](/A.md)"],
  [{ kind: "relationship", relationship: "related_to", field: "summary" }, "Hello"],
  [{ kind: "query", query, column: "summary" }, "Hello"],
])("evaluates expansion source %j", (source, output) => {
  const root = collection(); write(root, "B.md", { note_type: "note", summary: null }, "[[A]]\n\n" + expansion(source, output));
  expect(run(root)).toMatchObject({ valid: true, results: [] });
});

test.each(["dataset", "view"])("reuses validated %s results and checks visible columns", (kind) => {
  const root = collection();
  write(root, ".typedmark/datasets/notes.md", { ...version, dataset: "notes", row_identity: "path", query: { ...query, select: [{ kind: "path", as: "path" }, ...query.select] } });
  write(root, ".typedmark/views/notes.md", { ...version, view: "notes", dataset: "notes", presentation: { layout: "table", fields: [{ column: "summary" }] } });
  write(root, "B.md", { note_type: "note", summary: null }, expansion({ kind, [kind]: "notes", column: "summary" }));
  expect(run(root)).toMatchObject({ valid: true, results: [] });
  write(root, "B.md", { note_type: "note", summary: null }, expansion({ kind, [kind]: "notes", column: "missing" }));
  expect(run(root).results).toContainEqual(expect.objectContaining({ code: "invalid_expansion", expansion: "summary", rule_id: kind === "dataset" ? "RHT-277" : "RHT-262" }));
});

test("once expansions do not re-evaluate stale or clock-dependent sources", () => {
  const root = collection(); write(root, "A.md", { note_type: "note" }, expansion({ kind: "now", format: "YYYY" }, "2000", { mode: "once" }));
  expect(run(root)).toMatchObject({ valid: true, results: [] });
});

test("pending templates validate declarations without evaluating missing source values", () => {
  const root = collection();
  write(root, ".typedmark/templates/note.md", {}, expansion({ kind: "note_field", note: "[[Not created yet]]", field: "summary" }, "", { state: "pending" }));
  expect(run(root)).toMatchObject({ valid: true, results: [] });
  write(root, "A.md", { note_type: "note" }, expansion({ kind: "self_field", field: "summary" }, "", { state: "pending" }));
  expect(run(root).results).toContainEqual(expect.objectContaining({ code: "invalid_expansion", rule_id: "RHT-162", path: "A.md" }));
});

test("rendering is expression-scoped and rejects undeclared references", () => {
  const root = collection(); write(root, "A.md", { note_type: "note", summary: "hello" }, expansion({ kind: "self_field", field: "summary" }, "HELLO", { render: { item: "${uppercase(value)}" } }));
  expect(run(root).valid).toBe(true);
  write(root, "A.md", { note_type: "note", summary: "hello" }, expansion({ kind: "self_field", field: "summary" }, "hello", { render: { item: "${summary}" } }));
  expect(run(root).results).toContainEqual(expect.objectContaining({ code: "invalid_expansion", rule_id: "RHT-141" }));
});

test("marker comments do not contribute relationship links", () => {
  const root = collection(); write(root, "B.md", { note_type: "note" }, expansion({ kind: "note_field", note: "[[A]]", field: "summary" }));
  write(root, "A.md", { note_type: "note", summary: "Hello" }, expansion({ kind: "relationship", relationship: "related_to", direction: "inbound" }, ""));
  expect(run(root)).toMatchObject({ valid: true, results: [] });
});

test("untyped self_field sources require a frontmatter block and reject nested values", () => {
  const root = collection();
  writeFileSync(join(root, "Untyped.md"), expansion({ kind: "self_field", field: "value" }, ""));
  expect(run(root).results).toContainEqual(expect.objectContaining({ rule_id: "RHT-169" }));
  write(root, "Untyped.md", { value: ["text", null] }, expansion({ kind: "self_field", field: "value" }, ""));
  expect(run(root).results).toContainEqual(expect.objectContaining({ rule_id: "RHT-120" }));
});

test("source references do not read object prototypes", () => {
  const root = collection();
  write(root, "Untyped.md", {}, expansion({ kind: "self_field", field: "constructor" }, ""));
  expect(run(root)).toMatchObject({ valid: true, results: [] });
  write(root, "typedmark.md", { ...version, specification_version: "0.1.1", name: "expansions", extensions });
  write(root, "Untyped.md", {}, expansion({ kind: "constructor" }, ""));
  expect(run(root).results).toContainEqual(expect.objectContaining({ code: "invalid_expansion" }));
});

test.each(["query", "view"])("heterogeneous %s columns retain each row's numeric definition", (kind) => {
  const root = collection();
  for (const [type, path] of [["integer", "I.md"], ["number", "N.md"]]) {
    write(root, `.typedmark/schemas/${type}.md`, { ...version, storage: { folder_pattern: "", note_name_pattern: "{title}" }, frontmatter: { value: { type } } });
    write(root, path!, { note_type: type, value: 1e21 });
  }
  const numericQuery = { specification_version: "0.1.0", note_types: ["integer", "number"], select: [{ kind: "path", as: "path" }, { kind: "field", field: "value", as: "value" }], order_by: [{ column: "path" }] };
  write(root, ".typedmark/views/numeric.md", { ...version, view: "numeric", query: numericQuery, presentation: { layout: "table", fields: [{ column: "value" }] } });
  write(root, "Untyped.md", {}, expansion(kind === "query" ? { kind, query: numericQuery, column: "value" } : { kind, view: "numeric", column: "value" }, "1000000000000000000000\n1e+21"));
  expect(run(root)).toMatchObject({ valid: true, results: [] });
});

test.each(["once", "template"])("static query versions remain checked for %s without evaluating values", (mode) => {
  const root = collection();
  const body = expansion({ kind: "query", query: { ...query, specification_version: "0.1.1" }, column: "summary" }, "", mode === "template" ? { state: "pending" } : { mode });
  write(root, mode === "template" ? ".typedmark/templates/note.md" : "A.md", mode === "template" ? {} : { note_type: "note" }, body);
  expect(run(root).results).toContainEqual(expect.objectContaining({ code: "invalid_expansion", rule_id: "RHT-247" }));
});

test.each(["descriptor", "source", "render"])("future patch %s keys warn during incomplete best-effort evaluation", (location) => {
  const root = collection();
  write(root, "typedmark.md", { ...version, specification_version: "0.1.1", name: "expansions", extensions });
  write(root, "Untyped.md", {}, expansion({ kind: "file", value: "stem", ...(location === "source" ? { future_key: true } : {}) }, "Untyped", location === "render" ? { render: { item: "${value}", future_key: true } } : location === "descriptor" ? { future_key: true } : {}));
  const report = run(root);
  expect(report.evaluation).toBe("incomplete");
  expect(report.results).toContainEqual(expect.objectContaining({ code: "unknown_field", severity: "warn", rule_id: "FND-11", path: "Untyped.md" }));
  expect(report.results.some((finding) => finding.code === "invalid_expansion")).toBe(false);
});

test("the alternative frontmatter delimiter keeps expansion body boundaries intact", () => {
  const root = collection();
  writeFileSync(join(root, "A.md"), "---\nnote_type: note\nsummary: Hello\n...\n" + expansion({ kind: "self_field", field: "summary" }));
  expect(run(root)).toMatchObject({ valid: true, results: [] });
});

test("invalid YAML still delimits the body before expansion discovery", () => {
  const root = collection();
  writeFileSync(join(root, "Broken.md"), "---\nbad: [\n" + expansion({ kind: "self_field", field: "summary" }) + "---\nBody only.\n");
  const report = run(root);
  expect(report.results).toContainEqual(expect.objectContaining({ code: "invalid_note_frontmatter" }));
  expect(report.results.some((finding) => finding.code === "invalid_expansion")).toBe(false);
});

test("path-associated notes inherit schema versions even when frontmatter is invalid", () => {
  const root = collection();
  write(root, "typedmark.md", { ...version, name: "expansions", extensions, note_type_mappings: [{ kind: "fixed", note_type: "note", when: { path: { under: "notes/" } } }] });
  write(root, ".typedmark/schemas/note.md", { ...version, specification_version: "0.1.1", storage: { folder_pattern: "notes", note_name_pattern: "{title}" } });
  mkdirSync(join(root, "notes"));
  writeFileSync(join(root, "notes/Broken.md"), "---\nbad: [\n---\n" + expansion({ kind: "query", query: { ...query, specification_version: "0.1.1" }, column: "summary" }, "", { mode: "once" }));
  const report = run(root);
  expect(report.results).toContainEqual(expect.objectContaining({ code: "invalid_note_frontmatter" }));
  expect(report.results.some((finding) => finding.rule_id === "RHT-247")).toBe(false);
});

test("unsupported transitive dataset versions remain unavailable rather than missing", () => {
  const root = collection();
  write(root, ".typedmark/datasets/future.md", { ...version, specification_version: "0.2.0", dataset: "future", future_key: true });
  write(root, ".typedmark/views/future.md", { ...version, view: "future", dataset: "future", presentation: { layout: "table", fields: [{ column: "summary" }] } });
  write(root, "A.md", { note_type: "note", summary: "Hello" }, expansion({ kind: "view", view: "future", column: "summary" }));
  const report = run(root);
  expect(report.evaluation).toBe("incomplete");
  expect(report.results).toContainEqual(expect.objectContaining({ code: "unsupported_specification_version", path: ".typedmark/datasets/future.md" }));
  expect(report.results.some((finding) => ["invalid_view", "invalid_expansion"].includes(finding.code))).toBe(false);
});

test("all used source contracts must be declared and disabled dependencies stay incomplete", () => {
  const root = collection(); write(root, "A.md", { note_type: "note", summary: "Hello" }, expansion({ kind: "query", query, column: "summary" }));
  const limited = run(root, { "typedmark:expansion": "0.1.0", "typedmark:expressions": "0.1.0" });
  expect(limited.evaluation).toBe("incomplete");
  expect(limited.evaluated_extensions).not.toHaveProperty("typedmark:expansion");
  write(root, "typedmark.md", { ...version, name: "expansions", extensions: { "typedmark:expansion": "0.1.0", "typedmark:expressions": "0.1.0" } });
  expect(run(root).results).toContainEqual(expect.objectContaining({ code: "invalid_extension_declaration", extension: "typedmark:queries", path: "A.md" }));
});
