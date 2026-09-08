import { afterEach, expect, test } from "bun:test";
import { existsSync, mkdtempSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { tmpdir } from "node:os";
import { parseMarkdown } from "../src/frontmatter";
import { checkMigrationReadiness, instantiateSystem } from "../src/system";

const roots: string[] = [];
const schemaDirectory = resolve(import.meta.dir, "../../TypedMarkSpecification/schema/json-schema");

afterEach(() => { for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true }); });

test("instantiates a self-contained one-source composition without publishing identity", async () => {
  const source = systemFixture();
  const target = join(mkdtempSync(join(tmpdir(), "typedmark-instance-parent-")), "instance");
  roots.push(resolve(target, ".."));

  const result = await instantiateSystem({
    sourceRoot: source,
    targetRoot: target,
    collectionName: "working-notes",
    description: "My working notes.",
    schemaDirectory,
  });

  expect(result.report).toMatchObject({ evaluation: "complete", valid: true });
  const config = parseMarkdown(readFileSync(join(target, "typedmark.md"), "utf8")).data;
  expect(config.name).toBe("working-notes");
  expect(config.version).toBeUndefined();
  expect(config.scaffold).toBeUndefined();
  expect(config.composition).toEqual({ sources: [{ name: "@example/minimal", version: "0.1.0" }] });
  expect(existsSync(join(target, ".typedmark", "schemas", "note.md"))).toBe(true);
  expect(existsSync(join(target, "Notes", "Welcome.md"))).toBe(true);

  rmSync(source, { recursive: true, force: true });
  expect(result.validateOffline().valid).toBe(true);
});

test("refuses automatic migration classification when source history is absent", () => {
  const source = systemFixture("0.2.0");
  expect(checkMigrationReadiness({ systemRoot: source, fromVersion: "0.1.0", schemaDirectory })).toEqual({
    status: "manual_resolution_required",
    reasons: ["The target system has no history.md for classifying the 0.1.0 to 0.2.0 update."],
  });
});

function systemFixture(version = "0.1.0"): string {
  const root = mkdtempSync(join(tmpdir(), "typedmark-system-"));
  roots.push(root);
  mkdirSync(join(root, ".typedmark", "schemas"), { recursive: true });
  mkdirSync(join(root, ".typedmark", "templates"), { recursive: true });
  writeFileSync(join(root, "typedmark.md"), `---
specification_version: 0.1.0
extensions:
  typedmark:systems: 0.1.0
name: "@example/minimal"
description: Minimal reusable system.
version: ${version}
publisher:
  name: Example Publisher
license: MIT
scaffold:
  folders: [Notes]
  notes:
    - path: Notes/Welcome.md
      note_type: note
      values:
        title: Welcome
---
`);
  writeFileSync(join(root, ".typedmark", "schemas", "note.md"), `---
specification_version: 0.1.0
note_type: note
description: A note.
storage:
  folder_pattern: Notes
  note_name_pattern: "{title}"
frontmatter:
  title:
    type: text
    nullable: false
---
`);
  writeFileSync(join(root, ".typedmark", "templates", "note.md"), `---
note_type: note
title: null
---

# Welcome
`);
  return root;
}
