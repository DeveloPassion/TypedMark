import { afterEach, expect, test } from "bun:test";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { tmpdir } from "node:os";
import { stringify } from "yaml";
import { validateCollection } from "../src/validator";

const roots: string[] = [];
const schemaDirectory = resolve(import.meta.dir, "../../TypedMarkSpecification/schema/json-schema");
afterEach(() => {
  for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true });
});

function write(root: string, path: string, data: unknown, body = "") {
  mkdirSync(dirname(join(root, path)), { recursive: true });
  writeFileSync(join(root, path), `---\n${stringify(data)}---\n${body}`);
}
const projectLink = { type: "link", format: "note_link", targets: ["project"], relationship_kind: "belongs_to", nullable: false };
const relationships = { belongs_to: { allowed_note_types: { project: {} } }, related_to: { allowed_note_types: {} } };
function collection(decisionStorage: object, notes: Record<string, object>, decisionFields: object = { project: projectLink }) {
  const root = mkdtempSync(join(tmpdir(), "typedmark-linked-storage-"));
  roots.push(root);
  write(root, "typedmark.md", { specification_version: "0.1.0", name: "linked", description: "Linked storage." });
  write(root, ".typedmark/schemas/project.md", { specification_version: "0.1.0", description: "Project.", storage: { folder_pattern: "Projects", note_name_pattern: "{title}" } });
  write(root, ".typedmark/schemas/root-project.md", { specification_version: "0.1.0", description: "Root project.", storage: { folder_pattern: "", note_name_pattern: "{title}" } });
  write(root, ".typedmark/schemas/decision.md", {
    specification_version: "0.1.0",
    description: "Decision log beside its project.",
    storage: decisionStorage,
    frontmatter: decisionFields,
    relationships: { ...relationships, belongs_to: { allowed_note_types: { project: {}, "root-project": {} } } },
  });
  for (const [path, stored] of Object.entries(notes)) write(root, path, stored);
  return root;
}
const beside = { folder_pattern: "{project:folder}/{project:name}", note_name_pattern: "Decisions" };
const rootLink = { ...projectLink, targets: ["project", "root-project"] };
const run = (root: string) => validateCollection({ collectionRoot: root, schemaDirectory });
const paths = (root: string) => run(root).results.map((result) => [result.path, result.rule_id]);

test("companion notes live beside their parent through {field:folder}/{field:name} (NTS-184)", () => {
  const root = collection(beside, {
    "Projects/Launch.md": { note_type: "project", title: "Launch" },
    "Projects/Launch/Decisions.md": { note_type: "decision", title: "Decisions", project: "[[Launch]]" },
  });
  expect(run(root)).toMatchObject({ valid: true, results: [] });
});

test("a root-level parent leaves an empty folder segment that is dropped (NTS-185)", () => {
  const root = collection(
    beside,
    {
      "Launch.md": { note_type: "root-project", title: "Launch" },
      "Launch/Decisions.md": { note_type: "decision", title: "Decisions", project: "[[Launch]]" },
    },
    { project: rootLink },
  );
  expect(run(root)).toMatchObject({ valid: true, results: [] });
});

test("a companion outside its parent's folder is a path mismatch (NTS-146)", () => {
  const root = collection(beside, {
    "Projects/Launch.md": { note_type: "project", title: "Launch" },
    "Projects/Other/Decisions.md": { note_type: "decision", title: "Decisions", project: "[[Launch]]" },
  });
  expect(run(root).results).toEqual([
    expect.objectContaining({ code: "path", path: "Projects/Other/Decisions.md", rule_id: "NTS-146", message: expect.stringContaining("Projects/Launch/Decisions.md") }),
  ]);
});

test("a placeholder whose link resolves to no managed note leaves the path unresolvable (NTS-186)", () => {
  const root = collection(beside, { "Projects/Launch/Decisions.md": { note_type: "decision", title: "Decisions", project: "[[Missing]]" } });
  expect(paths(root)).toContainEqual(["Projects/Launch/Decisions.md", "NTS-186"]);
});

test("free names and affixes combine with linked-note folders", () => {
  const storage = { folder_pattern: "{project:folder}/{project:name}/Decisions", note_name_prefix: { pattern: "{project:name} - " }, note_name_regex: "^\\S.*$" };
  const root = collection(storage, {
    "Projects/Launch.md": { note_type: "project", title: "Launch" },
    "Projects/Launch/Decisions/Launch - Use Bun.md": { note_type: "decision", project: "[[Launch]]" },
    "Projects/Launch/Decisions/Use Bun.md": { note_type: "decision", project: "[[Launch]]" },
  });
  expect(paths(root)).toEqual([["Projects/Launch/Decisions/Use Bun.md", "NTS-146"]]);
});

test.each([
  ["{title:name}", "Decisions", "NTS-127"],
  ["{project:folder}", "{project:folder}", "NTS-185"],
  ["{project:YYYY}", "Decisions", "NTS-127"],
])("invalid linked-note placeholder declarations: folder %j, name %j", (folder, name, rule) => {
  const root = collection({ folder_pattern: folder, note_name_pattern: name }, {});
  expect(run(root).results).toContainEqual(expect.objectContaining({ code: "invalid_note_type_schema", rule_id: rule }));
});

test("link placeholders need a single note-link field, not a list", () => {
  const root = collection(beside, {}, { project: { type: "list", items: { type: "link", format: "note_link", targets: ["project"] }, relationship_kind: "belongs_to", default_value: [] } });
  expect(run(root).results).toContainEqual(expect.objectContaining({ code: "invalid_note_type_schema", rule_id: "NTS-132" }));
});
