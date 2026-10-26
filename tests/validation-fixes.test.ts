import { afterEach, expect, test } from "bun:test";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { tmpdir } from "node:os";
import { stringify } from "yaml";
import { SchemaRegistry } from "../src/schema-registry";
import { validateCollection } from "../src/validator";

const roots: string[] = [];
const schemaDirectory = resolve(import.meta.dir, "../../TypedMarkSpecification/schema/json-schema");
function write(root: string, path: string, data: unknown) {
  mkdirSync(dirname(join(root, path)), { recursive: true });
  writeFileSync(join(root, path), `---\n${stringify(data)}---\n`);
}
afterEach(() => {
  for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true });
});

function run(storage: object, notes: Record<string, object>) {
  const root = mkdtempSync(join(tmpdir(), "typedmark-fixes-"));
  roots.push(root);
  write(root, "typedmark.md", { specification_version: "0.1.0", name: "fixes", description: "Fix advice." });
  write(root, ".typedmark/schemas/project.md", {
    specification_version: "0.1.0",
    description: "Projects.",
    storage,
    mandatory_tags: ["project"],
    frontmatter: { status: { type: "text", default_value: "active" }, owner: { type: "text" } },
  });
  for (const [path, stored] of Object.entries(notes)) write(root, path, { note_type: "project", ...stored });
  return validateCollection({ collectionRoot: root, schemaDirectory });
}

test("results carry fixes the schema and note determine (CR-110, CR-112)", () => {
  const report = run({ folder_pattern: "Projects", note_name_pattern: "{owner}" }, { "Inbox/Launch.md": { tags: [], status: null, owner: "Launch" } });
  const fixes = Object.fromEntries(report.results.filter((result) => result.fix).map((result) => [result.rule_id, result.fix]));
  expect(fixes).toEqual({
    "MN-128": { kind: "add_tag", tag: "project" },
    "MN-99": { kind: "unset_field", field: "status" },
    "NTS-146": { kind: "move_note", path: "Projects/Launch.md" },
  });
  expect(new SchemaRegistry(schemaDirectory).validate("validation-report.schema.json", report)).toEqual([]);
});

test("no fix is offered when a domain value is missing (CR-112)", () => {
  const report = run({ folder_pattern: "Projects" }, { "Inbox/Launch.md": { tags: ["project"] } });
  expect(report.results.filter((result) => result.fix)).toEqual([]);
  expect(report.results.map((result) => result.rule_id)).toEqual(expect.arrayContaining(["MN-98", "NTS-146"]));
});
