import { afterEach, expect, test } from "bun:test";
import { mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { stringify } from "yaml";
import { SchemaRegistry } from "../src/schema-registry";
import { validateCollection } from "../src/validator";

type Data = Record<string, unknown>;
const roots: string[] = [];
const schemaDirectory = resolve(import.meta.dir, "../../TypedMarkSpecification/schema/json-schema");
const registry = new SchemaRegistry(schemaDirectory);
const templatePath = ".typedmark/templates/source.md";
const extensions = {
  "typedmark:systems": "0.1.0", "typedmark:queries": "0.1.0",
  "typedmark:expansion": "0.1.0", "typedmark:expressions": "0.1.0",
};
const objectField = { type: "object", nullable: true, fields: { child: { type: "text", nullable: true } } };
const listField = { type: "list", nullable: true, items: { type: "object", fields: objectField.fields } };

afterEach(() => {
  for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true });
});

function write(root: string, path: string, data: Data, body = "") {
  mkdirSync(dirname(join(root, path)), { recursive: true });
  writeFileSync(join(root, path), `---\n${stringify(data)}---\n${body}`);
}

function system(source: Data, sourceField: Data = listField, targetField: Data = objectField) {
  const root = mkdtempSync(join(tmpdir(), "typedmark-pending-static-"));
  roots.push(root);
  write(root, "typedmark.md", {
    specification_version: "0.1.0", name: "pending-static-contracts", description: "Published source contracts.",
    version: "1.0.0", scaffold: {}, extensions,
  });
  for (const [name, field] of [["source", sourceField], ["target", targetField]] as const) {
    write(root, `.typedmark/schemas/${name}.md`, {
      specification_version: "0.1.0", description: "Pending source model.",
      storage: { folder_pattern: "", note_name_pattern: "{title}" },
      frontmatter: { entries: field },
    });
  }
  const descriptor = { id: "source", mode: "manual", state: "pending", source, render: { item: "${value}" } };
  write(root, templatePath, {}, `<!-- typedmark:expansion ${JSON.stringify(descriptor)} -->\n<!-- /typedmark:expansion -->\n`);
  return root;
}

function captureFiles(root: string): Record<string, Buffer> {
  const files: Record<string, Buffer> = {};
  function visit(directory: string, prefix = "") {
    for (const entry of readdirSync(directory, { withFileTypes: true })) {
      const path = prefix + entry.name;
      if (entry.isDirectory()) visit(join(directory, entry.name), `${path}/`);
      else files[path] = readFileSync(join(directory, entry.name));
    }
  }
  visit(root);
  return files;
}

function validate(root: string, mode: "system_definition" | "instantiated_collection" = "system_definition") {
  const before = captureFiles(root);
  try {
    const report = validateCollection({ collectionRoot: root, schemaDirectory, mode });
    expect(registry.validate("validation-report.schema.json", report)).toEqual([]);
    return report;
  } finally { expect(captureFiles(root)).toEqual(before); }
}

function querySource(where: Data) {
  return { kind: "query", column: "path", query: {
    specification_version: "0.1.0", note_types: ["source"], where, select: [{ kind: "path", as: "path" }],
  } };
}

function expectFailure(root: string, rule_id: string) {
  const report = validate(root);
  expect(report).toMatchObject({ evaluation: "complete", valid: false });
  expect(report.results).toContainEqual(expect.objectContaining({
    code: "invalid_expansion", path: templatePath, expansion: "source", rule_id,
  }));
}

test.each([
  { kind: "list", field: listField },
  { kind: "scalar", field: { type: "integer", nullable: true } },
])("pending query predicates cannot traverse a $kind field", ({ field }) => {
  const root = system(querySource({ kind: "field", field: "entries.child", operator: "exists", value: true }), field);
  expectFailure(root, "CM-328");
});

test("nested relationship predicates validate paths against their target type", () => {
  const root = system(querySource({
    kind: "relationship", relationship: "related_to", note_types: ["target"],
    where: { kind: "not", predicate: { kind: "field", field: "entries.child", operator: "exists", value: false } },
  }), objectField, listField);
  expectFailure(root, "CM-328");
});

test("nested relationship predicates do not apply the containing type's field contract", () => {
  const root = system(querySource({
    kind: "relationship", relationship: "related_to", note_types: ["target"],
    where: { kind: "field", field: "entries.child", operator: "equals", value: "Expected" },
  }), listField, objectField);
  expect(validate(root)).toMatchObject({ evaluation: "complete", valid: true, results: [] });
});

test("pending relationship sources reject unknown target type references without resolving notes", () => {
  const root = system({ kind: "relationship", relationship: "related_to", target_note_types: ["missing"] });
  expectFailure(root, "RHT-170");
});

test("pending relationship sources accept existing target types with no current notes", () => {
  const root = system({ kind: "relationship", relationship: "related_to", target_note_types: ["target"] });
  expect(validate(root)).toMatchObject({ evaluation: "complete", valid: true, results: [] });
});

test.each(["https://example.com", "[Outside](https://example.com)"])(
  "pending note_field rejects non-internal link syntax %s", (note) => {
    const root = system({ kind: "note_field", note, field: "entries" });
    expectFailure(root, "RHT-122");
  },
);

test.each(["[[Absent]]", "![[Absent]]"])("pending note_field does not resolve a well-formed missing note %s", (note) => {
  const root = system({ kind: "note_field", note, field: "entries" });
  expect(validate(root)).toMatchObject({ evaluation: "complete", valid: true, results: [] });
});

test("pending note_field does not convert an existing note's object-valued list", () => {
  const root = system({ kind: "note_field", note: "[[Existing]]", field: "entries" });
  write(root, "Existing.md", { note_type: "source", title: "Existing", entries: [{ child: "Authored" }] });
  // RHT-120 would reject these source values if RHT-168 were bypassed.
  expect(validate(root, "instantiated_collection")).toMatchObject({ evaluation: "complete", valid: true, results: [] });
});
