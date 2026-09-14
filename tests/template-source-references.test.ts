import { afterEach, expect, test } from "bun:test";
import { mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { stringify } from "yaml";
import type { ValidateCollectionInput } from "../src/types";
import { validateCollection } from "../src/validator";

type Data = Record<string, unknown>;
const roots: string[] = [];
const schemaDirectory = resolve(import.meta.dir, "../../TypedMarkSpecification/schema/json-schema");
const templatePath = ".typedmark/templates/note.md";
const version = { specification_version: "0.1.0", description: "Template source references." };
const extensions = {
  "typedmark:systems": "0.1.0", "typedmark:expansion": "0.1.0", "typedmark:expressions": "0.1.0",
  "typedmark:queries": "0.1.0", "typedmark:views": "0.1.0",
};
const query = {
  specification_version: "0.1.0", note_types: ["note"],
  select: [{ kind: "path", as: "path" }, { kind: "field", field: "summary", as: "summary" }],
  order_by: [{ column: "path" }],
};

afterEach(() => {
  for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true });
});

function write(root: string, path: string, data: Data, body = "") {
  mkdirSync(dirname(join(root, path)), { recursive: true });
  writeFileSync(join(root, path), `---\r\n${stringify(data).replaceAll("\n", "\r\n")}---\r\n${body}`);
}

function pending(source: Data, id = "source") {
  const descriptor = { id, mode: "manual", state: "pending", source, render: { item: "${value}" } };
  return `<!-- typedmark:expansion ${JSON.stringify(descriptor)} -->\r\n<!-- /typedmark:expansion -->\r\n`;
}

function system(source: Data, requiredExtensions: Record<string, string> = extensions) {
  const root = mkdtempSync(join(tmpdir(), "typedmark-template-source-"));
  roots.push(root);
  write(root, "typedmark.md", {
    ...version, name: "template-source-references", version: "1.0.0", extensions: requiredExtensions,
    scaffold: { notes: [{ path: "Starter.md", note_type: "note" }] },
  }, "\r\n# Published system\r\n");
  write(root, ".typedmark/schemas/note.md", {
    ...version, template: { file: "note.md" }, storage: { folder_pattern: "", note_name_pattern: "{title}" },
    frontmatter: {
      summary: { type: "text", nullable: true },
      details: { type: "object", nullable: true, fields: { label: { type: "text" } } },
      score: { type: "number", nullable: true },
    },
  });
  write(root, templatePath, {}, pending(source));
  return root;
}

function dataset(root: string) {
  write(root, ".typedmark/datasets/notes.md", { ...version, dataset: "notes", row_identity: "path", query });
}

function view(root: string, embedded = false) {
  if (!embedded) dataset(root);
  write(root, ".typedmark/views/notes.md", {
    ...version, view: "notes", ...(embedded ? { query } : { dataset: "notes" }),
    presentation: { layout: "table", fields: [{ column: "summary" }] },
  });
}

function captureFiles(root: string): Record<string, Buffer> {
  const files: Record<string, Buffer> = {};
  function visit(directory: string, prefix = "") {
    for (const entry of readdirSync(directory, { withFileTypes: true })) {
      const path = prefix + entry.name;
      if (entry.isDirectory()) visit(join(directory, entry.name), `${path}/`);
      else files[path] = readFileSync(join(directory, entry.name));
    }
  }
  visit(root);
  return files;
}

function validate(root: string, options: Partial<ValidateCollectionInput> = {}) {
  const before = captureFiles(root);
  try {
    return validateCollection({ collectionRoot: root, schemaDirectory, mode: "system_definition", ...options });
  } finally {
    // CR-40: failed and incomplete validation also preserves every source byte and path.
    expect(captureFiles(root)).toEqual(before);
  }
}

test.each([
  { label: "dataset", source: { kind: "dataset", dataset: "notes", column: "summary" }, prepare: dataset },
  { label: "dataset-backed view", source: { kind: "view", view: "notes", column: "summary" }, prepare: (root: string) => view(root) },
  { label: "embedded-query view", source: { kind: "view", view: "notes", column: "summary" }, prepare: (root: string) => view(root, true) },
])("a pending template accepts a resolved $label source without note rows", ({ source, prepare }) => {
  const root = system(source);
  prepare(root);
  expect(validate(root)).toMatchObject({
    evaluation: "complete", valid: true, required_extensions: extensions, evaluated_extensions: extensions, results: [],
  });
});

// CR-91/CR-94 and RHT-259/RHT-274 require artifact resolution before reading source values.
test.each([
  { kind: "dataset", rule: "RHT-274" },
  { kind: "view", rule: "RHT-259" },
])("a pending template rejects a missing $kind source", ({ kind, rule }) => {
  const root = system({ kind, [kind]: "missing", column: "summary" });
  const report = validate(root);
  expect(report).toMatchObject({ evaluation: "complete", valid: false });
  expect(report.results).toContainEqual(expect.objectContaining({
    code: "invalid_expansion", rule_id: rule, path: templatePath, expansion: "source",
  }));
});

test.each([
  { kind: "dataset", rule: "RHT-277", prepare: dataset },
  { kind: "view", rule: "RHT-262", prepare: (root: string) => view(root) },
])("a pending template rejects an unknown $kind projected column", ({ kind, rule, prepare }) => {
  const root = system({ kind, [kind]: "notes", column: "missing" });
  prepare(root);
  const report = validate(root);
  expect(report).toMatchObject({ evaluation: "complete", valid: false });
  expect(report.results).toContainEqual(expect.objectContaining({
    code: "invalid_expansion", rule_id: rule, path: templatePath, expansion: "source",
  }));
});

test("a pending template rejects a projected view column absent from presentation.fields", () => {
  const root = system({ kind: "view", view: "notes", column: "path" });
  view(root);
  const report = validate(root);
  expect(report).toMatchObject({ evaluation: "complete", valid: false });
  expect(report.results).toContainEqual(expect.objectContaining({
    code: "invalid_expansion", rule_id: "RHT-263", path: templatePath, expansion: "source",
  }));
});

// EXT-19/EXT-21: retaining source declarations is not complete interpretation of them.
test.each(["typedmark:queries", "typedmark:views"])(
  "a pending template using unsupported %s stays incomplete without invented reference failures",
  (extension) => {
    const required: Record<string, string> = { ...extensions, [extension]: "0.2.0" };
    const source = extension === "typedmark:queries"
      ? { kind: "query", query, column: "summary" }
      : { kind: "dataset", dataset: "notes", column: "summary" };
    // No supported Views declaration can depend on the unsupported Queries version.
    if (extension === "typedmark:queries") delete required["typedmark:views"];
    const root = system(source, required);
    if (extension === "typedmark:views") dataset(root);
    const report = validate(root);
    expect(report).toMatchObject({ evaluation: "incomplete", valid: false, required_extensions: required });
    expect(report.results).toContainEqual(expect.objectContaining({ code: "unsupported_extension", extension }));
    expect(report.results.filter((finding) => finding.code === "invalid_expansion")).toEqual([]);
    expect(report.evaluated_extensions).not.toHaveProperty("typedmark:expansion");
  },
);

test.each(["typedmark:queries", "typedmark:views"])(
  "a pending template using disabled %s stays incomplete without invented reference failures",
  (extension) => {
    const source = extension === "typedmark:queries"
      ? { kind: "query", query, column: "summary" }
      : { kind: "view", view: "notes", column: "summary" };
    const root = system(source);
    if (extension === "typedmark:views") view(root);
    const supported: Record<string, string> = { ...extensions };
    delete supported[extension];
    const report = validate(root, { supportedExtensions: supported });
    expect(report).toMatchObject({ evaluation: "incomplete", valid: false });
    expect(report.results.filter((finding) => finding.code === "invalid_expansion")).toEqual([]);
    expect(report.evaluated_extensions).not.toHaveProperty("typedmark:expansion");
  },
);

test("a pending view source preserves an unsupported transitive dataset as unavailable", () => {
  const root = system({ kind: "view", view: "notes", column: "summary" });
  view(root);
  write(root, ".typedmark/datasets/notes.md", {
    ...version, specification_version: "0.2.0", dataset: "notes", row_identity: "path",
    query: { ...query, specification_version: "0.2.0" },
  });
  const report = validate(root);
  expect(report).toMatchObject({ evaluation: "incomplete", valid: false });
  expect(report.results).toContainEqual(expect.objectContaining({
    code: "unsupported_specification_version", rule_id: "FND-92", path: ".typedmark/datasets/notes.md",
  }));
  expect(report.results.filter((finding) => ["invalid_view", "invalid_expansion"].includes(finding.code))).toEqual([]);
  expect(report.evaluated_extensions).not.toHaveProperty("typedmark:expansion");
});

test("pending note and query sources do not evaluate existing note values before instantiation", () => {
  const root = system({ kind: "note_field", note: "[[Existing]]", field: "details" });
  const conditionalQuery = {
    specification_version: "0.1.0", note_types: ["note"],
    select: [{
      kind: "mapped_field", as: "score", definition: { type: "integer", nullable: true },
      sources: [{ note_types: ["note"], field: "score", conversion: "conditional" }],
    }],
  };
  write(root, "Existing.md", { note_type: "note", details: { label: "Source data" }, score: 3.5 });
  write(root, templatePath, {},
    pending({ kind: "note_field", note: "[[Existing]]", field: "details" }, "note-source")
    + pending({ kind: "query", query: conditionalQuery, column: "score" }, "query-source"));
  // RHT-168 defers source evaluation. Reading these valid note values would fail
  // RHT-120 (object expansion) or CM-488 (3.5 cannot conditionally convert to integer).
  expect(validate(root, { mode: "instantiated_collection" })).toMatchObject({
    evaluation: "complete", valid: true, evaluated_extensions: extensions, results: [],
  });
});

test("a pending query source still requires its selected column to resolve", () => {
  const root = system({ kind: "query", query, column: "missing" });
  const report = validate(root);
  expect(report).toMatchObject({ evaluation: "complete", valid: false });
  expect(report.results).toContainEqual(expect.objectContaining({
    code: "invalid_expansion", rule_id: "RHT-249", path: templatePath, expansion: "source",
  }));
});

test("a pending query source rejects an order_by alias absent from its projections", () => {
  const root = system({
    kind: "query", query: { ...query, order_by: [{ column: "missing" }] }, column: "summary",
  });
  const report = validate(root);
  // CM-369 is a descriptor reference check; RHT-168 only defers source evaluation.
  expect(report).toMatchObject({ evaluation: "complete", valid: false });
  expect(report.results).toContainEqual(expect.objectContaining({
    code: "invalid_expansion", rule_id: "CM-369", path: templatePath, expansion: "source",
  }));
});

test.each(["dataset", "view"])("pending %s references use static contracts even when live row evaluation fails", (kind) => {
  const root = system({ kind, [kind]: "notes", column: "summary" });
  view(root);
  write(root, ".typedmark/datasets/notes.md", { ...version, dataset: "notes", row_identity: "summary", query });
  for (const title of ["A", "B"]) write(root, `${title}.md`, { note_type: "note", title, summary: "duplicate" });
  const report = validate(root, { mode: "both" });
  expect(report.valid).toBe(false);
  expect(report.results).toContainEqual(expect.objectContaining({ code: "invalid_dataset", rule_id: "CM-510" }));
  expect(report.results.filter((finding) => finding.path === templatePath)).toEqual([]);
});

test("a pending view rejects duplicate presentation entries instead of treating a set as exactly once", () => {
  const root = system({ kind: "view", view: "notes", column: "summary" });
  write(root, ".typedmark/views/notes.md", { ...version, view: "notes", query,
    presentation: { layout: "table", fields: [{ column: "summary" }, { column: "summary" }] } });
  const report = validate(root);
  expect(report.valid).toBe(false);
  expect(report.results).toContainEqual(expect.objectContaining({ code: "invalid_view", rule_id: "CM-426" }));
  expect(report.results).toContainEqual(expect.objectContaining({ code: "invalid_expansion", path: templatePath }));
});
