import { afterEach, expect, test } from "bun:test";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { isMap, parseDocument } from "yaml";
import { parseMarkdown } from "../src/frontmatter";
import { instantiateSystem } from "../src/system";
import { validateCollection } from "../src/validator";

const roots: string[] = [];
const schemaDirectory = resolve(import.meta.dir, "../../TypedMarkSpecification/schema/json-schema");
const sourceIdentity = { name: "@example/metadata", version: "0.1.0" };
const sourceDescription = "A system carrying opaque editor metadata.";
const sourceBody = "System documentation with trailing spaces.  \r\n---\r\nPreserved prose.\n";

afterEach(() => {
  for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true });
});

// SCE-159/SCE-160: a system's typedmark.md is plain data, so importers never
// have to preserve or re-encode YAML-native graphs. Each case was preserved
// before decision 022's fail-closed direction (TypedMark#5, #6); it is now rejected.
test.each([
  { label: "native set", metadata: "x_editor:\n  payload: !!set {blue: null, green: null}" },
  { label: "ordered map", metadata: "x_editor:\n  payload: !!omap [{zeta: 7}, {alpha: 2}]" },
  { label: "timestamp tag", metadata: "x_editor:\n  payload: !!timestamp 2026-09-15T10:20:30Z" },
  { label: "binary", metadata: "x_editor:\n  payload: !!binary SGk=" },
  { label: "unknown tags", metadata: "x_editor: {flag: !vendor/flag on, list: !vendor/list [a]}" },
  { label: "shared and cyclic aliases", metadata: "x_editor: &editor\n  shared: &shared {a: 1}\n  again: *shared\n  self: *editor" },
  { label: "complex keys", metadata: "x_editor:\n  ? [north, east]\n  : corner" },
  { label: "non-string scalar keys", metadata: "x_editor: {1: one, true: yes}" },
  { label: "root anchor", metadata: "x_editor: {color: blue}", rootAnchor: true },
  { label: "explicit merge", metadata: "x_defaults: &defaults {color: blue}\nx_editor: {!!merge <<: *defaults}" },
])("a system whose typedmark.md uses $label is rejected before import", async ({ metadata, rootAnchor }) => {
  const sourceRoot = writeSource(metadata, rootAnchor);
  expect(validateCollection({ collectionRoot: sourceRoot, schemaDirectory, mode: "system_definition" }).results).toContainEqual(
    expect.objectContaining({ code: "invalid_system", rule_id: "SCE-159" }),
  );
  const targetRoot = join(createRoot(), "instance");
  await expect(
    instantiateSystem({ sourceRoot, targetRoot, collectionName: "working-notes", description: "My working notes.", schemaDirectory }),
  ).rejects.toThrow(/SCE-159/);
  expect(existsSync(targetRoot)).toBe(false);
});

test("plain vendor metadata is preserved exactly, including values beyond native precision", async () => {
  const { config, output } = await importMetadata(
    "x_editor:\n  integer: 9007199254740993\n  number: 1e1000\n  nested: {colors: [blue, green], when: 2026-09-15T10:20:30.123456Z}",
  );
  const metadata = metadataNode(output);
  expect(metadata.get("integer", true)).toMatchObject({ source: "9007199254740993" });
  expect(metadata.get("number", true)).toMatchObject({ source: "1e1000" });
  expect(config.x_editor).toMatchObject({ nested: { colors: ["blue", "green"], when: "2026-09-15T10:20:30.123456Z" } });
});

function writeSource(metadata: string, rootAnchor = false) {
  const sourceRoot = createRoot();
  for (const [path, source] of Object.entries(sourceFiles(metadata, rootAnchor))) {
    mkdirSync(dirname(join(sourceRoot, path)), { recursive: true });
    writeFileSync(join(sourceRoot, path), source);
  }
  return sourceRoot;
}

function sourceFiles(metadata: string, rootAnchor = false): Record<string, string> {
  return {
    "typedmark.md":
      "\uFEFF" +
      markdown(
        (rootAnchor ? "&source_root\n" : "") +
          [
            "specification_version: 0.1.0",
            "extensions: {typedmark:systems: 0.1.0}",
            'name: "@example/metadata"',
            `description: ${sourceDescription}`,
            "version: 0.1.0",
            "publisher: {name: Example Publisher}",
            "license: MIT",
            "composition:",
            '  sources: [{name: "@example/base", version: 0.1.0}]',
            "scaffold: {folders: [Notes]}",
          ].join("\n") +
          `\n${metadata}`,
        sourceBody,
      ),
    ".typedmark/schemas/note.md": markdown(
      [
        "specification_version: 0.1.0",
        "note_type: note",
        "description: A note.",
        "storage: {folder_pattern: Notes, note_name_pattern: '{title}'}",
        "x_editor: {color: blue}",
      ].join("\n"),
      "Schema documentation.  \r\n",
    ),
    ".typedmark/templates/note.md": markdown("note_type: note\ntitle: null", "# Starter\r\n"),
    LICENSE: "Example attribution.\r\n",
  };
}

async function importMetadata(metadata: string) {
  const sourceRoot = writeSource(metadata);
  const targetRoot = join(createRoot(), "instance");
  const sources = sourceFiles(metadata);
  try {
    const result = await instantiateSystem({
      sourceRoot,
      targetRoot,
      collectionName: "working-notes",
      description: "My working notes.",
      schemaDirectory,
    });
    expect(result.report).toMatchObject({ evaluation: "complete", valid: true, results: [] });
    expect(result.source).toEqual(sourceIdentity);
    const output = readFileSync(join(targetRoot, "typedmark.md"), "utf8");
    const document = parseMarkdown(output, { preserveBodyLineEndings: true });
    expect(document.body).toBe(sourceBody);
    expect(document.data).toMatchObject({
      name: "working-notes",
      description: "My working notes.",
      composition: { sources: [sourceIdentity] },
      publisher: { name: "Example Publisher" },
      license: "MIT",
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

function createRoot(): string {
  const root = mkdtempSync(join(tmpdir(), "typedmark-system-metadata-"));
  roots.push(root);
  return root;
}

function markdown(yaml: string, body = ""): string {
  return `---\r\n${yaml.replaceAll("\n", "\r\n")}\r\n---\r\n${body}`;
}
