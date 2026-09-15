import { afterEach, expect, test } from "bun:test";
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { tmpdir } from "node:os";
import { FrontmatterError, parseMarkdown } from "../src/frontmatter";
import { instantiateSystem } from "../src/system";
import { validateCollection } from "../src/validator";

// FND-25 fixes Core resolution independently of an authored version directive.
// The YAML document marker has a trailing space: FND-33 only closes frontmatter
// on an exact delimiter, so this marker remains inside the frontmatter block.
function markdown(yaml: string, version = "", body = "Body\n"): string {
  const directive = version ? `%YAML ${version}\n--- \n` : "";
  return `---\n${directive}${yaml}\n---\n${body}`;
}

for (const { label, version } of [
  { label: "no directive", version: "" },
  { label: "%YAML 1.1", version: "1.1" },
  { label: "%YAML 1.2", version: "1.2" },
]) {
  test(`${label}: legacy boolean words remain strings in nested values`, () => {
    const source = markdown("value: {words: [yes, no, on, off, y, n, Yes, NO, On, OFF, Y, N]}", version);
    expect(parseMarkdown(source).data).toEqual({
      value: { words: ["yes", "no", "on", "off", "y", "n", "Yes", "NO", "On", "OFF", "Y", "N"] },
    });
  });

  test(`${label}: integer resolution uses Core decimal, octal and hexadecimal forms`, () => {
    const source = markdown("value: [012, 0o12, 0x10, 0b10, 1_000]", version);
    expect(parseMarkdown(source).data.value).toEqual([12, 10, 16, "0b10", "1_000"]);
  });

  test(`${label}: sexagesimal and timestamp spellings remain plain text`, () => {
    const source = markdown("value: [1:20, 1:20.5, 2026-09-15, 2026-09-15T10:20:30Z]", version);
    expect(parseMarkdown(source).data.value).toEqual(["1:20", "1:20.5", "2026-09-15", "2026-09-15T10:20:30Z"]);
  });

  test(`${label}: Core booleans and nulls retain their standard values`, () => {
    const source = markdown("value: [true, True, TRUE, false, False, FALSE, null, Null, NULL, ~]\nempty:", version);
    expect(parseMarkdown(source).data).toEqual({
      value: [true, true, true, false, false, false, null, null, null, null], empty: null,
    });
  });

  test(`${label}: legacy boolean spellings remain distinct mapping keys`, () => {
    const source = markdown("value: {yes: 1, no: 2, on: 3, off: 4, y: 5, n: 6}", version);
    expect(parseMarkdown(source).data.value).toEqual({ yes: 1, no: 2, on: 3, off: 4, y: 5, n: 6 });
  });

  test(`${label}: an implicit merge-looking key stays an ordinary mapping entry`, () => {
    const source = markdown("defaults: &defaults {status: off}\nvalue: {<<: *defaults, title: Example}", version);
    expect(parseMarkdown(source).data).toEqual({
      defaults: { status: "off" }, value: { "<<": { status: "off" }, title: "Example" },
    });
  });

  test(`${label}: nested explicit set, ordered-map, timestamp and binary tags remain supported`, () => {
    const source = markdown([
      "value:",
      "  set: !!set {yes: null}",
      "  ordered: !!omap [{yes: off}]",
      "  timestamp: !!timestamp 2026-09-15T10:20:30Z",
      "  binary: !!binary SGk=",
    ].join("\n"), version);
    expect(parseMarkdown(source).data.value).toEqual({
      set: new Set(["yes"]), ordered: new Map([["yes", "off"]]),
      timestamp: new Date("2026-09-15T10:20:30Z"), binary: Buffer.from("Hi"),
    });
  });

  test(`${label}: explicit merge tags retain support and Core scalar resolution`, () => {
    const source = markdown("defaults: &defaults {status: off}\nvalue: {!!merge <<: *defaults, title: Example}", version);
    expect(parseMarkdown(source).data.value).toEqual({ status: "off", title: "Example" });
  });

  test(`${label}: duplicate keys are rejected at every depth after Core resolution`, () => {
    for (const yaml of ["value: 1\nvalue: 2", "value: {nested: 1, nested: 2}", "value: {12: first, 012: second}"]) {
      const source = markdown(yaml, version, "Retained body  \n");
      expect(() => parseMarkdown(source)).toThrow(FrontmatterError);
      try { parseMarkdown(source); } catch (error) {
        expect(error).toMatchObject({ body: "Retained body  \n" });
      }
    }
  });

  test(`${label}: byte and text input consume one BOM while preserving body text and source bytes`, () => {
    for (const ending of ["\n", "\r\n", "\r"]) {
      const body = "Body  \n---\n%YAML 1.1\n--- \nvalue: on\n".replaceAll("\n", ending);
      const source = "\uFEFF" + markdown("value: yes\nliteral: |\n  %YAML 1.1", version, "").replaceAll("\n", ending) + body;
      const bytes = Buffer.from(source);
      const before = Buffer.from(bytes);
      const expected = { data: { value: "yes", literal: "%YAML 1.1\n" }, body, hasFrontmatter: true };
      expect(parseMarkdown(source, { preserveBodyLineEndings: true })).toEqual(expected);
      expect(parseMarkdown(bytes, { preserveBodyLineEndings: true })).toEqual(expected);
      expect(bytes).toEqual(before);
    }
  });
}

const roots: string[] = [];
const schemaDirectory = resolve(import.meta.dir, "../../TypedMarkSpecification/schema/json-schema");

function createRoot(): string {
  const root = mkdtempSync(join(tmpdir(), "typedmark-yaml-core-"));
  roots.push(root);
  return root;
}

function writeSources(root: string, sources: Record<string, string>): void {
  for (const [path, source] of Object.entries(sources)) {
    mkdirSync(dirname(join(root, path)), { recursive: true });
    writeFileSync(join(root, path), source);
  }
}

function expectSourcesUnchanged(root: string, sources: Record<string, string>): void {
  for (const [path, source] of Object.entries(sources)) {
    expect(readFileSync(join(root, path))).toEqual(Buffer.from(source));
  }
}

afterEach(() => {
  for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true });
});

test("collection validation interprets a YAML 1.1 managed note using Core without rewriting it", () => {
  const root = createRoot();
  const sources = {
    "typedmark.md": markdown("specification_version: 0.1.0\nname: core\ndescription: Core baseline."),
    ".typedmark/schemas/note.md": markdown([
      "specification_version: 0.1.0", "description: Note.",
      "storage: {folder_pattern: '', note_name_pattern: '{title}'}",
      "frontmatter:", "  status: {type: text, allowed_values: [yes, no, on, off]}",
      "  amount: {type: integer, allowed_values: [12]}",
    ].join("\n")),
    "Example.md": "\uFEFF" + markdown("note_type: note\nstatus: yes\namount: 012", "1.1", "Body  \n---\n").replaceAll("\n", "\r\n"),
  };
  writeSources(root, sources);
  try {
    expect(validateCollection({ collectionRoot: root, schemaDirectory })).toMatchObject({
      evaluation: "complete", valid: true, results: [],
    });
  } finally { expectSourcesUnchanged(root, sources); }
});

test("collection configuration and schema defaults retain Core meaning under YAML 1.1 directives", () => {
  const root = createRoot();
  const sources = {
    "typedmark.md": markdown("specification_version: 0.1.0\nname: on\ndescription: no", "1.1"),
    ".typedmark/schemas/note.md": markdown([
      "specification_version: 0.1.0", "description: yes",
      "storage: {folder_pattern: '', note_name_pattern: '{title}'}",
      "frontmatter:", "  status: {type: text, default_value: off}",
      "  amount: {type: integer, default_value: 012, allowed_values: [12]}",
    ].join("\n"), "1.1"),
    "Example.md": markdown("note_type: note"),
  };
  writeSources(root, sources);
  try {
    expect(validateCollection({ collectionRoot: root, schemaDirectory })).toMatchObject({
      evaluation: "complete", valid: true, results: [],
    });
  } finally { expectSourcesUnchanged(root, sources); }
});

test("system import uses Core scaffold and template values while preserving source bodies and artifact bytes", async () => {
  const sourceRoot = createRoot();
  const targetRoot = join(createRoot(), "instance");
  const configBody = "System prose  \r\n---\r\n%YAML 1.1\r\n";
  const templateBody = "Starter prose  \r\n---\r\n%YAML 1.1\r\n";
  const sources = {
    "typedmark.md": markdown([
      "specification_version: 0.1.0", "extensions: {typedmark:systems: 0.1.0}",
      'name: "@example/core-baseline"', "description: Core baseline system.", "version: 0.1.0",
      "publisher: {name: Example}", "license: MIT", "scaffold:", "  folders: [Notes]",
      "  notes:", "    - path: Notes/Welcome.md", "      note_type: note",
      "      values: {title: Welcome, status: on, amount: 012}",
    ].join("\n"), "1.1", "").replaceAll("\n", "\r\n") + configBody,
    ".typedmark/schemas/note.md": markdown([
      "specification_version: 0.1.0", "description: Note.",
      "storage: {folder_pattern: Notes, note_name_pattern: '{title}'}",
      "frontmatter:", "  status: {type: text}", "  amount: {type: integer}",
    ].join("\n"), "1.1"),
    ".typedmark/templates/note.md": "\uFEFF" + markdown("note_type: note\ntitle: null\nstatus: off\namount: 012", "1.1", "").replaceAll("\n", "\r\n") + templateBody,
  };
  writeSources(sourceRoot, sources);
  try {
    const result = await instantiateSystem({ sourceRoot, targetRoot, collectionName: "instance", schemaDirectory });
    expect(result.report).toMatchObject({ evaluation: "complete", valid: true, results: [] });
    const note = parseMarkdown(readFileSync(join(targetRoot, "Notes/Welcome.md")), { preserveBodyLineEndings: true });
    expect(note.data).toMatchObject({ status: "on", amount: 12 });
    expect(note.body).toBe(templateBody);
    expect(parseMarkdown(readFileSync(join(targetRoot, "typedmark.md")), { preserveBodyLineEndings: true }).body).toBe(configBody);
    for (const path of [".typedmark/schemas/note.md", ".typedmark/templates/note.md"]) {
      expect(readFileSync(join(targetRoot, path))).toEqual(Buffer.from(sources[path as keyof typeof sources]));
    }
  } finally { expectSourcesUnchanged(sourceRoot, sources); }
});
