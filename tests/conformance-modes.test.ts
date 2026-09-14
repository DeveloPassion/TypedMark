import { afterEach, expect, test } from "bun:test";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { tmpdir } from "node:os";
import { stringify } from "yaml";
import { parseMarkdown } from "../src/frontmatter";
import { instantiateSystem } from "../src/system";
import type { ValidationMode } from "../src/types";
import { validateCollection } from "../src/validator";

const roots: string[] = [];
const sourceSnapshots = new Map<string, Record<string, Buffer>>();
const schemaDirectory = resolve(import.meta.dir, "../../TypedMarkSpecification/schema/json-schema");
const extensions = { "typedmark:systems": "0.1.0" };
const modes: ValidationMode[] = ["system_definition", "instantiated_collection", "both"];

function captureFiles(root: string): Record<string, Buffer> {
  const files: Record<string, Buffer> = {};
  function visit(directory: string, relativeDirectory = "") {
    for (const entry of readdirSync(directory, { withFileTypes: true })) {
      const path = relativeDirectory ? `${relativeDirectory}/${entry.name}` : entry.name;
      if (entry.isDirectory()) visit(join(directory, entry.name), path);
      else files[path] = readFileSync(join(directory, entry.name));
    }
  }
  visit(root);
  return files;
}

afterEach(() => {
  try {
    // CR-40: compare every source path and its bytes, including failed imports.
    for (const [root, before] of sourceSnapshots) expect(captureFiles(root)).toEqual(before);
  } finally {
    sourceSnapshots.clear();
    for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true });
  }
});

function write(root: string, path: string, data: object, body = "") {
  mkdirSync(dirname(join(root, path)), { recursive: true });
  writeFileSync(join(root, path), `---\n${stringify(data)}---\n${body}`);
}

function emptySystem(count: object = { min: 1, max: 1 }, scaffoldType = "home") {
  const root = mkdtempSync(join(tmpdir(), "typedmark-conformance-modes-"));
  roots.push(root);
  write(root, "typedmark.md", {
    specification_version: "0.1.0", name: "@example/home-system", description: "A reusable system with one required home note.",
    version: "1.0.0", extensions, scaffold: { notes: [{ path: "Home.md", note_type: scaffoldType }] },
  }, "\n# Home system\n");
  write(root, ".typedmark/schemas/home.md", {
    specification_version: "0.1.0", description: "The collection home.", count,
    storage: { folder_pattern: "", note_name_pattern: "Home" },
  });
  write(root, ".typedmark/templates/home.md", { note_type: "home", title: "Home" }, "\n# Home\n\nWelcome to this collection.\n");
  sourceSnapshots.set(root, captureFiles(root));
  expect(existsSync(join(root, "Home.md"))).toBe(false);
  return root;
}

function targetDirectory() {
  const parent = mkdtempSync(join(tmpdir(), "typedmark-conformance-target-"));
  roots.push(parent);
  return join(parent, "instance");
}

const validate = (root: string, mode: ValidationMode) => validateCollection({ collectionRoot: root, schemaDirectory, mode });

// CR-1–CR-6 and CR-14 distinguish the published model from its materialized notes.
test("system_definition accepts an empty system whose scaffold will satisfy its minimum note count", () => {
  expect(validate(emptySystem(), "system_definition")).toMatchObject({
    mode: "system_definition", evaluation: "complete", required_extensions: extensions,
    evaluated_extensions: extensions, valid: true, results: [],
  });
});

test.each(["instantiated_collection", "both"] as const)("%s rejects the same empty system's actual note count", (mode) => {
  const report = validate(emptySystem(), mode);
  expect(report).toMatchObject({ mode, evaluation: "complete", valid: false });
  expect(report.results).toEqual([expect.objectContaining({
    code: "invalid_note_count", rule_id: "NTS-71", note_type: "home", severity: "error",
  })]);
});

test("instantiation creates the required note before validating the target count", async () => {
  const source = emptySystem();
  const target = targetDirectory();
  const result = await instantiateSystem({ sourceRoot: source, targetRoot: target, collectionName: "working-home", schemaDirectory });

  expect(result.report).toMatchObject({ mode: "instantiated_collection", evaluation: "complete", valid: true, results: [] });
  expect(result.createdPaths).toContain("Home.md");
  const note = parseMarkdown(readFileSync(join(target, "Home.md")));
  expect(note.data).toMatchObject({ note_type: "home", title: "Home" });
  expect(note.body).toContain("Welcome to this collection.");
  expect(readFileSync(join(target, ".typedmark/schemas/home.md")).equals(sourceSnapshots.get(source)![".typedmark/schemas/home.md"]!)).toBe(true);
  expect(result.validateOffline()).toMatchObject({ mode: "instantiated_collection", evaluation: "complete", valid: true, results: [] });
});

test("instantiation still rejects a scaffold that leaves the target below its minimum note count", async () => {
  const source = emptySystem({ min: 2, max: 2 });
  const target = targetDirectory();

  await expect(instantiateSystem({ sourceRoot: source, targetRoot: target, collectionName: "working-home", schemaDirectory }))
    .rejects.toThrow(/Instantiated collection is not conforming:.*NTS-71/);
  expect(existsSync(target)).toBe(false);
});

// NTS-69 governs the declaration itself in every mode (CR-5 and CR-10).
test.each(modes)("%s still rejects an invalid count declaration", (mode) => {
  const report = validate(emptySystem({ min: 2, max: 1 }), mode);
  expect(report).toMatchObject({ mode, evaluation: "complete", valid: false });
  expect(report.results).toEqual([expect.objectContaining({
    code: "invalid_note_type_schema", rule_id: "NTS-69", path: ".typedmark/schemas/home.md", severity: "error",
  })]);
});

test.each(modes)("%s still rejects an unresolved scaffold declaration", (mode) => {
  const report = validate(emptySystem({ min: 0 }, "missing"), mode);
  expect(report).toMatchObject({ mode, evaluation: "complete", valid: false });
  expect(report.results).toEqual([expect.objectContaining({
    code: "invalid_system", rule_id: "SCE-17", path: "typedmark.md", note_type: "missing", severity: "error",
  })]);
});
