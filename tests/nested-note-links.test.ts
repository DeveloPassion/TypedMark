import { afterEach, expect, test } from "bun:test";
import { mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { stringify } from "yaml";
import type { FieldDefinition } from "../src/field-values";
import { validateCollection } from "../src/validator";
import { SchemaRegistry } from "../src/schema-registry";

const schemaDirectory = resolve(import.meta.dir, "../../TypedMarkSpecification/schema/json-schema");
const registry = new SchemaRegistry(schemaDirectory);
const roots: string[] = [];
const sourcePath = "Notes/Source.md";
const link = (constraints: Partial<FieldDefinition> = {}): FieldDefinition => ({
  type: "link", format: "note_link", ...constraints,
});
const object = (fields: Record<string, FieldDefinition>): FieldDefinition => ({ type: "object", fields });
const list = (items: FieldDefinition): FieldDefinition => ({ type: "list", items });

function writeNote(root: string, path: string, data: Record<string, unknown>, body = "Note prose.\n") {
  mkdirSync(dirname(join(root, path)), { recursive: true });
  // Include a BOM, authored comments, and CRLF so read-only means exact bytes.
  writeFileSync(join(root, path), `\uFEFF---\n# Preserve this comment.\n${stringify(data)}---\n${body}`.replaceAll("\n", "\r\n"));
}

function collection(fields: Record<string, FieldDefinition>, stored: Record<string, unknown>, schema: Record<string, unknown> = {}) {
  const root = mkdtempSync(join(tmpdir(), "typedmark-nested-note-links-"));
  roots.push(root);
  writeNote(root, "typedmark.md", {
    specification_version: "0.1.0", name: "nested-note-links", description: "Nested note-link validation.",
  });
  for (const noteType of ["note", "project", "area"]) {
    writeNote(root, `.typedmark/schemas/${noteType}.md`, {
      specification_version: "0.1.0", description: `${noteType} notes.`,
      storage: { folder_pattern: "Notes", note_name_pattern: "{title}" },
      ...(noteType === "note" ? { frontmatter: fields, ...schema } : {}),
    });
  }
  writeNote(root, sourcePath, { note_type: "note", ...stored });
  writeNote(root, "Notes/Good.md", { note_type: "project" });
  writeNote(root, "Notes/Wrong.md", { note_type: "area" });
  writeNote(root, "Notes/Untyped.md", {});
  mkdirSync(join(root, "assets"));
  writeFileSync(join(root, "assets/diagram.svg"), "<svg><!-- Preserve asset bytes. --></svg>\r\n");
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

function validate(root: string) {
  const before = sourceTree(root);
  try {
    const report = validateCollection({ collectionRoot: root, schemaDirectory });
    expect(registry.validate("validation-report.schema.json", report)).toEqual([]);
    return report;
  }
  finally { expect(sourceTree(root)).toEqual(before); }
}

afterEach(() => {
  for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true });
});

// FDR-1/FDR-151/FDR-153 apply at every declared depth; CR-38 identifies the leaf.
test("reports a missing stored note link inside an object at its dotted field path", () => {
  const report = validate(collection({ details: object({ reference: link({ validate_exists: true }) }) }, {
    details: { reference: "[[Missing]]" },
  }));
  expect(report).toMatchObject({ valid: false, evaluation: "complete", results: [expect.objectContaining({
    code: "invalid_note_link", rule_id: "FDR-153", path: sourcePath, note_type: "note", field: "details.reference",
  })] });
});

test("resolves nested wiki and Markdown links, including untyped notes without targets", () => {
  const report = validate(collection({ details: object({
    wiki: link({ validate_exists: true, targets: ["project"] }),
    markdown: link({ validate_exists: true, targets: ["project"] }),
    untyped: link({ validate_exists: true }),
  }) }, { details: {
    wiki: "[[Good#Unknown heading|Label]]", markdown: "[Good](./Good.md#Unknown)", untyped: "[[./Untyped.md]]",
  } }));
  expect(report).toMatchObject({ valid: true, evaluation: "complete", results: [] });
});

// Lists contribute no field-name segment: the report schema forbids numeric
// indices and bracket notation in a CR-38 dotted field path.
test("checks links through repeated object and list nesting without indices in field context", () => {
  const report = validate(collection({ sections: list(object({
    details: object({ references: list(list(object({ reference: link({ validate_exists: true }) }))) }),
  })) }, { sections: [{ details: { references: [[{ reference: "[[Good]]" }, { reference: "[[Missing]]" }]] } }] }));
  expect(report).toMatchObject({ valid: false, results: [expect.objectContaining({
    code: "invalid_note_link", rule_id: "FDR-153", path: sourcePath,
    field: "sections.details.references.reference",
  })] });
});

// FDR-160/FDR-163: path links resolve before target-type restrictions apply.
test.each(["Wrong", "Untyped"])("rejects a nested path link to %s when targets require project", (target) => {
  const report = validate(collection({ details: object({ reference: link({ targets: ["project"] }) }) }, {
    details: { reference: `[[./${target}.md]]` },
  }));
  expect(report).toMatchObject({ valid: false, results: [expect.objectContaining({
    code: "invalid_field_value", rule_id: "FDR-160", path: sourcePath, field: "details.reference",
  })] });
});

test("rejects a nested asset target even when note existence is optional", () => {
  const report = validate(collection({ details: object({ references: list(link()) }) }, {
    details: { references: ["[[../assets/diagram.svg]]"] },
  }));
  expect(report).toMatchObject({ valid: false, results: [expect.objectContaining({
    code: "invalid_note_link", rule_id: "NL-33", path: sourcePath, field: "details.references",
  })] });
});

test("rejects a nested path link escaping the collection root", () => {
  const report = validate(collection({ details: object({ reference: link() }) }, {
    details: { reference: "[Outside](../../Outside.md)" },
  }));
  expect(report).toMatchObject({ valid: false, results: [expect.objectContaining({
    code: "invalid_note_link", rule_id: "NL-16", path: sourcePath, field: "details.reference",
  })] });
});

test("allows unresolved nested targets when existence is optional", () => {
  const report = validate(collection({ details: object({
    missing: link({ targets: ["project"] }), filtered: link({ targets: ["project"] }),
  }) }, { details: { missing: "[Missing](./Missing.md)", filtered: "[[Wrong]]" } }));
  expect(report).toMatchObject({ valid: true, evaluation: "complete", results: [] });
});

test("applies target filtering to nested name resolution before checking existence", () => {
  const report = validate(collection({ details: object({ reference: link({ targets: ["project"], validate_exists: true }) }) }, {
    details: { reference: "[[Wrong]]" },
  }));
  expect(report).toMatchObject({ valid: false, results: [expect.objectContaining({
    code: "invalid_note_link", rule_id: "FDR-153", path: sourcePath, field: "details.reference",
  })] });
});

const defaultedLinks = () => ({
  reference: link({ validate_exists: true, default_value: "[[Missing]]" }),
  restricted: link({ targets: ["project"], default_value: "[[./Wrong.md]]" }),
});

// FDR-151/FDR-160 explicitly test stored values. MN-94 supplies effective
// defaults recursively without making the absent leaf physically present.
test("a stored empty parent does not make its defaulted child links stored", () => {
  const report = validate(collection({ details: object(defaultedLinks()) }, { details: {} }));
  expect(report).toMatchObject({ valid: true, evaluation: "complete", results: [] });
});

test("links supplied by a whole-object default remain absent from stored metadata", () => {
  const report = validate(collection({ details: {
    ...object({ reference: link({ validate_exists: true }), restricted: link({ targets: ["project"] }) }),
    default_value: { reference: "[[Missing]]", restricted: "[[./Wrong.md]]" },
  } }, {}));
  expect(report).toMatchObject({ valid: true, evaluation: "complete", results: [] });
});

test("links supplied by a whole-list default remain absent from stored metadata", () => {
  const report = validate(collection({ sections: {
    ...list(object(defaultedLinks())), default_value: [{}],
  } }, {}));
  expect(report).toMatchObject({ valid: true, evaluation: "complete", results: [] });
});

test("checks stored leaves in each list item even when their values equal defaults", () => {
  const report = validate(collection({ sections: list(object(defaultedLinks())) }, {
    sections: [{}, { reference: "[[Missing]]", restricted: "[[./Wrong.md]]" }],
  }));
  expect(report).toMatchObject({ valid: false, results: [
    expect.objectContaining({ code: "invalid_note_link", rule_id: "FDR-153", path: sourcePath, field: "sections.reference" }),
    expect.objectContaining({ code: "invalid_field_value", rule_id: "FDR-160", path: sourcePath, field: "sections.restricted" }),
  ] });
});

test("preserves explicit null leaves and parents and accepts empty nested containers", () => {
  const nullableLink = link({ nullable: true, validate_exists: true, default_value: "[[Missing]]" });
  const report = validate(collection({
    details: object({ reference: nullableLink }),
    parent: { ...object(defaultedLinks()), nullable: true },
    sparse: object({ reference: link({ nullable: true, validate_exists: true }) }),
    references: list(link({ validate_exists: true })),
    batches: list(list(object({ reference: nullableLink }))),
  }, { details: { reference: null }, parent: null, sparse: {}, references: [], batches: [[], [{ reference: null }]] }));
  expect(report).toMatchObject({ valid: true, evaluation: "complete", results: [] });
});

test("does not interpret links inside text, URI, or unconstrained any values", () => {
  const report = validate(collection({ details: object({
    text: { type: "text" }, website: { type: "link", format: "uri" }, opaque: { type: "any" },
  }) }, { details: {
    text: "[[Missing]]", website: "https://example.com/Missing", opaque: { references: ["[[../assets/diagram.svg]]"] },
  } }));
  expect(report).toMatchObject({ valid: true, evaluation: "complete", results: [] });
});

function relatedProjects(min: number, max: number) {
  return { relationships: {
    belongs_to: { allowed_note_types: {} }, related_to: { allowed_note_types: { project: { min, max } } },
  } };
}

// FDR-127 and RHT-6: nested links validate but cannot become relationships.
test("valid nested links cannot satisfy a typed relationship minimum", () => {
  const report = validate(collection({ details: object({ reference: link({ validate_exists: true }) }) }, {
    details: { reference: "[[Good]]" },
  }, relatedProjects(1, 1)));
  expect(report).toMatchObject({ valid: false, results: [expect.objectContaining({
    code: "invalid_relationship_instance", rule_id: "RHT-31", path: sourcePath, relationship: "related_to",
  })] });
});

test("counts existing top-level and body relationships without adding nested link targets", () => {
  const root = collection({
    direct: link({ relationship_kind: "related_to", validate_exists: true }),
    details: object({ references: list(link({ validate_exists: true })) }),
  }, {}, relatedProjects(1, 1));
  writeNote(root, "Notes/Other.md", { note_type: "project" });
  writeNote(root, sourcePath, {
    note_type: "note", direct: "[[Good]]", details: { references: ["[[Other]]"] },
  }, "The same existing relationship: [[Good]].\n");
  expect(validate(root)).toMatchObject({ valid: true, evaluation: "complete", results: [] });
});

test.each([
  { name: "scalar stored in a list", definition: list(link()), value: "[[Good]]", rule: "FDR-20" },
  { name: "array stored in a scalar link", definition: link(), value: ["[[Good]]"], rule: "FDR-19" },
])("a malformed $name retains its field error without creating a relationship", ({ definition, value, rule }) => {
  const report = validate(collection({ direct: { ...definition, relationship_kind: "related_to" } }, {
    direct: value,
  }, relatedProjects(0, 0)));
  expect(report.valid).toBe(false);
  expect(report.results).toContainEqual(expect.objectContaining({
    code: "invalid_field_value", rule_id: rule, path: sourcePath, field: "direct",
  }));
  expect(report.results.filter((result) => result.code === "invalid_relationship_instance")).toEqual([]);
});

test("a missing constructor-named link does not read an inherited JavaScript value", () => {
  const report = validate(collection({ constructor: link({ validate_exists: true }) }, {}));
  expect(report.results).toEqual([expect.objectContaining({
    code: "missing_declared_field", rule_id: "MN-98", path: sourcePath, field: "constructor",
  })]);
});
