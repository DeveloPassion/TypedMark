import { afterEach, expect, test } from "bun:test";
import { mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { stringify } from "yaml";
import type { FieldDefinition } from "../src/field-values";
import { queryCollection } from "../src/query";
import { SchemaRegistry } from "../src/schema-registry";
import { validateCollection } from "../src/validator";

const schemaDirectory = resolve(import.meta.dir, "../../TypedMarkSpecification/schema/json-schema");
const registry = new SchemaRegistry(schemaDirectory);
const sourcePath = "Notes/Source.md";
const roots: string[] = [];
const link = (constraints: Partial<FieldDefinition> = {}): FieldDefinition => ({
  type: "link", format: "note_link", ...constraints,
});
const list = (items: FieldDefinition): FieldDefinition => ({ type: "list", items });
const object = (fields: Record<string, FieldDefinition>): FieldDefinition => ({ type: "object", fields });

function write(root: string, path: string, data: Record<string, unknown>) {
  mkdirSync(dirname(join(root, path)), { recursive: true });
  writeFileSync(join(root, path), `\uFEFF---\n# Keep this authored comment.\n${stringify(data)}---\nBody prose.\n`.replaceAll("\n", "\r\n"));
}

function collection(fields: Record<string, FieldDefinition>, stored: Record<string, unknown>, severity = "error") {
  const root = mkdtempSync(join(tmpdir(), "typedmark-note-link-diagnostics-"));
  roots.push(root);
  write(root, "typedmark.md", {
    specification_version: "0.1.0", name: "note-link-diagnostics", description: "Field diagnostic routing.",
    validation_defaults: { invalid_note_link: severity },
  });
  for (const noteType of ["source", "target"]) {
    write(root, `.typedmark/schemas/${noteType}.md`, {
      specification_version: "0.1.0", description: `${noteType} notes.`,
      storage: { folder_pattern: "Notes", note_name_pattern: "{title}" },
      ...(noteType === "source" ? { frontmatter: fields } : {}),
    });
  }
  write(root, sourcePath, { note_type: "source", ...stored });
  write(root, "Notes/N.md", { note_type: "target" });
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
  } finally { expect(sourceTree(root)).toEqual(before); }
}

afterEach(() => { for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true }); });

const malformedTarget = "[label](N&percnt;GG.md)";
const malformedFragment = "[label](N.md#bad%2)";
const shapes: Array<{
  name: string; fields: Record<string, FieldDefinition>; stored: Record<string, unknown>; field: string; count: number;
}> = [
  {
    name: "scalar", fields: { reference: link() }, stored: { reference: malformedTarget },
    field: "reference", count: 1,
  },
  {
    name: "link list", fields: { references: list(link()) },
    stored: { references: [malformedTarget, malformedFragment] }, field: "references", count: 2,
  },
  {
    name: "object-list leaf", fields: { details: object({ entries: list(object({ reference: link() })) }) },
    stored: { details: { entries: [{ reference: malformedTarget }, { reference: malformedFragment }] } },
    field: "details.entries.reference", count: 2,
  },
];

// CM-54/61: note-link syntax has one category, even when recursive field
// validation also examines that leaf. CR-38 uses names, never list indices.
test.each(["error", "warn", "off"].flatMap((severity) => shapes.map((shape) => ({ ...shape, severity }))))(
  "routes $name malformed links only through invalid_note_link at $severity severity",
  ({ fields, stored, field, count, severity }) => {
    const report = validate(collection(fields, stored, severity));
    expect(report.results).toEqual(severity === "off" ? [] : Array.from({ length: count }, () => expect.objectContaining({
      code: "invalid_note_link", rule_id: "NL-6", path: sourcePath, note_type: "source", field, severity,
    })));
    expect(report).toMatchObject({ valid: severity !== "error", evaluation: "complete" });
  },
);

test("other invalid strings in a note-link list receive NL-7 without duplicate field-format findings", () => {
  const report = validate(collection({ references: list(link()) }, {
    references: ["not a link", "[external](https://example.com)", "![[N]]", "[[N]] [[N]]"],
  }));
  expect(report.results).toEqual(Array.from({ length: 4 }, () => expect.objectContaining({
    code: "invalid_note_link", rule_id: "NL-7", path: sourcePath, field: "references", severity: "error",
  })));
});

test("note-link diagnostic routing retains independent regex, blank, length, and number constraints", () => {
  const report = validate(collection({
    restricted: link({ regex: "\\[\\[Allowed\\]\\]" }),
    nonblank: link({ not_blank: true }), short: link({ min: 50 }), score: { type: "number" },
  }, {
    restricted: malformedTarget, nonblank: " ", short: malformedFragment, score: "not a number",
  }, "off"));
  expect(report.results).toEqual([
    expect.objectContaining({ code: "invalid_field_value", field: "score", rule_id: "FDR-11" }),
    expect.objectContaining({ code: "invalid_field_value", field: "nonblank", rule_id: "FDR-176" }),
    expect.objectContaining({ code: "invalid_field_value", field: "restricted", rule_id: "FDR-181" }),
    expect.objectContaining({ code: "invalid_field_value", field: "short", rule_id: "FDR-187" }),
  ]);
  expect(report.valid).toBe(false);
});

test("a suppressed nested syntax failure does not hide the later sibling's numeric type failure", () => {
  const report = validate(collection({ entries: list(object({ reference: link(), score: { type: "number" } })) }, {
    entries: [{ reference: malformedTarget, score: "not a number" }],
  }, "off"));
  expect(report.results).toEqual([expect.objectContaining({ code: "invalid_field_value", rule_id: "FDR-11" })]);
  expect(report.valid).toBe(false);
});

test("suppressing all note-link findings leaves dependent query evaluation blocked", () => {
  const root = collection({ details: object({ references: list(link()) }) }, {
    details: { references: [malformedTarget, malformedFragment] },
  }, "off");
  const before = sourceTree(root);
  try {
    expect(() => queryCollection({ collectionRoot: root, schemaDirectory, queryVersion: "0.1.0", query: {
      specification_version: "0.1.0", note_types: ["source"], select: [{ kind: "path", as: "path" }],
    } })).toThrow("CM-307: NL-6:");
    expect(validate(root)).toMatchObject({ valid: true, evaluation: "complete", results: [] });
  } finally { expect(sourceTree(root)).toEqual(before); }
});
