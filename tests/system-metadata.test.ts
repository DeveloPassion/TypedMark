import { afterEach, expect, test } from "bun:test";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { isMap, isScalar, isSeq, parseDocument } from "yaml";
import { parseMarkdown } from "../src/frontmatter";
import { instantiateSystem } from "../src/system";
import { validateCollection } from "../src/validator";

const roots: string[] = [];
const schemaDirectory = resolve(import.meta.dir, "../../TypedMarkSpecification/schema/json-schema");
const sourceIdentity = { name: "@example/metadata", version: "0.1.0" };
const sourceDescription = "A system carrying opaque editor metadata.";
const sourceComposition = { sources: [{ name: "@example/base", version: "0.1.0" }] };
const sourceScaffold = { folders: ["Notes"] };
const sourceBody = "System documentation with trailing spaces.  \r\n---\r\nPreserved prose.\n";

afterEach(() => {
  for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true });
});

// EXT-24/EXT-27: root metadata retains YAML values during the SCE-151/SCE-47 rewrite.
test.each([
  { label: "set", yaml: "!!set {blue: null, green: null}", value: new Set(["blue", "green"]) },
  { label: "ordered map", yaml: "!!omap [{zeta: 7}, {alpha: 2}]", value: new Map([["zeta", 7], ["alpha", 2]]) },
  { label: "timestamp", yaml: "!!timestamp 2026-09-15T10:20:30Z", value: new Date("2026-09-15T10:20:30Z") },
  { label: "binary", yaml: "!!binary SGk=", value: Buffer.from("Hi") },
])("system import preserves a native YAML $label in root vendor metadata", async ({ yaml, value }) => {
  const { config } = await importMetadata(`x_editor:\n  payload: ${yaml}`);
  expect(config.x_editor).toEqual({ payload: value });
  if (value instanceof Map) {
    const actual = (config.x_editor as { payload: Map<string, number> }).payload;
    expect([...actual.entries()]).toEqual([["zeta", 7], ["alpha", 2]]);
  }
});

test("system import preserves values shared and cycled by vendor metadata aliases", async () => {
  const { config } = await importMetadata([
    "x_editor: &editor",
    "  panels: &panels [notes, preview]",
    "  options: {enabled: true, limit: null}",
    "x_mirror: *editor",
    "x_layout: {panels: *panels}",
    "x_cycle: &cycle {label: loop, next: *cycle}",
  ].join("\n"));

  const editor = { panels: ["notes", "preview"], options: { enabled: true, limit: null } };
  expect(config.x_editor).toEqual(editor);
  expect(config.x_mirror).toEqual(editor);
  expect(config.x_layout).toEqual({ panels: ["notes", "preview"] });
  const cycle = config.x_cycle as { label: string; next: unknown };
  expect(cycle.label).toBe("loop");
  expect(cycle.next).toBe(cycle);
});

test("system import keeps aliased source fields in metadata when their root fields change", async () => {
  const { config } = await importMetadata([
    "x_editor:",
    "  source_name: *source_name",
    "  source_version: *source_version",
    "  source_description: *source_description",
    "  source_scaffold: *source_scaffold",
    "  source_composition: *source_composition",
  ].join("\n"));

  expect(config.x_editor).toEqual({
    source_name: sourceIdentity.name,
    source_version: sourceIdentity.version,
    source_description: sourceDescription,
    source_scaffold: sourceScaffold,
    source_composition: sourceComposition,
  });
});

test("a root alias in vendor metadata retains the source system and its self-reference", async () => {
  const { config } = await importMetadata("x_snapshot: *source_root");
  const snapshot = config.x_snapshot as Record<string, unknown>;

  expect(snapshot).toMatchObject({
    ...sourceIdentity,
    description: sourceDescription,
    scaffold: sourceScaffold,
    composition: sourceComposition,
  });
  expect(snapshot).not.toBe(config);
  expect(snapshot.x_snapshot).toBe(snapshot);
});

test("an imported root with explicit merge inherits metadata but not publishing identity", async () => {
  const { config } = await importMetadata("x_editor: !!set {one: null}\nx_snapshot: *source_root", true);
  expect(config.x_editor).toEqual(new Set(["one"]));
  const snapshot = config.x_snapshot as Record<string, unknown>;
  expect(snapshot).toMatchObject({ ...sourceIdentity, scaffold: sourceScaffold, composition: sourceComposition });
  expect(snapshot.x_snapshot).toBe(snapshot);
});

test("system import preserves unknown scalar and collection tags in vendor metadata", async () => {
  const { output } = await importMetadata([
    "x_editor: !vendor/ui",
    "  color: !vendor/color blue",
    "  panels: !vendor/layout [notes, preview]",
  ].join("\n"));
  const metadata = metadataNode(output);

  expect(metadata.tag).toBe("!vendor/ui");
  expect(metadata.get("color", true)).toMatchObject({ tag: "!vendor/color", value: "blue" });
  expect(metadata.get("panels", true)).toMatchObject({
    tag: "!vendor/layout", items: [{ value: "notes" }, { value: "preview" }],
  });
});

test("system import preserves exact scalar values beyond native numeric and timestamp precision", async () => {
  const { output } = await importMetadata("x_editor: {integer: 9007199254740993, number: 1e1000, timestamp: !!timestamp 2026-09-15T10:20:30.123456Z}");
  const metadata = metadataNode(output);
  expect(metadata.get("integer", true)).toMatchObject({ source: "9007199254740993" });
  expect(metadata.get("number", true)).toMatchObject({ source: "1e1000" });
  expect(metadata.get("timestamp", true)).toMatchObject({ source: "2026-09-15T10:20:30.123456Z" });
});

test("system import preserves complex keys and distinct scalar key types in vendor mappings", async () => {
  const { output } = await importMetadata([
    "x_editor:",
    "  ? [north, east]",
    "  : corner",
    "  ? {layer: 2}",
    "  : overlay",
    "  ? 7",
    "  : numeric key",
    '  ? "7"',
    "  : string key",
  ].join("\n"));
  const metadata = metadataNode(output);

  expect(metadata.items).toHaveLength(4);
  expect(metadata.items.find(({ key }) => isSeq(key))).toMatchObject({
    key: { items: [{ value: "north" }, { value: "east" }] }, value: { value: "corner" },
  });
  expect(metadata.items.find(({ key }) => isMap(key))).toMatchObject({
    key: { items: [{ key: { value: "layer" }, value: { value: 2 } }] }, value: { value: "overlay" },
  });
  expect(metadata.items.find(({ key }) => isScalar(key) && key.value === 7)).toMatchObject({ value: { value: "numeric key" } });
  expect(metadata.items.find(({ key }) => isScalar(key) && key.value === "7")).toMatchObject({ value: { value: "string key" } });
});

test("an expanded source-root alias that exceeds reader limits cannot publish a target", async () => {
  // Known E1 operability limit: preserving this graph adds aliases. Keep the
  // reader's resource guard and abort, rather than publishing changed metadata.
  const sourceRoot = createRoot(), targetParent = createRoot(), targetRoot = join(targetParent, "instance");
  const source = markdown([
    "&root", "specification_version: 0.1.0", "extensions: {typedmark:systems: 0.1.0}",
    'name: "@example/source"', "description: Source", "version: 0.1.0", "scaffold: {}",
    "x_a: &a {left: first, right: last}", "x_b: &b {left: *a, right: *a}",
    "x_c: &c {left: *b, right: *b}", "x_d: &d {left: *c, right: *c}", "x_root: *root",
  ].join("\n"));
  const schema = markdown("specification_version: 0.1.0\ndescription: Note\nstorage: {folder_pattern: Notes, note_name_pattern: '{title}'}");
  mkdirSync(join(sourceRoot, ".typedmark/schemas"), { recursive: true });
  writeFileSync(join(sourceRoot, "typedmark.md"), source);
  writeFileSync(join(sourceRoot, ".typedmark/schemas/note.md"), schema);
  expect(validateCollection({ collectionRoot: sourceRoot, schemaDirectory, mode: "system_definition" })).toMatchObject({ valid: true, evaluation: "complete", results: [] });
  await expect(instantiateSystem({ sourceRoot, targetRoot, collectionName: "working", schemaDirectory })).rejects.toThrow("Excessive alias count");
  expect(existsSync(targetRoot)).toBe(false);
  expect(readdirSync(targetParent)).toEqual([]);
  expect(readFileSync(join(sourceRoot, "typedmark.md"))).toEqual(Buffer.from(source));
  expect(readFileSync(join(sourceRoot, ".typedmark/schemas/note.md"))).toEqual(Buffer.from(schema));
});

function createRoot(): string {
  const root = mkdtempSync(join(tmpdir(), "typedmark-system-metadata-"));
  roots.push(root);
  return root;
}

function markdown(yaml: string, body = ""): string {
  return `---\r\n${yaml.replaceAll("\n", "\r\n")}\r\n---\r\n${body}`;
}

async function importMetadata(metadata: string, mergedRoot = false) {
  const sourceRoot = createRoot();
  const targetRoot = join(createRoot(), "instance");
  const sources = {
    "typedmark.md": "\uFEFF" + markdown("&source_root\n" + (mergedRoot ? "x_defaults: &defaults\n" : "") + [
      "specification_version: 0.1.0",
      "extensions: {typedmark:systems: 0.1.0}",
      'name: &source_name "@example/metadata"',
      `description: &source_description ${sourceDescription}`,
      "version: &source_version 0.1.0",
      "publisher: {name: Example Publisher}",
      "license: MIT",
      "composition: &source_composition",
      '  sources: [{name: "@example/base", version: 0.1.0}]',
      "scaffold: &source_scaffold {folders: [Notes]}",
    ].map((line) => mergedRoot ? `  ${line}` : line).join("\n") + (mergedRoot ? "\n!!merge <<: *defaults" : "") + `\n${metadata}`, sourceBody),
    ".typedmark/schemas/note.md": markdown([
      "specification_version: 0.1.0",
      "note_type: note",
      "description: A note.",
      "storage: {folder_pattern: Notes, note_name_pattern: '{title}'}",
      "x_editor: {color: blue}",
    ].join("\n"), "Schema documentation.  \r\n"),
    ".typedmark/templates/note.md": markdown("note_type: note\ntitle: null", "# Starter\r\n"),
    "LICENSE": "Example attribution.\r\n",
  };
  for (const [path, source] of Object.entries(sources)) {
    mkdirSync(dirname(join(sourceRoot, path)), { recursive: true });
    writeFileSync(join(sourceRoot, path), source);
  }

  try {
    const result = await instantiateSystem({
      sourceRoot, targetRoot, collectionName: "working-notes", description: "My working notes.", schemaDirectory,
    });
    expect(result.report).toMatchObject({ evaluation: "complete", valid: true, results: [] });
    expect(result.source).toEqual(sourceIdentity);
    const output = readFileSync(join(targetRoot, "typedmark.md"), "utf8");
    const document = parseMarkdown(output, { preserveBodyLineEndings: true });
    expect(document.body).toBe(sourceBody);
    expect(document.data).toMatchObject({
      name: "working-notes", description: "My working notes.",
      composition: { sources: [sourceIdentity] }, publisher: { name: "Example Publisher" }, license: "MIT",
    });
    expect(Object.hasOwn(document.data, "version")).toBe(false);
    expect(Object.hasOwn(document.data, "scaffold")).toBe(false);
    for (const [path, source] of Object.entries(sources)) {
      if (path !== "typedmark.md") expect(readFileSync(join(targetRoot, path))).toEqual(Buffer.from(source));
    }
    return { config: document.data, output };
  } finally {
    for (const [path, source] of Object.entries(sources)) {
      expect(readFileSync(join(sourceRoot, path))).toEqual(Buffer.from(source));
    }
  }
}

// AST checks avoid the lossy JS projection of unknown tags and non-string keys.
function metadataNode(source: string) {
  const lines = source.replace(/^\uFEFF/, "").split(/\r\n?|\n/);
  const end = lines.findIndex((line, index) => index > 0 && (line === "---" || line === "..."));
  const document = parseDocument(lines.slice(1, end).join("\n"), { version: "1.2", schema: "core" });
  expect(document.errors).toEqual([]);
  const metadata = document.get("x_editor", true);
  if (!isMap(metadata)) throw new Error("Expected the vendor metadata to remain a YAML mapping");
  return metadata;
}
