import { afterEach, expect, test } from "bun:test";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { stringify } from "yaml";
import { validateCollection } from "../src/validator";
import type { ExtensionMap } from "../src/types";

const schemaDirectory = resolve(import.meta.dir, "../../TypedMarkSpecification/schema/json-schema");
const roots: string[] = [];

function collection(config: Record<string, unknown> = {}, schema: Record<string, unknown> = {}) {
  const root = mkdtempSync(join(tmpdir(), "typedmark-extensions-"));
  roots.push(root);
  mkdirSync(join(root, ".typedmark", "schemas"), { recursive: true });
  writeFileSync(join(root, "typedmark.md"), `---\n${stringify({
    specification_version: "0.1.0", name: "extensions", description: "Extension negotiation.", ...config,
  })}---\n`);
  writeFileSync(join(root, ".typedmark", "schemas", "note.md"), `---\n${stringify({
    specification_version: "0.1.0", description: "Note.",
    storage: { folder_pattern: "", note_name_pattern: "{title}" }, ...schema,
  })}---\n`);
  writeFileSync(join(root, "Example.md"), "---\nnote_type: note\n---\n");
  return root;
}

const run = (root: string, supportedExtensions?: ExtensionMap) =>
  validateCollection({ collectionRoot: root, schemaDirectory, supportedExtensions });

afterEach(() => { for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true }); });

test.each([
  ["typedmark:views", "typedmark:queries"],
  ["typedmark:expansion", "typedmark:expressions"],
])("reports the missing dependency of %s regardless of implementation support", (extension, dependency) => {
  const report = run(collection({ extensions: { [extension]: "0.1.0" } }));
  expect(report.valid).toBe(false);
  expect(report.results).toContainEqual(expect.objectContaining({
    code: "invalid_extension_declaration", rule_id: "EXT-14", path: "typedmark.md", extension,
  }));
  expect(report.results.find((result) => result.rule_id === "EXT-14")?.message).toContain(dependency);
});

test("reports conflicting dependency versions without selecting an installed replacement", () => {
  const extensions = { "typedmark:views": "0.1.0", "typedmark:queries": "0.1.0+other" };
  const report = run(collection({ extensions }));
  expect(report.required_extensions).toEqual(extensions);
  expect(report.results).toContainEqual(expect.objectContaining({
    code: "invalid_extension_declaration", rule_id: "EXT-15", extension: "typedmark:views",
  }));
});

test("does not infer dependencies for an unknown version of a standard contract", () => {
  const report = run(collection({ extensions: { "typedmark:views": "0.2.0" } }));
  expect(report.results.map((result) => result.code)).toEqual(["unsupported_extension"]);
});

test.each([
  { abstract: true },
  { extends: "base" },
  { property_sets: ["base"] },
  { exclude_property_sets: ["base"] },
  { frontmatter_remove: ["summary"] },
  { conditions: [{ when: { archived: { equals: true } }, then: { require: ["description"] } }] },
])("requires Reuse for schema constructs: %j", (schema) => {
  const report = run(collection({}, schema));
  expect(report.valid).toBe(false);
  expect(report.results).toContainEqual(expect.objectContaining({
    code: "invalid_extension_declaration", rule_id: "EXT-16", extension: "typedmark:reuse",
    path: ".typedmark/schemas/note.md",
  }));
});

test("requires Reuse for collection defaults and unreferenced property-set artifacts", () => {
  const root = collection({ default_property_sets: ["base"] });
  mkdirSync(join(root, ".typedmark", "property-sets"));
  writeFileSync(join(root, ".typedmark", "property-sets", "base.md"),
    "---\nspecification_version: 0.1.0\nproperty_set: base\ndescription: Shared fields.\nfrontmatter: {}\n---\n");
  const paths = run(root).results.filter((result) => result.code === "invalid_extension_declaration").map((result) => result.path);
  expect(paths).toEqual([".typedmark/property-sets/base.md", "typedmark.md"]);
});

test("ignores Reuse-looking names in vendor data and ordinary field names", () => {
  const report = run(collection({ x_editor: { default_property_sets: ["base"] } }, {
    abstract: false, x_editor: { extends: "base" },
    frontmatter: { extends: { type: "text", nullable: true } },
  }));
  expect(report).toMatchObject({ evaluation: "complete", valid: true, results: [] });
});

test("does not treat a regular file named property-sets as an artifact directory", () => {
  const root = collection();
  writeFileSync(join(root, ".typedmark", "property-sets"), "not a directory");
  expect(run(root)).toMatchObject({ evaluation: "complete", valid: true, results: [] });
});

test("retains a declared Reuse requirement without claiming its unevaluated semantics", () => {
  const report = run(collection({ extensions: { "typedmark:reuse": "0.1.0" } }, { extends: "base" }));
  expect(report).toMatchObject({
    evaluation: "incomplete", valid: false, required_extensions: { "typedmark:reuse": "0.1.0" }, evaluated_extensions: {},
  });
  expect(report.results.map((result) => result.code)).toEqual(["unsupported_extension"]);
});

test("distinguishes an implemented required contract from a deliberately limited evaluation", () => {
  const root = collection({ extensions: { "typedmark:systems": "0.1.0" } });
  expect(run(root)).toMatchObject({ evaluation: "complete", valid: true, evaluated_extensions: { "typedmark:systems": "0.1.0" } });
  expect(run(root, {})).toMatchObject({
    evaluation: "incomplete", valid: false,
    required_extensions: { "typedmark:systems": "0.1.0" }, evaluated_extensions: {},
  });
});

test("compares complete extension versions including build suffixes", () => {
  const extensions = { "typedmark:systems": "0.1.0+other" };
  expect(run(collection({ extensions }))).toMatchObject({
    evaluation: "incomplete", valid: false, required_extensions: extensions, evaluated_extensions: {},
  });
});
