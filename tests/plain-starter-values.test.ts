import { afterEach, expect, test } from "bun:test";
import { mkdtempSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { tmpdir } from "node:os";
import { parseDocument } from "yaml";
import { plainDataViolation } from "../src/plain-yaml";
import { instantiateSystem } from "../src/system";
import { validateCollection } from "../src/validator";

const roots: string[] = [];
const schemaDirectory = resolve(import.meta.dir, "../../TypedMarkSpecification/schema/json-schema");
afterEach(() => { for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true }); });

// Parse as the frontmatter reader does (FND-25), so Core scalars stay plain.
const yaml = (source: string) => parseDocument(source, { version: "1.2", schema: "core", resolveKnownTags: true, merge: false, uniqueKeys: true });

test.each([
  ["a: 1\nb: [x, {c: 2026-01-01}]\n<<: literal\n", undefined],
  ["a: &x 1\n", "an anchor &x"],
  ["a: !!set {q}\n", "an explicit tag tag:yaml.org,2002:set"],
  ["a: !!str 2\n", "an explicit tag tag:yaml.org,2002:str"],
  ["a: {? [k] : v}\n", "a non-string mapping key"],
  ["a: {1: v}\n", "a non-string mapping key"],
])("plain-data check for %j", (source, expected) => {
  expect(plainDataViolation(yaml(source))).toBe(expected);
});

test("an alias is reported even when its anchor lies outside the checked node", () => {
  const document = yaml("x: &x 1\nb: [*x]\n");
  expect(plainDataViolation(document.get("b", true) as never)).toBe("an alias");
});

function system(values: string, template = "note_type: note\ntitle: null\n") {
  const root = mkdtempSync(join(tmpdir(), "typedmark-plain-starter-")); roots.push(root);
  mkdirSync(join(root, ".typedmark", "schemas"), { recursive: true });
  mkdirSync(join(root, ".typedmark", "templates"), { recursive: true });
  writeFileSync(join(root, "typedmark.md"), `---
specification_version: 0.1.0
extensions:
  typedmark:systems: 0.1.0
name: "@example/plain"
description: Plain starter values.
version: 0.1.0
scaffold:
  notes:
    - path: Notes/Welcome.md
      note_type: note
      values:
${values.split("\n").filter(Boolean).map((line) => `        ${line}`).join("\n")}
---
`);
  writeFileSync(join(root, ".typedmark", "schemas", "note.md"), `---
specification_version: 0.1.0
description: A note.
storage:
  folder_pattern: Notes
  note_name_pattern: "{title}"
frontmatter:
  title: {type: text, nullable: false}
  extra: {type: any, nullable: true, default_value: null}
---
`);
  writeFileSync(join(root, ".typedmark", "templates", "note.md"), `---\n${template}---\n\n# Welcome\n`);
  return root;
}
const definition = (root: string) => validateCollection({ collectionRoot: root, schemaDirectory, mode: "system_definition" });
const instantiate = (root: string) => {
  const target = join(mkdtempSync(join(tmpdir(), "typedmark-plain-target-")), "instance"); roots.push(resolve(target, ".."));
  return instantiateSystem({ sourceRoot: root, targetRoot: target, collectionName: "working", description: "Working.", schemaDirectory });
};

test("plain scaffold values and templates instantiate", async () => {
  const root = system("title: Welcome\nextra: {when: 2026-01-01, tags: [a, b]}");
  expect(definition(root)).toMatchObject({ valid: true, results: [] });
  expect((await instantiate(root)).report).toMatchObject({ valid: true });
});

test.each([
  ["title: Welcome\nextra: !!set {a, b}", "explicit tag"],
  ["title: &t Welcome\nextra: *t", "anchor"],
  ["title: Welcome\nextra: {? [north, east] : 1}", "non-string mapping key"],
])("system definitions report non-plain scaffold values (SCE-159) and importers refuse them (SCE-160): %j", async (values, construct) => {
  const root = system(values);
  expect(definition(root).results).toContainEqual(expect.objectContaining({ code: "invalid_system", rule_id: "SCE-159", message: expect.stringContaining(construct) }));
  // Source validation already refuses the system before anything is written.
  await expect(instantiate(root)).rejects.toThrow(/SCE-159/);
});

test("anchors elsewhere in a system's typedmark.md are also rejected", async () => {
  const root = system("title: Welcome");
  const config = join(root, "typedmark.md");
  writeFileSync(config, readFileSync(config, "utf8").replace("description: Plain starter values.", "description: &d Plain starter values.\nlabel: *d"));
  expect(definition(root).results).toContainEqual(expect.objectContaining({ rule_id: "SCE-159" }));
  await expect(instantiate(root)).rejects.toThrow(/SCE-159/);
});

test("importers refuse templates whose frontmatter is not plain data (SCE-160)", async () => {
  const root = system("title: Welcome", "note_type: note\ntitle: null\nextra: !!omap [{a: 1}]\n");
  await expect(instantiate(root)).rejects.toMatchObject({ rule: "SCE-160" });
});
