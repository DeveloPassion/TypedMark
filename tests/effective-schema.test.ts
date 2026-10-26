import { afterEach, expect, test } from "bun:test";
import { mkdirSync, mkdtempSync, readdirSync, rmSync, writeFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { tmpdir } from "node:os";
import { stringify } from "yaml";
import { EffectiveSchemaError, exportCollectionEffectiveSchema } from "../src/effective-schema";
import { SchemaRegistry } from "../src/schema-registry";

const schemaDirectory = resolve(import.meta.dir, "../../TypedMarkSpecification/schema/json-schema");
const roots: string[] = [];
afterEach(() => {
  for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true });
});
function write(root: string, path: string, data: unknown) {
  mkdirSync(dirname(join(root, path)), { recursive: true });
  writeFileSync(join(root, path), `---\n${stringify(data)}---\n`);
}

function collection() {
  const root = mkdtempSync(join(tmpdir(), "typedmark-effective-schema-"));
  roots.push(root);
  write(root, "typedmark.md", {
    specification_version: "0.1.0",
    name: "effective",
    description: "Effective schemas.",
    extensions: { "typedmark:reuse": "0.1.0" },
    mandatory_tags: ["work"],
    default_property_sets: ["people"],
  });
  write(root, ".typedmark/property-sets/people.md", {
    specification_version: "0.1.0",
    property_set: "people",
    description: "People involved.",
    frontmatter: { attendees: { type: "list", items: { type: "text" }, nullable: true } },
  });
  write(root, ".typedmark/schemas/event.md", {
    specification_version: "0.1.0",
    abstract: true,
    description: "Dated events.",
    frontmatter: { meeting_date: { type: "date", nullable: true } },
    mandatory_tags: ["event"],
  });
  write(root, ".typedmark/schemas/meeting.md", {
    specification_version: "0.1.0",
    extends: "event",
    description: "A dated meeting note.",
    storage: { folder_pattern: "Meetings" },
    inputs: ["status"],
    frontmatter: { status: { type: "text", allowed_values: ["draft", "final"], default_value: "draft" }, title: { type: "text", nullable: false } },
  });
  return root;
}

test("exports effective fields with their origins (ES-1 to ES-8)", () => {
  const document = exportCollectionEffectiveSchema({ collectionRoot: collection(), schemaDirectory }, "meeting");
  expect(new SchemaRegistry(schemaDirectory).validate("effective-schema.schema.json", document)).toEqual([]);
  expect(document).toMatchObject({ contract: "typedmark:effective-schema", note_type: "meeting", ancestors: ["event"], inputs: ["status"] });
  expect(document.mandatory_tags).toEqual(["work", "event"]);
  const origins = Object.fromEntries(Object.entries(document.fields as Record<string, { origin: unknown }>).map(([name, field]) => [name, field.origin]));
  expect(origins).toMatchObject({
    tags: { kind: "core" },
    title: { kind: "local" },
    status: { kind: "local" },
    meeting_date: { kind: "ancestor", source: "event" },
    attendees: { kind: "property_set", source: "people" },
  });
});

test("refuses abstract and unknown types and never writes into the collection (ES-9)", () => {
  const root = collection();
  const before = readdirSync(join(root, ".typedmark"), { recursive: true }).sort();
  for (const type of ["event", "missing"])
    expect(() => exportCollectionEffectiveSchema({ collectionRoot: root, schemaDirectory }, type)).toThrow(EffectiveSchemaError);
  expect(readdirSync(join(root, ".typedmark"), { recursive: true }).sort()).toEqual(before);
});
