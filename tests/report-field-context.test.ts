import { afterEach, expect, test } from "bun:test";
import { mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { stringify } from "yaml";
import { SchemaRegistry } from "../src/schema-registry";
import { validateCollection } from "../src/validator";

const schemaDirectory = resolve(import.meta.dir, "../../TypedMarkSpecification/schema/json-schema");
const registry = new SchemaRegistry(schemaDirectory);
const roots: string[] = [];
const notePath = "Notes/Café.md";
type UnknownFieldPolicy = "error" | "warn" | "info" | "off";

function collection(stored: Record<string, unknown>, options: {
  fields?: Record<string, unknown>;
  configuredPolicy?: UnknownFieldPolicy;
  schemaPolicy?: UnknownFieldPolicy;
} = {}) {
  const root = mkdtempSync(join(tmpdir(), "typedmark-report-field-context-"));
  roots.push(root);
  mkdirSync(join(root, ".typedmark/schemas"), { recursive: true });
  mkdirSync(join(root, "Notes"));
  const config = {
    specification_version: "0.1.0", name: "field-context", description: "Portable field contexts.",
    ...(options.configuredPolicy ? { validation_defaults: { unknown_field: options.configuredPolicy } } : {}),
  };
  const schema = {
    specification_version: "0.1.0", description: "Note.",
    storage: { folder_pattern: "Notes", note_name_pattern: "{title}" },
    frontmatter: options.fields ?? {},
    ...(options.schemaPolicy ? { unknown_field: options.schemaPolicy } : {}),
  };
  const files = {
    "typedmark.md": `---\n${stringify(config)}---\nCollection prose.\n`,
    ".typedmark/schemas/note.md": `---\n${stringify(schema)}---\nSchema prose.\n`,
    [notePath]: `\uFEFF---\n${stringify({ note_type: "note", ...stored })}---\n# Café\n\nAuthored content.\n`,
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

function run(root: string) {
  const before = sourceTree(root);
  try { return validateCollection({ collectionRoot: root, schemaDirectory }); }
  finally { expect(sourceTree(root)).toEqual(before); }
}

afterEach(() => { for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true }); });

test("ordinary unknown fields retain useful top-level and nested report contexts", () => {
  const report = run(collection({ extra_field: true, details: { extra: true } }, {
    fields: { details: { type: "object", fields: {} } },
  }));
  expect(registry.validate("validation-report.schema.json", report)).toEqual([]);
  expect(report).toMatchObject({ evaluation: "complete", valid: true });
  expect(report.results).toEqual([
    expect.objectContaining({ code: "unknown_field", severity: "warn", rule_id: "MN-111", path: notePath, note_type: "note", field: "extra_field" }),
    expect.objectContaining({ code: "unknown_field", severity: "warn", rule_id: "MN-112", path: notePath, note_type: "note", field: "details.extra" }),
  ]);
});

test("unknown children in separate list items use portable field names without losing findings", () => {
  const report = run(collection({ sections: [{ extra: true }, { extra: false }] }, {
    fields: { sections: { type: "list", items: { type: "object", fields: {} } } },
  }));
  expect(registry.validate("validation-report.schema.json", report)).toEqual([]);
  expect(report).toMatchObject({ evaluation: "complete", valid: true });
  expect(report.results.map((result) => result.message)).toEqual(expect.arrayContaining([
    "sections.0.extra is not declared", "sections.1.extra is not declared",
  ]));
  expect(report.results).toEqual(Array.from({ length: 2 }, () => expect.objectContaining({
    code: "unknown_field", severity: "warn", rule_id: "MN-112", path: notePath, note_type: "note", field: "sections.extra",
  })));
});

test("unknown children retain their dotted context through nested object and list containers", () => {
  const report = run(collection({ details: { groups: [[{ extra: true }]] } }, {
    fields: {
      details: { type: "object", fields: {
        groups: { type: "list", items: { type: "list", items: { type: "object", fields: {} } } },
      } },
    },
  }));
  expect(registry.validate("validation-report.schema.json", report)).toEqual([]);
  expect(report.results).toEqual([expect.objectContaining({
    code: "unknown_field", severity: "warn", rule_id: "MN-112", path: notePath, note_type: "note", field: "details.groups.extra",
  })]);
});

// MN-25 constrains declarations, not unknown stored names. CR-37 makes field
// context optional and supplies no escaping grammar for these names. These
// cases enforce portable reports and the existing unknown-field policy without
// inventing an encoding. A literal dot also illustrates the schema's limit:
// the same string can resemble a nested path without naming a nested property.
for (const location of ["top-level", "object", "list item"] as const) {
  test.each(["display name", "reviewed-at", "123", "literal.dot", "trailing\n", "__proto__"])(
    `unknown ${location} name %j keeps its diagnostic in a schema-valid report`, (name) => {
      const property = { [name]: true };
      const root = location === "top-level" ? collection(property)
        : location === "object" ? collection({ details: property }, { fields: { details: { type: "object", fields: {} } } })
        : collection({ sections: [property] }, { fields: { sections: { type: "list", items: { type: "object", fields: {} } } } });
      const report = run(root);
      expect(registry.validate("validation-report.schema.json", report)).toEqual([]);
      expect(report).toMatchObject({ evaluation: "complete", valid: true });
      for (const finding of report.results) {
        expect(finding).not.toHaveProperty("field");
        expect(finding.message).toContain(name);
      }
      expect(report.results).toEqual([expect.objectContaining({
        code: "unknown_field", severity: "warn", path: notePath, note_type: "note",
        rule_id: location === "top-level" ? "MN-111" : "MN-112",
      })]);
    },
  );
}

test.each([
  { name: "collection severity", configuredPolicy: "error", schemaPolicy: undefined, severity: "error" },
  { name: "schema override", configuredPolicy: "error", schemaPolicy: "info", severity: "info" },
  { name: "schema suppression", configuredPolicy: "error", schemaPolicy: "off", severity: undefined },
] as const)("portable contexts preserve $name for unknown stored properties", ({ configuredPolicy, schemaPolicy, severity }) => {
  const report = run(collection({ "display name": true, sections: [{ extra: true }] }, {
    fields: { sections: { type: "list", items: { type: "object", fields: {} } } },
    configuredPolicy, schemaPolicy,
  }));
  expect(registry.validate("validation-report.schema.json", report)).toEqual([]);
  expect(report).toMatchObject({ evaluation: "complete", valid: severity !== "error" });
  expect(report.results).toEqual(severity === undefined ? [] : [
    expect.objectContaining({ code: "unknown_field", severity, rule_id: "MN-111", path: notePath, note_type: "note" }),
    expect.objectContaining({ code: "unknown_field", severity, rule_id: "MN-112", path: notePath, note_type: "note", field: "sections.extra" }),
  ]);
});
