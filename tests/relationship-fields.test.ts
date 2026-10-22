import { afterEach, expect, test } from "bun:test";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { tmpdir } from "node:os";
import { stringify } from "yaml";
import { validateCollection } from "../src/validator";

const roots: string[] = [];
const schemaDirectory = resolve(import.meta.dir, "../../TypedMarkSpecification/schema/json-schema");
const version = { specification_version: "0.1.0" };
function write(root: string, path: string, data: unknown) {
  mkdirSync(dirname(join(root, path)), { recursive: true });
  writeFileSync(join(root, path), `---\n${stringify(data)}---\n`);
}
type Schema = { frontmatter?: object; relationships?: object; abstract?: boolean; extends?: string };
function collection(schemas: Record<string, Schema>, notes: Record<string, object> = {}, config: object = {}) {
  const root = mkdtempSync(join(tmpdir(), "typedmark-relationship-fields-")); roots.push(root);
  const reuse = Object.values(schemas).some((schema) => schema.abstract || schema.extends);
  write(root, "typedmark.md", { ...version, name: "relationships", description: "Relationships.", ...(reuse ? { extensions: { "typedmark:reuse": "0.1.0" } } : {}), ...config });
  for (const [name, schema] of Object.entries(schemas)) {
    write(root, `.typedmark/schemas/${name}.md`, { ...version, description: name, ...(schema.abstract ? {} : { storage: { folder_pattern: name, note_name_pattern: "{title}" } }), ...schema });
  }
  for (const [path, stored] of Object.entries(notes)) write(root, path, stored);
  return root;
}
const run = (root: string) => validateCollection({ collectionRoot: root, schemaDirectory });
const rules = (root: string) => run(root).results.map((result) => `${result.code}:${result.rule_id}:${result.path}`).sort();
afterEach(() => { for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true }); });

const linkList = (targets?: string[], extra: object = {}) => ({ type: "list", items: { type: "link", format: "note_link", ...(targets ? { targets } : {}) }, default_value: [], ...extra });
const block = (belongs: object = {}, related: object = {}, extra: object = {}) => ({ belongs_to: { allowed_note_types: belongs }, related_to: { allowed_note_types: related }, ...extra });

test("field targets must be declared under the field's relationship kind (FDR-164)", () => {
  const schemas = (targets: string[]) => ({
    project: {}, goal: {},
    task: { relationships: block({ project: {} }), frontmatter: { related_projects: linkList(targets, { relationship_kind: "belongs_to" }) } },
  });
  expect(rules(collection(schemas(["project"])))).toEqual([]);
  expect(rules(collection(schemas(["project", "goal"])))).toEqual(["invalid_relationship_definition:FDR-164:.typedmark/schemas/task.md"]);
});

test("abstract field targets are expanded before the declaration check", () => {
  const schemas = (declared: object) => ({
    work: { abstract: true }, project: { extends: "work" }, program: { extends: "work" },
    task: { relationships: block(declared), frontmatter: { parent: linkList(["work"], { relationship_kind: "belongs_to" }) } },
  });
  expect(rules(collection(schemas({ work: {} })))).toEqual([]);
  expect(rules(collection(schemas({ project: {}, program: {} })))).toEqual([]);
  expect(rules(collection(schemas({ project: {} })))).toEqual(["invalid_relationship_definition:FDR-164:.typedmark/schemas/task.md"]);
});

test("one field per relationship kind and concrete target type (RHT-292)", () => {
  const schemas = (second: object) => ({
    project: {}, person: {},
    task: { relationships: block({ project: {} }, { person: {} }), frontmatter: { related_projects: linkList(["project"], { relationship_kind: "belongs_to" }), ...second } },
  });
  expect(rules(collection(schemas({ owners: linkList(["person"], { relationship_kind: "related_to" }) })))).toEqual([]);
  expect(rules(collection(schemas({ watchers: linkList(["person"], { relationship_kind: "related_to" }), reviewers: linkList(["person"], { relationship_kind: "related_to" }) }))))
    .toEqual(["invalid_relationship_definition:RHT-292:.typedmark/schemas/task.md"]);
  // A field without targets admits every type declared under its kind.
  expect(rules(collection(schemas({ also_projects: linkList(undefined, { relationship_kind: "belongs_to" }) }))))
    .toEqual(["invalid_relationship_definition:RHT-292:.typedmark/schemas/task.md"]);
});

test("fields without relationship_kind are unconstrained by relationship declarations", () => {
  const root = collection({ project: {}, task: { frontmatter: { links: linkList(["project"]), more: linkList(["project"]) } } });
  expect(rules(root)).toEqual([]);
});

const taskSchemas = (extra: object = {}) => ({
  project: { relationships: block({}, {}, { contains: { allowed_note_types: { task: { max: 2 } } } }), frontmatter: { tasks: linkList(["task"], { relationship_kind: "contains" }) } },
  task: { relationships: block({}, {}, { depends_on: { allowed_note_types: { task: {} } } }), frontmatter: { after: linkList(["task"], { relationship_kind: "depends_on" }), ...extra } },
});

test("contains and depends_on instances count against their declared cardinality", () => {
  const notes = (tasks: string[]) => ({
    "project/P.md": { note_type: "project", title: "P", tasks },
    "task/A.md": { note_type: "task", title: "A" }, "task/B.md": { note_type: "task", title: "B" }, "task/C.md": { note_type: "task", title: "C" },
  });
  expect(rules(collection(taskSchemas(), notes(["[[A]]", "[[B]]"])))).toEqual([]);
  expect(run(collection(taskSchemas(), notes(["[[A]]", "[[B]]", "[[C]]"]))).results).toEqual([expect.objectContaining({
    code: "invalid_relationship_instance", path: "project/P.md", relationship: "contains", rule_id: "RHT-31",
  })]);
});

test("depends_on cycles are reported on every note in the cycle (RHT-294)", () => {
  const root = collection(taskSchemas(), {
    "task/A.md": { note_type: "task", title: "A", after: ["[[B]]"] },
    "task/B.md": { note_type: "task", title: "B", after: ["[[C]]"] },
    "task/C.md": { note_type: "task", title: "C", after: ["[[A]]"] },
    "task/D.md": { note_type: "task", title: "D", after: ["[[A]]"] },
    "task/E.md": { note_type: "task", title: "E", after: ["[[E]]"] },
  });
  expect(rules(root)).toEqual(["A", "B", "C", "E"].map((name) => `invalid_relationship_instance:RHT-294:task/${name}.md`));
});

test("acyclic dependency chains and diamonds are valid", () => {
  const root = collection(taskSchemas(), {
    "task/A.md": { note_type: "task", title: "A", after: ["[[B]]", "[[C]]"] },
    "task/B.md": { note_type: "task", title: "B", after: ["[[D]]"] },
    "task/C.md": { note_type: "task", title: "C", after: ["[[D]]"] },
    "task/D.md": { note_type: "task", title: "D" },
  });
  expect(rules(root)).toEqual([]);
});

test("a long dependency chain does not overflow the cycle check", () => {
  const notes: Record<string, object> = {};
  for (let index = 0; index < 3000; index++) notes[`task/T${index}.md`] = { note_type: "task", title: `T${index}`, after: index ? [`[[T${index - 1}]]`] : [] };
  expect(rules(collection(taskSchemas(), notes))).toEqual([]);
});

test("a topic may both belong to and contain topics", () => {
  const root = collection({ topic: {
    relationships: block({ topic: { max: 1 } }, {}, { contains: { allowed_note_types: { topic: {} } } }),
    frontmatter: { parent: { type: "link", format: "note_link", targets: ["topic"], relationship_kind: "belongs_to", nullable: true, default_value: null },
      children: linkList(["topic"], { relationship_kind: "contains" }) },
  } }, {
    "topic/Root.md": { note_type: "topic", title: "Root", children: ["[[Leaf]]"] },
    "topic/Leaf.md": { note_type: "topic", title: "Leaf", parent: "[[Root]]" },
  });
  expect(rules(root)).toEqual([]);
});
