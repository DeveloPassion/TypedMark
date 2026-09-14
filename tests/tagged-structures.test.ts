import { afterEach, expect, test } from "bun:test";
import { mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { queryCollection } from "../src/query";
import { validateCollection } from "../src/validator";

const schemaDirectory = resolve(import.meta.dir, "../../TypedMarkSpecification/schema/json-schema");
const roots: string[] = [];

function collection(options: { config?: string; schema?: string; note?: string; body?: string } = {}) {
  const root = mkdtempSync(join(tmpdir(), "typedmark-tagged-structures-"));
  roots.push(root);
  mkdirSync(join(root, ".typedmark/schemas"), { recursive: true });
  const files = {
    "typedmark.md": "---\nspecification_version: 0.1.0\nname: tagged-structures\ndescription: Tagged structure validation.\n"
      + (options.config ?? "") + "---\nCollection prose.\n",
    ".typedmark/schemas/note.md": "---\nspecification_version: 0.1.0\ndescription: Note.\n"
      + "storage: {folder_pattern: '', note_name_pattern: '{title}'}\n"
      + (options.schema ?? "") + "---\nSchema prose.\n",
    "Note.md": "\uFEFF---\nnote_type: note\n" + (options.note ?? "") + "---\n" + (options.body ?? "Note prose.\n"),
  };
  for (const [path, source] of Object.entries(files)) writeFileSync(join(root, path), source.replaceAll("\n", "\r\n"));
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

// Assert both path inventory and exact source bytes even if validation throws.
function preservingSources<T>(root: string, operation: () => T): T {
  const before = sourceTree(root);
  try { return operation(); }
  finally { expect(sourceTree(root)).toEqual(before); }
}

const validate = (root: string) => preservingSources(root, () => validateCollection({ collectionRoot: root, schemaDirectory }));
const query = (root: string) => preservingSources(root, () => queryCollection({
  collectionRoot: root, schemaDirectory, queryVersion: "0.1.0",
  query: { specification_version: "0.1.0", select: [{ kind: "path", as: "path" }] },
}));

afterEach(() => {
  for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true });
});

// FND-25 and NTS-23 govern parsing and structural shapes. These declarations
// also contain invalid entries if interpreted as ordinary mappings; accepting
// them as empty objects cannot satisfy either reading of the tagged input.
test.each([
  { name: "set heading block", schema: "headings: !!set {required_h2: null}\n" },
  { name: "ordered heading map", schema: "headings: !!omap [{required_h2: 7}]\n" },
  { name: "set field-definition block", schema: "frontmatter: !!set {needed: null}\n" },
  { name: "ordered field-definition map", schema: "frontmatter: !!omap [{needed: {type: not_a_type}}]\n" },
])("reports an invalid $name instead of discarding its entries", ({ schema }) => {
  const report = validate(collection({ schema }));
  expect(report.valid).toBe(false);
  expect(report.results).toContainEqual(expect.objectContaining({
    code: "invalid_note_type_schema", path: ".typedmark/schemas/note.md", severity: "error",
  }));
});

// CM-551: supplied validation defaults are a mapping of category to severity.
test.each([
  "!!set {invalid_heading: null}",
  "!!omap [{invalid_heading: not_a_severity}]",
])("reports invalid tagged validation defaults: %s", (defaults) => {
  const report = validate(collection({ config: `validation_defaults: ${defaults}\n` }));
  expect(report.valid).toBe(false);
  expect(report.results).toContainEqual(expect.objectContaining({
    code: "invalid_collection_configuration", path: "typedmark.md", severity: "error",
  }));
});

// CM-553: a mapping rule needs actual kind-specific keys. These controls also
// require a portable diagnostic instead of an exception from later consumers.
test.each([
  "!!set {kind: null, field: null}",
  "!!omap [{kind: not_a_kind}, {field: note_type}]",
])("reports an invalid tagged mapping rule: %s", (mapping) => {
  const report = validate(collection({ config: `note_type_mappings:\n  - ${mapping}\n` }));
  expect(report.valid).toBe(false);
  expect(report.results).toContainEqual(expect.objectContaining({
    code: "invalid_collection_configuration", path: "typedmark.md", severity: "error",
  }));
});

// CM-307/CM-308: suppressing the schema diagnostic cannot create a usable
// effective model for an admitted note. No completeness rule for malformed
// extension declarations is inferred for these unrelated shape failures.
test.each([
  "headings: !!omap [{required_h2: 7}]\n",
  "frontmatter: !!omap [{needed: {type: not_a_type}}]\n",
])("suppressed tagged schema failures still prevent query evaluation: %s", (schema) => {
  const root = collection({ schema, config: "validation_defaults: {invalid_note_type_schema: off}\n" });
  expect(validate(root).results).toEqual([]);
  expect(() => query(root)).toThrow("CM-308");
});

test.each(["", "frontmatter: {}\nheadings: {}\n", "frontmatter: !!map {}\nheadings: !!map {}\n"])(
  "omitted and empty ordinary schema mappings remain valid: %s", (schema) => {
    const report = validate(collection({ schema, config: "validation_defaults: {}\n" }));
    expect(report).toMatchObject({ valid: true, evaluation: "complete", results: [] });
  },
);

test("ordinary mappings retain their field and heading requirements", () => {
  const report = validate(collection({
    schema: "frontmatter: {needed: {type: text, nullable: false}}\nheadings: {required_h2: [Context]}\n",
  }));
  expect(report.valid).toBe(false);
  expect(report.results).toEqual(expect.arrayContaining([
    expect.objectContaining({ code: "missing_declared_field", path: "Note.md", field: "needed" }),
    expect.objectContaining({ code: "invalid_heading", path: "Note.md", heading: "Context" }),
  ]));
});

test("explicit ordinary mapping tags preserve valid structural declarations", () => {
  const report = validate(collection({
    config: "validation_defaults: !!map {}\nnote_type_mappings: [!!map {kind: frontmatter_field, field: note_type}]\n",
    schema: "frontmatter: !!map {needed: !!map {type: text}}\nheadings: !!map {required_h2: [Context]}\n",
    note: "needed: present\n", body: "## Context\n",
  }));
  expect(report).toMatchObject({ valid: true, evaluation: "complete", results: [] });
});

// EXT-24/EXT-25 and FDR-29: structural guards must not recursively reject
// values merely because the parser uses native containers for explicit tags.
test.each(["!!set {opaque: null}", "!!omap [{opaque: 7}]"])(
  "tagged vendor metadata and unconstrained any values remain opaque: %s", (value) => {
    const report = validate(collection({
      config: `x_editor: ${value}\n`,
      schema: `x_editor: ${value}\nfrontmatter:\n  payload: {type: any}\n  fallback:\n    type: any\n    default_value: ${value}\n`,
      note: `payload: ${value}\n`,
    }));
    expect(report).toMatchObject({ valid: true, evaluation: "complete", results: [] });
  },
);
