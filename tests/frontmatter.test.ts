import { afterEach, expect, test } from "bun:test";
import { cpSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { tmpdir } from "node:os";
import { stringify } from "yaml";
import { FrontmatterError, parseMarkdown } from "../src/frontmatter";
import { validateCollection } from "../src/validator";
import { runConformanceSuite } from "../src/suite";

const excessiveAliases = "---\na: &a [1, 1, 1, 1, 1]\nb: &b [*a, *a, *a, *a, *a]\nc: &c [*b, *b, *b, *b, *b]\nd: [*c, *c, *c, *c, *c]\n---\nBody\n";

test("YAML materialization limits remain structured parsing failures", () => {
  expect(() => parseMarkdown(excessiveAliases)).toThrow(FrontmatterError);
  try { parseMarkdown(excessiveAliases); } catch (error) {
    expect(error).toMatchObject({ body: "Body\n" });
  }
});

test("an unclosed opening delimiter is body content, not malformed frontmatter", () => {
  const source = "---\nnote_type: note\n# Body\n";
  expect(parseMarkdown(source)).toEqual({ data: {}, body: source, hasFrontmatter: false });
});

test.each(["\n", "\r\n", "\r"])("recognizes BOM and exact delimiter lines with %j line endings", (ending) => {
  const source = ["\uFEFF---", "value: yes", "...", "Body", "---", ""].join(ending);
  expect(parseMarkdown(source)).toEqual({ data: { value: "yes" }, body: "Body\n---\n", hasFrontmatter: true });
});

test("empty frontmatter remains distinct from no block and rejects duplicate keys", () => {
  expect(parseMarkdown("---\n---\n")).toEqual({ data: {}, body: "", hasFrontmatter: true });
  expect(() => parseMarkdown("---\na: 1\na: 2\n---\n")).toThrow();
});

const roots: string[] = [];
const schemaDirectory = resolve(import.meta.dir, "../../TypedMarkSpecification/schema/json-schema");
function write(root: string, path: string, data: unknown) {
  mkdirSync(dirname(join(root, path)), { recursive: true });
  writeFileSync(join(root, path), `---\n${stringify(data)}---\n`);
}
function collection() {
  const root = mkdtempSync(join(tmpdir(), "typedmark-frontmatter-")); roots.push(root);
  write(root, "typedmark.md", { specification_version: "0.1.0", name: "frontmatter", description: "Parsing.",
    extensions: { "typedmark:queries": "0.1.0", "typedmark:views": "0.1.0", "typedmark:automation": "0.1.0", "typedmark:systems": "0.1.0" },
    note_type_mappings: [{ kind: "fixed", note_type: "note", when: { path: { equals: "A.md" } } }] });
  write(root, ".typedmark/schemas/note.md", { specification_version: "0.1.0", description: "Note.", storage: { folder_pattern: "", note_name_pattern: "{title}" } });
  write(root, "A.md", {});
  return root;
}
afterEach(() => { for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true }); });

test("path-associated unclosed frontmatter stays read-only ordinary body", () => {
  const root = collection(); const source = "---\nnot YAML: [\nBody\n";
  writeFileSync(join(root, "A.md"), source);
  expect(validateCollection({ collectionRoot: root, schemaDirectory })).toMatchObject({ valid: true, results: [] });
  expect(readFileSync(join(root, "A.md"), "utf8")).toBe(source);
});

test.each([
  ["typedmark.md", "invalid_collection_configuration"],
  ["A.md", "invalid_note_frontmatter"],
  [".typedmark/schemas/note.md", "invalid_note_type_schema"],
  [".typedmark/templates/note.md", "invalid_template"],
  [".typedmark/history.md", "invalid_history"],
  [".typedmark/datasets/data.md", "invalid_dataset"],
  [".typedmark/views/view.md", "invalid_view"],
  [".typedmark/automations/action.md", "invalid_automation"],
])("reports invalid UTF-8 in %s under %s without replacing or rewriting bytes", (path, code) => {
  const root = collection();
  if (!["typedmark.md", "A.md", ".typedmark/schemas/note.md"].includes(path)) write(root, path, { specification_version: "0.1.0", description: "Artifact." });
  const bytes = Buffer.concat([readFileSync(join(root, path)), Buffer.from([0xff])]);
  writeFileSync(join(root, path), bytes);
  expect(validateCollection({ collectionRoot: root, schemaDirectory }).results).toContainEqual(expect.objectContaining({ code, path, rule_id: "FND-28" }));
  expect(readFileSync(join(root, path))).toEqual(bytes);
});

test("binary collection assets are not decoded as governed Markdown", () => {
  const root = collection(); writeFileSync(join(root, "asset.bin"), Buffer.from([0xff, 0xfe]));
  expect(validateCollection({ collectionRoot: root, schemaDirectory }).valid).toBe(true);
});

test.each(["encoding", "aliases"])("negative configuration %s vectors reach validation instead of crashing capability selection", async (kind) => {
  const root = collection(); writeFileSync(join(root, "typedmark.md"), kind === "encoding" ? Buffer.from([0xff]) : excessiveAliases);
  const golden = mkdtempSync(join(tmpdir(), "typedmark-encoding-vector-")); roots.push(golden);
  const vector = join(golden, "invalid-encoding");
  cpSync(root, join(vector, "collection"), { recursive: true });
  writeFileSync(join(vector, "expected-validation-report.json"), JSON.stringify({
    specification_version: "0.1.0", mode: "instantiated_collection", evaluation: "complete", required_extensions: {}, evaluated_extensions: {}, valid: false,
    results: [{ code: "invalid_collection_configuration", severity: "error", path: "typedmark.md", rule_id: kind === "encoding" ? "FND-28" : "CM-537", message: "Invalid configuration." }],
  }));
  const evidence = await runConformanceSuite({ goldenDirectory: golden, schemaDirectory, specificationRevision: "test", adapterRevision: "test", startedAt: "2026-09-11T00:00:00Z" });
  expect(evidence.summary).toEqual({ discovered: 1, executed: 1, passed: 1, failed: 0, skipped: 0, changed: 0 });
});
