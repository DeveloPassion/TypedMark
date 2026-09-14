import { afterEach, expect, test } from "bun:test";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, readlinkSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { stringify } from "yaml";
import { parseMarkdown } from "../src/frontmatter";
import { analyzeQuery, parseQuery } from "../src/query-engine";
import { SchemaRegistry } from "../src/schema-registry";
import { checkMigrationReadiness, instantiateSystem } from "../src/system";
import type { ValidationMode, ValidationResult } from "../src/types";
import { readCollectionModel, validateCollection } from "../src/validator";
import { validateViews } from "../src/views";

type Data = Record<string, unknown>;
const roots: string[] = [];
const sourceSnapshots = new Map<string, Record<string, Buffer>>();
const schemaDirectory = resolve(import.meta.dir, "../../TypedMarkSpecification/schema/json-schema");
const systems = { "typedmark:systems": "0.1.0" };
const queries = { ...systems, "typedmark:queries": "0.1.0", "typedmark:views": "0.1.0" };

function captureFiles(root: string): Record<string, Buffer> {
  const files: Record<string, Buffer> = {};
  function visit(directory: string, prefix = "") {
    for (const entry of readdirSync(directory, { withFileTypes: true })) {
      const path = prefix + entry.name;
      if (entry.isSymbolicLink()) files[`symlink:${path}`] = Buffer.from(readlinkSync(join(directory, entry.name)));
      else if (entry.isDirectory()) visit(join(directory, entry.name), `${path}/`);
      else files[path] = readFileSync(join(directory, entry.name));
    }
  }
  visit(root);
  return files;
}

afterEach(() => {
  try {
    // CR-40 includes every original path and byte, even after a rejected import.
    for (const [root, before] of sourceSnapshots) expect(captureFiles(root)).toEqual(before);
  } finally {
    sourceSnapshots.clear();
    for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true });
  }
});

function writeBytes(root: string, path: string, bytes: string | Buffer) {
  mkdirSync(dirname(join(root, path)), { recursive: true });
  writeFileSync(join(root, path), bytes);
}

function write(root: string, path: string, data: Data, body = "") {
  writeBytes(root, path, `---\n${stringify(data)}---\n${body}`);
}

function system(config: Data = {}, schema: Data = {}) {
  const root = mkdtempSync(join(tmpdir(), "typedmark-definition-scope-"));
  roots.push(root);
  write(root, "typedmark.md", {
    specification_version: "0.1.0", name: "definition-scope", description: "Published note model.",
    version: "1.0.0", extensions: systems,
    scaffold: { notes: [{ path: "Notes/Starter.md", note_type: "note" }] }, ...config,
  }, "\r\n# Published system\r\n");
  write(root, ".typedmark/schemas/note.md", {
    specification_version: "0.1.0", description: "A note.",
    storage: { folder_pattern: "Notes", note_name_pattern: "{title}" },
    frontmatter: { priority: { type: "integer", default_value: 1 } }, ...schema,
  });
  write(root, ".typedmark/templates/note.md", { note_type: "note", title: "Starter", priority: 1 },
    "# Starter\n\n## Context\n\nPublished starter content.\n");
  return root;
}

function preserve(root: string) { sourceSnapshots.set(root, captureFiles(root)); }

function targetDirectory() {
  const parent = mkdtempSync(join(tmpdir(), "typedmark-definition-target-"));
  roots.push(parent);
  return join(parent, "instance");
}

const validate = (root: string, mode: ValidationMode) => validateCollection({ collectionRoot: root, schemaDirectory, mode });
function expectDefinition(root: string, extensions: Record<string, string> = systems) {
  expect(validate(root, "system_definition")).toMatchObject({
    mode: "system_definition", evaluation: "complete", valid: true,
    required_extensions: extensions, evaluated_extensions: extensions, results: [],
  });
}
function expectInstanceFindings(root: string, findings: Partial<ValidationResult>[]) {
  for (const mode of ["instantiated_collection", "both"] as const) {
    const report = validate(root, mode);
    expect(report).toMatchObject({ mode, valid: false });
    expect(report.results).toEqual(expect.arrayContaining(findings.map((finding) => expect.objectContaining(finding))));
  }
}

// CR-14 selects the target: CR-11–CR-13/CR-22 concern current notes, while
// CR-1–CR-6 concern publishing artifacts. Scaffold entries are not live notes.
test("only instance modes check existing note fields, mapping candidates, headings, and counts", () => {
  const root = system({}, { count: { max: 1 }, headings: { required_h2: ["Context"] } });
  write(root, "Notes/Bad.md", { note_type: "note", title: "Bad", priority: "wrong" }, "# Bad\n");
  write(root, "Notes/Extra.md", { note_type: "note", title: "Extra", priority: 2 }, "## Context\n");
  write(root, "Notes/Unknown.md", { note_type: "missing", title: "Unknown" });
  preserve(root);

  expectInstanceFindings(root, [
    { code: "invalid_field_value", path: "Notes/Bad.md", field: "priority" },
    { code: "invalid_note_type_mapping", path: "Notes/Unknown.md", rule_id: "CM-114" },
    { code: "invalid_heading", path: "Notes/Bad.md", rule_id: "RHT-58" },
    { code: "invalid_note_count", rule_id: "NTS-71" },
  ]);
  expectDefinition(root);
});

test.each([
  { kind: "UTF-8", bytes: Buffer.from([0xef, 0xbb, 0xbf, 0xff]), rule: "FND-28" },
  { kind: "YAML", bytes: Buffer.from("---\r\nnote_type: note\r\npriority: [\r\n---\r\nExisting body\r\n"), rule: "MN-118" },
])("definition validation does not parse malformed $kind in existing notes", ({ bytes, rule }) => {
  const root = system();
  writeBytes(root, "Notes/Cafe\u0301.md", bytes);
  preserve(root);

  expectInstanceFindings(root, [{ code: "invalid_note_frontmatter", rule_id: rule }]);
  expectDefinition(root);
});

const pendingExpansion = '<!-- typedmark:expansion {"id":"name","mode":"manual","state":"pending","source":{"kind":"file","value":"stem"},"render":{"item":"${value}"}} -->\n<!-- /typedmark:expansion -->\n';

test.each([{ declared: false }, { declared: true }])("note-only expansion usage stays outside definitions (declared: $declared)", ({ declared }) => {
  const extensions = declared ? { ...systems, "typedmark:expansion": "0.1.0", "typedmark:expressions": "0.1.0" } : systems;
  const root = system({ extensions });
  write(root, "Notes/Existing.md", { note_type: "note", title: "Existing" }, pendingExpansion);
  writeBytes(root, "Untyped.md", pendingExpansion);
  preserve(root);

  expectInstanceFindings(root, ["Notes/Existing.md", "Untyped.md"].map((path) => declared
    ? { code: "invalid_expansion", path, rule_id: "RHT-162" }
    : { code: "invalid_extension_declaration", path, extension: "typedmark:expansion" }));
  expectDefinition(root, extensions);
});

test.each([{ declared: false }, { declared: true }])("note-only tracking receipts stay outside definitions (declared: $declared)", ({ declared }) => {
  const extensions = declared ? { ...systems, "typedmark:template-tracking": "0.1.0" } : systems;
  const root = system({ extensions });
  write(root, "Notes/Existing.md", { note_type: "note", title: "Existing", template_regions: { guidance: { baseline: "invalid" } } });
  preserve(root);

  expectInstanceFindings(root, [declared
    ? { code: "invalid_template_region", path: "Notes/Existing.md", rule_id: "RHT-213" }
    : { code: "invalid_extension_declaration", path: "Notes/Existing.md", extension: "typedmark:template-tracking" }]);
  expectDefinition(root, extensions);
});

test("the public definition model exposes schemas without existing managed or untyped documents", () => {
  const root = system();
  write(root, "Notes/Existing.md", { note_type: "note", title: "Existing", priority: 2 });
  writeBytes(root, "Untyped.md", "Ordinary prose.\r\n");
  preserve(root);

  const instance = readCollectionModel({ collectionRoot: root, schemaDirectory, mode: "instantiated_collection" });
  expect(instance.documents.map((note) => note.path).sort()).toEqual(["Notes/Existing.md", "Untyped.md"]);
  expect(instance.notes.map((note) => note.path)).toEqual(["Notes/Existing.md"]);
  const definition = readCollectionModel({ collectionRoot: root, schemaDirectory, mode: "system_definition" });
  expect(definition.report).toMatchObject({ evaluation: "complete", valid: true, results: [] });
  expect([...definition.schemas.keys()]).toEqual(["note"]);
  expect(definition.documents).toEqual([]);
  expect(definition.notes).toEqual([]);
});

test.each([
  { kind: "schema", schema: { count: { min: 2, max: 1 } }, code: "invalid_note_type_schema", rule: "NTS-69", path: ".typedmark/schemas/note.md" },
  { kind: "template", code: "invalid_template", rule: "RHT-80", path: ".typedmark/templates/note.md", data: { priority: "wrong" } },
  { kind: "scaffold reference", config: { scaffold: { notes: [{ path: "Notes/Starter.md", note_type: "missing" }] } }, code: "invalid_system", rule: "SCE-17", path: "typedmark.md" },
  { kind: "mapping declaration", config: { note_type_mappings: [{ kind: "fixed", note_type: "missing", when: { path: { regex: ".*" } } }] }, code: "invalid_note_type_mapping", rule: "CM-83", path: "typedmark.md" },
  { kind: "history", code: "invalid_history", rule: "SCE-100", path: ".typedmark/history.md", data: { specification_version: "0.1.0", history: [{ version: "0.9.0", changes: [] }] } },
])("definition validation still rejects an invalid $kind with no live notes", ({ schema, config, code, rule, path, data }) => {
  const root = system(config, schema);
  if (data) write(root, path, data);
  preserve(root);

  const report = validate(root, "system_definition");
  expect(report).toMatchObject({ evaluation: "complete", valid: false });
  expect(report.results).toContainEqual(expect.objectContaining({ code, path, rule_id: rule, severity: "error" }));
});

test("definition validation keeps optional artifacts and governed template bodies in scope", () => {
  const root = system({ extensions: {
    ...systems, "typedmark:reuse": "0.1.0", "typedmark:automation": "0.1.0",
    "typedmark:expansion": "0.1.0", "typedmark:expressions": "0.1.0", "typedmark:template-tracking": "0.1.0",
  } });
  write(root, ".typedmark/property-sets/broken.md", {
    specification_version: "0.1.0", property_set: "broken", description: "Invalid unused property set.",
    frontmatter: { value: { type: "integer", default_value: "wrong" } },
  });
  write(root, ".typedmark/automations/broken.md", {
    specification_version: "0.1.0", automation: "broken", description: "Invalid unused automation.",
    trigger: { kind: "event", event: "note.created" }, scope: { note_types: ["missing"] }, actions: [{ kind: "archive_note" }],
  });
  write(root, ".typedmark/templates/note.md", {},
    pendingExpansion.replace('"state":"pending"', '"state":"materialized"')
    + '<!-- typedmark:template-region {"id":"guidance","extra":true} -->\nGuidance\n<!-- /typedmark:template-region -->\n');
  preserve(root);

  const report = validate(root, "system_definition");
  expect(report).toMatchObject({ evaluation: "complete", valid: false });
  expect(report.results).toEqual(expect.arrayContaining([
    expect.objectContaining({ code: "invalid_property_set", path: ".typedmark/property-sets/broken.md" }),
    expect.objectContaining({ code: "invalid_automation", path: ".typedmark/automations/broken.md", rule_id: "CM-253" }),
    expect.objectContaining({ code: "invalid_expansion", path: ".typedmark/templates/note.md", rule_id: "RHT-150" }),
    expect.objectContaining({ code: "invalid_template_region", path: ".typedmark/templates/note.md", rule_id: "RHT-184" }),
  ]));
});

const query = { specification_version: "0.1.0", note_types: ["note"], select: [
  { kind: "path", as: "path" }, { kind: "field", field: "priority", as: "priority" },
] };
const dataset = { specification_version: "0.1.0", dataset: "notes", description: "Published query.", row_identity: "priority", query };
const view = { specification_version: "0.1.0", view: "notes", description: "Published presentation.", dataset: "notes",
  presentation: { layout: "table", fields: [{ column: "path" }, { column: "priority" }] } };

test("valid dataset and view definitions do not fail on duplicate identities in existing rows", () => {
  const root = system({ extensions: queries });
  write(root, ".typedmark/datasets/notes.md", dataset);
  write(root, ".typedmark/views/notes.md", view);
  for (const title of ["A", "B"]) write(root, `Notes/${title}.md`, { note_type: "note", title, priority: 1 });
  preserve(root);

  expectInstanceFindings(root, [{ code: "invalid_dataset", path: ".typedmark/datasets/notes.md", rule_id: "CM-510" }]);
  expectDefinition(root, queries);
});

test("definition validation checks static dataset queries and view columns against the published schema", () => {
  const root = system({ extensions: queries });
  write(root, ".typedmark/datasets/notes.md", { ...dataset, query: { ...query, order_by: [{ column: "missing" }] } });
  write(root, ".typedmark/views/notes.md", { ...view, dataset: undefined, query,
    presentation: { layout: "table", fields: [{ column: "missing" }] },
  });
  preserve(root);

  const report = validate(root, "system_definition");
  expect(report).toMatchObject({ evaluation: "complete", valid: false });
  expect(report.results).toEqual(expect.arrayContaining([
    expect.objectContaining({ code: "invalid_dataset", path: ".typedmark/datasets/notes.md", rule_id: "CM-369" }),
    expect.objectContaining({ code: "invalid_view", path: ".typedmark/views/notes.md", rule_id: "CM-425" }),
  ]));
});

test("static query and view analysis never read note inventories or manufacture row results", () => {
  const root = system({ extensions: queries });
  write(root, ".typedmark/datasets/notes.md", dataset);
  write(root, ".typedmark/views/notes.md", view);
  preserve(root);
  const model = readCollectionModel({ collectionRoot: root, schemaDirectory, mode: "system_definition" });
  for (const key of ["notes", "documents", "assets"]) Object.defineProperty(model, key, { get() { throw new Error(`Static analysis read ${key}`); } });
  const registry = new SchemaRegistry(schemaDirectory);
  const contract = analyzeQuery(model, parseQuery(query, registry));
  expect(contract.evaluation).toBe("complete");
  expect([...contract.columns.keys()]).toEqual(["path", "priority"]);
  const views = validateViews(root, ".typedmark", model, registry);
  expect(views.results).toEqual([]);
  for (const source of views.sources.values()) {
    expect(source.contract?.evaluation).toBe("complete");
    expect(source.evaluation).toBeUndefined();
  }
});

test("invalid mappings do not hide static optional-artifact failures in a definition", () => {
  const root = system({ extensions: queries, validation_defaults: { invalid_note_type_mapping: "off" },
    note_type_mappings: [{ kind: "fixed", note_type: "missing", when: { path: { regex: "[" } } }] });
  write(root, ".typedmark/datasets/notes.md", { ...dataset, query: { ...query, order_by: [{ column: "missing" }] } });
  preserve(root);
  const report = validate(root, "system_definition");
  expect(report).toMatchObject({ evaluation: "complete", valid: false, evaluated_extensions: queries });
  expect(report.results).toContainEqual(expect.objectContaining({ code: "invalid_dataset", rule_id: "CM-369" }));
});

test.each(["error", "warn", "off"])("unread note semantics stay incomplete after mapping failures at severity %s", (severity) => {
  const extensions = { ...queries, "typedmark:reuse": "0.1.0", "typedmark:expressions": "0.1.0",
    "typedmark:expansion": "0.1.0", "typedmark:template-tracking": "0.1.0", "typedmark:automation": "0.1.0", "typedmark:authoring": "0.1.0" };
  const root = system({ extensions, validation_defaults: { invalid_note_type_mapping: severity },
    note_type_mappings: [{ kind: "fixed", note_type: "missing", when: { path: { regex: "[" } } }] });
  write(root, ".typedmark/datasets/notes.md", dataset);
  write(root, ".typedmark/views/notes.md", view);
  write(root, "Notes/Existing.md", { note_type: "note", title: "Existing" }, pendingExpansion);
  preserve(root);
  for (const mode of ["instantiated_collection", "both"] as const) {
    const report = validate(root, mode);
    expect(report).toMatchObject({ evaluation: "incomplete", valid: false, required_extensions: extensions });
    expect(report.evaluated_extensions).toEqual({ ...systems, "typedmark:authoring": "0.1.0", "typedmark:automation": "0.1.0" });
    expect(report.results.every((finding) => finding.code === "invalid_note_type_mapping")).toBe(true);
  }
});

test("a known-empty note inventory does not invent missing evaluation after invalid mappings", () => {
  const root = system({ extensions: queries,
    note_type_mappings: [{ kind: "fixed", note_type: "note", when: { path: { regex: "[" } } }] }, { count: { min: 1 } });
  write(root, ".typedmark/datasets/notes.md", dataset);
  write(root, ".typedmark/views/notes.md", view);
  preserve(root);
  const report = validate(root, "both");
  expect(report).toMatchObject({ evaluation: "complete", valid: false, evaluated_extensions: queries });
  expect(report.results).toContainEqual(expect.objectContaining({ code: "invalid_note_type_mapping", rule_id: "FND-31" }));
  expect(report.results).toContainEqual(expect.objectContaining({ code: "invalid_note_count", rule_id: "NTS-71" }));
  expect(report.results.filter((finding) => ["invalid_dataset", "invalid_view"].includes(finding.code))).toEqual([]);
});

test("instantiation ignores existing source notes and materializes the published starter", async () => {
  const root = system();
  write(root, "Notes/Starter.md", { note_type: "note", title: "Starter", priority: "wrong", template_regions: {} }, pendingExpansion);
  writeBytes(root, "Notes/Broken.md", Buffer.from([0xff]));
  writeBytes(root, "Notes/Malformed.md", "---\nnote_type: [\n---\n");
  writeBytes(root, "LICENSE.md", "License and attribution.\r\n");
  preserve(root);
  const target = targetDirectory();

  const result = await instantiateSystem({ sourceRoot: root, targetRoot: target, collectionName: "working-notes", schemaDirectory });
  expect(result.report).toMatchObject({ mode: "instantiated_collection", evaluation: "complete", valid: true, results: [] });
  expect(result.createdPaths).toContain("Notes/Starter.md");
  expect(existsSync(join(target, "Notes/Broken.md"))).toBe(false);
  expect(existsSync(join(target, "Notes/Malformed.md"))).toBe(false);
  const created = parseMarkdown(readFileSync(join(target, "Notes/Starter.md")));
  expect(created.data).toMatchObject({ note_type: "note", title: "Starter", priority: 1 });
  expect(created.data).not.toHaveProperty("template_regions");
  expect(created.body).toContain("Published starter content.");
  for (const path of [".typedmark/schemas/note.md", ".typedmark/templates/note.md", "LICENSE.md"]) {
    expect(readFileSync(join(target, path)).equals(sourceSnapshots.get(root)![path]!)).toBe(true);
  }
  expect(result.validateOffline()).toMatchObject({ evaluation: "complete", valid: true, results: [] });
});

test("ignoring source notes does not bypass strict validation of the materialized target", async () => {
  const root = system({ validation_defaults: { invalid_note_count: "off" } }, { count: { min: 2 } });
  writeBytes(root, "Notes/Broken.md", Buffer.from([0xff]));
  preserve(root);
  const target = targetDirectory();

  await expect(instantiateSystem({ sourceRoot: root, targetRoot: target, collectionName: "working-notes", schemaDirectory }))
    .rejects.toThrow(/Instantiated collection is not conforming:.*NTS-71/);
  expect(existsSync(target)).toBe(false);
  expect(readdirSync(dirname(target))).toEqual([]);
});

test("readiness's validated version no-op is artifact-scoped and still rejects suppressed artifact failures", () => {
  const root = system();
  writeBytes(root, "Notes/Broken.md", Buffer.from([0xff]));
  write(root, "Notes/Existing.md", { note_type: "missing" });
  preserve(root);
  const invalid = system({ validation_defaults: { invalid_history: "off" } });
  write(invalid, ".typedmark/history.md", { specification_version: "0.1.0", history: [{ version: "0.9.0", changes: [] }] });
  preserve(invalid);

  expect(validate(invalid, "system_definition")).toMatchObject({ valid: true, results: [] });
  expect(checkMigrationReadiness({ systemRoot: invalid, fromVersion: "1.0.0", schemaDirectory }).status).toBe("manual_resolution_required");
  expect(checkMigrationReadiness({ systemRoot: root, fromVersion: "1.0.0", schemaDirectory })).toEqual({ status: "ready", reasons: [] });
});

test.each([false, true])("a definition can omit schemas and have an empty metadata directory (present: %s)", (metadataPresent) => {
  const root = mkdtempSync(join(tmpdir(), "typedmark-empty-definition-"));
  roots.push(root);
  write(root, "typedmark.md", { specification_version: "0.1.0", name: "empty-definition", description: "A publishing definition.",
    version: "1.0.0", scaffold: {}, extensions: systems });
  if (metadataPresent) mkdirSync(join(root, ".typedmark"));
  writeBytes(root, "Ignored.md", Buffer.from([0xff]));
  preserve(root);
  expectDefinition(root);
});

test.each(["schemas/linked.md", "history.md", "property-sets", "datasets", "views", "automations"])(
  "unread metadata link %s cannot masquerade as an absent artifact", (path) => {
    const root = system(), outside = system();
    const location = join(root, ".typedmark", path);
    mkdirSync(dirname(location), { recursive: true });
    symlinkSync(outside, location, "junction");
    preserve(root); preserve(outside);
    for (const mode of ["system_definition", "both"] as const) {
      expect(() => validate(root, mode)).toThrow("symbolic link");
    }
  },
);

test.each(["unknown", null, {}, 12])("invalid target mode %j cannot produce a portable conformance claim", (mode) => {
  const root = system();
  preserve(root);
  const input = { collectionRoot: root, schemaDirectory, mode: mode as never };
  expect(() => validateCollection(input)).toThrow(RangeError);
  expect(() => readCollectionModel(input)).toThrow(RangeError);
});
