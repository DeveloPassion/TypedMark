import { afterEach, expect, test } from "bun:test";
import { mkdtempSync, mkdirSync, readFileSync, readdirSync, rmSync, writeFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { tmpdir } from "node:os";
import { validateCollection } from "../src/validator";

const roots: string[] = [];
const schemaDirectory = resolve(import.meta.dir, "../../TypedMarkSpecification/schema/json-schema");
function collection(note = "---\nnote_type: note\n---\n\n# Example\n", fields = "") {
  const root = mkdtempSync(join(tmpdir(), "typedmark-test-"));
  roots.push(root);
  mkdirSync(join(root, ".typedmark", "schemas"), { recursive: true });
  writeFileSync(join(root, "typedmark.md"), "---\nspecification_version: 0.1.0\nname: test\ndescription: Test.\n---\n");
  writeFileSync(join(root, ".typedmark", "schemas", "note.md"),
    "---\nspecification_version: 0.1.0\ndescription: Note.\nstorage:\n  folder_pattern: ''\n  note_name_pattern: '{title}'\n" + fields + "---\n");
  writeFileSync(join(root, "Example.md"), note);
  return root;
}
const run = (root: string) => validateCollection({ collectionRoot: root, schemaDirectory });
afterEach(() => { for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true }); });

test("validates a real Core collection with a derived template", () => {
  const report = run(collection());
  expect(report).toMatchObject({ evaluation: "complete", valid: true, results: [] });
});

test("uses deterministic defaults without writing them", () => {
  const root = collection(undefined, "frontmatter:\n  status:\n    type: text\n    default_value: draft\n");
  const before = readFileSync(join(root, "Example.md"), "utf8");
  expect(run(root).valid).toBe(true);
  expect(readFileSync(join(root, "Example.md"), "utf8")).toBe(before);
});

test("does not coerce explicit null or generate missing required values on read", () => {
  const root = collection("---\nnote_type: note\nvalue: null\n---\n", "frontmatter:\n  value:\n    type: text\n    default_value: present\n");
  expect(run(root).results).toContainEqual(expect.objectContaining({ code: "missing_required_field", field: "value" }));
  writeFileSync(join(root, "Example.md"), "---\nnote_type: note\n---\n");
  expect(run(root).valid).toBe(true);
});

test("reports unsupported exact extensions as incomplete", () => {
  const root = collection();
  const file = join(root, "typedmark.md");
  writeFileSync(file, readFileSync(file, "utf8").replace("name: test", "extensions:\n  example:review: 1.2.0\nname: test"));
  expect(run(root)).toMatchObject({ evaluation: "incomplete", valid: false, evaluated_extensions: {} });
});

test("reports nested unknown fields using their full paths", () => {
  const root = collection("---\nnote_type: note\ndetails: {unexpected: true}\n---\n", "frontmatter:\n  details:\n    type: object\n    fields: {}\n");
  expect(run(root).results).toContainEqual(expect.objectContaining({ code: "unknown_field", field: "details.unexpected", rule_id: "MN-112" }));
});

test("does not let a caller claim support for an unimplemented extension", () => {
  const root = collection();
  const file = join(root, "typedmark.md");
  writeFileSync(file, readFileSync(file, "utf8").replace("name: test", "extensions: {example:review: 1.2.0}\nname: test"));
  const report = validateCollection({
    collectionRoot: root,
    schemaDirectory,
    supportedExtensions: { "example:review": "1.2.0" },
  });
  expect(report).toMatchObject({ evaluation: "incomplete", valid: false, evaluated_extensions: {} });
});

test("suppression cannot turn unsupported evaluation into conformance", () => {
  const root = collection();
  const file = join(root, "typedmark.md");
  writeFileSync(file, readFileSync(file, "utf8").replace("name: test",
    "extensions: {example:review: 1.2.0}\nvalidation_defaults: {unsupported_extension: off}\nname: test"));
  expect(run(root)).toMatchObject({ evaluation: "incomplete", valid: false, results: [] });
});

test("nested roots are excluded even when malformed", () => {
  const root = collection();
  mkdirSync(join(root, "nested"));
  writeFileSync(join(root, "nested", "typedmark.md"), "not a valid configuration");
  writeFileSync(join(root, "nested", "Bad.md"), "---\nnote_type: missing\n---\n");
  expect(run(root).valid).toBe(true);
});

test("detects required field types and storage mismatches", () => {
  const root = collection("---\nnote_type: note\ntitle: Wrong\namount: text\n---\n",
    "frontmatter:\n  amount:\n    type: integer\n");
  const report = run(root);
  expect(report.results).toContainEqual(expect.objectContaining({ code: "invalid_field_value", field: "amount" }));
  expect(report.results).toContainEqual(expect.objectContaining({ code: "path" }));
});

test("requires an explicitly named template instead of hiding a broken reference", () => {
  const root = collection(undefined, "template: {file: missing.md}\n");
  expect(run(root).results).toContainEqual(expect.objectContaining({ code: "invalid_template" }));
});

test("accepts a body-only explicit template", () => {
  const root = collection(undefined, "template: {file: seed.md}\n");
  mkdirSync(join(root, ".typedmark", "templates"));
  writeFileSync(join(root, ".typedmark", "templates", "seed.md"), "# Starter\n");
  expect(run(root).valid).toBe(true);
});

test("honors real calendar dates and rejects DST ambiguity", () => {
  const root = collection("---\nnote_type: note\nwhen: 2026-10-25T02:30\n---\n",
    "frontmatter:\n  when:\n    type: datetime\n");
  const config = join(root, "typedmark.md");
  writeFileSync(config, readFileSync(config, "utf8").replace("name: test", "timezone: Europe/Brussels\nname: test"));
  expect(run(root).results).toContainEqual(expect.objectContaining({ code: "invalid_field_value", field: "when" }));
  writeFileSync(join(root, "Example.md"), "---\nnote_type: note\nwhen: 2026-10-25T02:30+02:00\n---\n");
  expect(run(root).valid).toBe(true);
});

test("exercises a subset of the checked-in semantic vectors", () => {
  const base = resolve(import.meta.dir, "../../TypedMarkSpecification/schema/fixtures/golden");
  for (const name of ["core-valid", "core-invalid-field-value", "mandatory-tags-missing"]) {
    const expected = JSON.parse(readFileSync(join(base, name, "expected-validation-report.json"), "utf8"));
    const actual = run(join(base, name, "collection"));
    expect(actual.valid).toBe(expected.valid);
    for (const finding of expected.results) {
      expect(actual.results).toContainEqual(expect.objectContaining({
        code: finding.code, path: finding.path, field: finding.field,
      }));
    }
  }
});

test("orders findings by Unicode code point rather than UTF-16 code unit", () => {
  const root = collection();
  writeFileSync(join(root, "\uE000.md"), "---\nnote_type: note\ntitle: \uE000\nextra: true\n---\n");
  writeFileSync(join(root, "\u{10000}.md"), "---\nnote_type: note\ntitle: \u{10000}\nextra: true\n---\n");
  const paths = run(root).results.filter((result) => result.code === "unknown_field").map((result) => result.path);
  expect(paths).toEqual(["\uE000.md", "\u{10000}.md"]);
});
