import { afterEach, expect, test } from "bun:test";
import { mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { parseMarkdown } from "../src/frontmatter";
import { queryCollection } from "../src/query";
import { SchemaRegistry } from "../src/schema-registry";
import type { ValidationReport } from "../src/types";
import { validateCollection } from "../src/validator";

const schemaDirectory = resolve(import.meta.dir, "../../TypedMarkSpecification/schema/json-schema");
const registry = new SchemaRegistry(schemaDirectory);
const roots: string[] = [];
const noteTypePath = ".typedmark/schemas/note.md";
const propertySetPath = ".typedmark/property-sets/shared.md";

function collection(options: { fields?: string; config?: string; schema?: string; propertySet?: string; note?: string } = {}) {
  const root = mkdtempSync(join(tmpdir(), "typedmark-allowed-values-"));
  roots.push(root);
  const files: Record<string, string> = {
    "typedmark.md": "specification_version: 0.1.0\nname: allowed-values\ndescription: Allowed-value boundaries.\n" + (options.config ?? ""),
    [noteTypePath]: "specification_version: 0.1.0\ndescription: Note.\n"
      + "storage: {folder_pattern: '', note_name_pattern: '{title}'}\n"
      + (options.fields ? `frontmatter:\n${options.fields}` : "") + (options.schema ?? ""),
    "Note.md": "note_type: note\n" + (options.note ?? ""),
  };
  if (options.propertySet !== undefined) files[propertySetPath] = "specification_version: 0.1.0\nproperty_set: shared\n"
    + "description: Shared fields.\nfrontmatter:\n" + options.propertySet;
  for (const [path, frontmatter] of Object.entries(files)) {
    mkdirSync(dirname(join(root, path)), { recursive: true });
    writeFileSync(join(root, path), `\uFEFF---\n${frontmatter}---\nAuthored body.\n`.replaceAll("\n", "\r\n"));
  }
  return root;
}

function sourceTree(root: string, prefix = ""): Array<{ path: string; content: Buffer | null }> {
  return readdirSync(join(root, prefix), { withFileTypes: true }).sort((left, right) => left.name.localeCompare(right.name))
    .flatMap((entry) => {
      const path = prefix + entry.name;
      return entry.isDirectory()
        ? [{ path, content: null }, ...sourceTree(root, `${path}/`)]
        : [{ path, content: readFileSync(join(root, path)) }];
    });
}

function preservingSources<T>(root: string, operation: () => T): T {
  const before = sourceTree(root);
  try { return operation(); }
  finally { expect(sourceTree(root)).toEqual(before); }
}

const validate = (root: string) => preservingSources(root, () => validateCollection({ collectionRoot: root, schemaDirectory }));
const query = (root: string, select: unknown[] = [{ kind: "path", as: "path" }]) => preservingSources(root, () => queryCollection({
  collectionRoot: root, schemaDirectory, queryVersion: "0.1.0",
  query: { specification_version: "0.1.0", select },
}));

function expectShapeFinding(report: ValidationReport, path = noteTypePath) {
  expect(report.valid).toBe(false);
  expect(report.results).toContainEqual(expect.objectContaining({
    code: path === propertySetPath ? "invalid_property_set" : "invalid_note_type_schema",
    rule_id: path === propertySetPath ? "CM-150" : "NTS-4",
    path, severity: "error", message: expect.stringContaining("/allowed_values"),
  }));
  expect(registry.validate("validation-report.schema.json", JSON.parse(JSON.stringify(report)))).toEqual([]);
}

afterEach(() => {
  for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true });
});

// FDR-197 rejects non-scalar entries at the shape boundary, before AJV or the
// semantic field-value equality implementation can compare authored objects.
test.each([
  { name: "mappings with own valueOf keys", values: "[{valueOf: 1}, {valueOf: 2}]" },
  { name: "mappings with own toString keys", values: "[{toString: 1}, {toString: 2}]" },
  { name: "nested sequences", values: "[[one], [two]]" },
  { name: "native YAML sets", values: "[!!set {one: null}, !!set {two: null}]" },
])("returns a portable shape finding for $name", ({ values }) => {
  expectShapeFinding(validate(collection({ fields: `  choice: {type: text, allowed_values: ${values}}\n` })));
});

test("reports distinct self-cyclic authored YAML mappings without recursive comparison", () => {
  const root = collection({ fields: "  choice:\n    type: text\n    allowed_values:\n"
    + "      - &first {self: *first}\n      - &second {self: *second}\n" });
  expectShapeFinding(validate(root));
});

test("duplicate prototype-like strings remain shape errors", () => {
  expectShapeFinding(validate(collection({ fields: '  choice: {type: text, allowed_values: ["__proto_", "__proto_"]}\n' })));
});

test.each([
  "  details: {type: object, fields: {choice: {type: text, allowed_values: [{valueOf: 1}, {valueOf: 2}]}}}\n",
  "  choices: {type: list, items: {type: text, allowed_values: [{valueOf: 1}, {valueOf: 2}]}}\n",
])("checks nested object fields and anonymous list items: %s", (fields) => {
  expectShapeFinding(validate(collection({ fields })));
});

test("reports malformed allowed values in a reusable property set", () => {
  const root = collection({
    config: "extensions: {'typedmark:reuse': 0.1.0}\ndefault_property_sets: [shared]\n",
    propertySet: "  choice: {type: text, allowed_values: [{valueOf: 1}, {valueOf: 2}]}\n",
  });
  expectShapeFinding(validate(root), propertySetPath);
});

test("preserves aliases shared by allowed values, vendor metadata, defaults and constants", () => {
  const root = collection({ schema: "x_vendor: &shared [{valueOf: 1}, {valueOf: 2}]\nfrontmatter:\n"
    + "  choice: {type: text, allowed_values: *shared}\n"
    + "  payload: {type: any, default_value: *shared, const_value: *shared}\n" });
  const data = parseMarkdown(readFileSync(join(root, noteTypePath))).data;
  const fields = data.frontmatter as Record<string, Record<string, unknown>>;
  const shared = data.x_vendor as Array<Record<string, unknown>>;
  const before = structuredClone(data);
  const errors = registry.validate("note-type.schema.json", data);
  expect(errors).toContainEqual(expect.objectContaining({ instancePath: "/frontmatter/choice/allowed_values/0" }));
  expect(data).toEqual(before);
  expect(data.x_vendor).toBe(shared);
  expect(fields.choice!.allowed_values).toBe(shared);
  expect(fields.payload!.default_value).toBe(shared);
  expect(fields.payload!.const_value).toBe(shared);
  expect(Object.entries(shared[0]!)).toEqual([["valueOf", 1]]);
  expectShapeFinding(validate(root));
});

test.each(["note type", "property set"])("suppressed %s shape findings still block dependent queries", (owner) => {
  const fields = "  choice: {type: text, allowed_values: [{valueOf: 1}, {valueOf: 2}]}\n";
  const root = collection(owner === "note type" ? {
    fields, config: "validation_defaults: {invalid_note_type_schema: off}\n",
  } : {
    propertySet: fields,
    config: "extensions: {'typedmark:reuse': 0.1.0}\ndefault_property_sets: [shared]\n"
      + "validation_defaults: {invalid_property_set: off}\n",
  });
  expect(validate(root).results).toEqual([]);
  expect(() => query(root)).toThrow("CM-308");
});

test.each([
  { definition: "{type: text, nullable: true, allowed_values: [null, draft, ready]}", stored: "draft" },
  { definition: "{type: integer, allowed_values: [-1, 0, 2]}", stored: "2" },
  { definition: "{type: number, allowed_values: [0, 1.5]}", stored: "1.5" },
  { definition: "{type: checkbox, allowed_values: [false, true]}", stored: "false" },
  { definition: "{type: list, items: {type: text}, allowed_values: [draft, ready]}", stored: "[draft, ready]" },
])("accepts compatible scalar allowed values: $definition", ({ definition, stored }) => {
  const root = collection({ fields: `  choice: ${definition}\n`, note: `choice: ${stored}\n` });
  expect(validate(root)).toMatchObject({ valid: true, evaluation: "complete", results: [] });
});

test.each([
  { definition: { type: "text", allowed_values: ["é", "e\u0301"] }, fields: '  choice: {type: text, allowed_values: ["é", "é"]}\n', rule: "FDR-197" },
  { definition: { type: "integer", allowed_values: ["one"] }, fields: '  choice: {type: integer, allowed_values: ["one"]}\n', rule: "FDR-198" },
])("keeps $rule scalar checks in semantic validation", ({ definition, fields, rule }) => {
  expect(registry.validate("defs.schema.json#/$defs/field_definition", definition)).toEqual([]);
  const report = validate(collection({ fields }));
  expect(report.results).toContainEqual(expect.objectContaining({
    code: "invalid_note_type_schema", path: noteTypePath, rule_id: rule,
  }));
});

test("rejects malformed standalone mapped-field declarations with a query shape error", () => {
  const root = collection({ fields: "  choice: {type: text}\n", note: "choice: draft\n" });
  expect(() => query(root, [{
    kind: "mapped_field", as: "choice", definition: { type: "text", allowed_values: [{ valueOf: 1 }, { valueOf: 2 }] },
    sources: [{ note_types: ["note"], field: "choice" }],
  }])).toThrow("CM-301");
});
