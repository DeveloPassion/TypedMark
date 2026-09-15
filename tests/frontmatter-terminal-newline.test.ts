import { expect, test } from "bun:test";
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { parseMarkdown, parseMarkdownWithNodes } from "../src/frontmatter";
import { validateCollection } from "../src/validator";
import { instantiateSystem } from "../src/system";

// FND-25 and FND-32..36: the line break before the closing delimiter belongs
// to the YAML content. Keep chomping retains that break even at the boundary.
test.each([
  ["LF literal", "\n", "---", "x_text: |+\n  retained\n\n", "retained\n\n"],
  ["LF folded", "\n", "...", "x_text: >+\n  first\n  second\n\n", "first second\n\n"],
  ["CRLF literal", "\r\n", "...", "x_text: |+\n  retained\n\n", "retained\n\n"],
  ["CRLF folded", "\r\n", "---", "x_text: >+\n  first\n  second\n\n", "first second\n\n"],
  ["CR literal", "\r", "---", "x_text: |+\n  retained\n\n", "retained\n\n"],
  ["CR folded", "\r", "...", "x_text: >+\n  first\n  second\n\n", "first second\n\n"],
])("keeps the terminal YAML break for %s text and bytes", (_name, ending, closing, yaml, value) => {
  const body = ["Body  ", "second", "---", "...", ""].join(ending);
  const source = `---${ending}${yaml.replaceAll("\n", ending)}${closing}${ending}${body}`;
  const bytes = Buffer.from(source);
  const before = Buffer.from(bytes);
  for (const input of [source, bytes]) {
    expect(parseMarkdown(input)).toEqual({
      data: { x_text: value }, body: "Body  \nsecond\n---\n...\n", hasFrontmatter: true,
    });
    expect(parseMarkdown(input, { preserveBodyLineEndings: true })).toEqual({
      data: { x_text: value }, body, hasFrontmatter: true,
    });
  }
  expect(bytes).toEqual(before);
});

test.each(["---", "..."])("keeps YAML content when closing %s is at EOF", closing => {
  const source = `---\nx_text: |+\n  retained\n\n${closing}`;
  for (const preserveBodyLineEndings of [false, true]) {
    expect(parseMarkdown(source, { preserveBodyLineEndings })).toEqual({
      data: { x_text: "retained\n\n" }, body: "", hasFrontmatter: true,
    });
  }
});

test("retains terminal breaks in nested sequence scalars and the writer's YAML document", () => {
  const parsed = parseMarkdownWithNodes("---\nx_nested:\n  items:\n    - |+\n      retained\n\n\n---\n");
  const expected = { x_nested: { items: ["retained\n\n\n"] } };
  expect(parsed.data).toEqual(expected);
  expect(parsed.frontmatter?.toJS()).toEqual(expected);
});

test.each([
  ["literal clip", "x_text: |\n  retained\n\n", "retained\n"],
  ["folded clip", "x_text: >\n  first\n  second\n\n", "first second\n"],
  ["literal strip", "x_text: |-\n  retained\n\n", "retained"],
  ["folded strip", "x_text: >-\n  first\n  second\n\n", "first second"],
  ["empty keep scalar", "x_text: |+\n", ""],
  ["blank keep scalar", "x_text: |+\n\n", "\n"],
])("honors %s at the frontmatter boundary", (_name, yaml, value) => {
  expect(parseMarkdown(`---\n${yaml}---\n`).data).toEqual({ x_text: value });
});

test.each(["", "# Only a comment\n"])("keeps empty frontmatter a mapping: %j", yaml => {
  expect(parseMarkdown(`---\n${yaml}---\nBody\n`)).toEqual({
    data: {}, body: "Body\n", hasFrontmatter: true,
  });
});

test("indented delimiter text remains scalar content and one leading BOM is ignored", () => {
  const source = "\uFEFF---\r\nx_text: |+\r\n  ---\r\n  ...\r\n\r\n...\r\nBody\r\n";
  for (const input of [source, Buffer.from(source)]) {
    expect(parseMarkdown(input, { preserveBodyLineEndings: true })).toEqual({
      data: { x_text: "---\n...\n\n" }, body: "Body\r\n", hasFrontmatter: true,
    });
  }
});

test.each([
  "--- \r\nx_text: |+\r\n  retained\r\n\r\n---\r\n",
  "---\r\nx_text: |+\r\n  retained\r\n\r\n... \r\n",
  "\uFEFF---\r\nx_text: |+\r\n  retained\r\n\r\n---\r\n",
])("non-exact or unclosed delimiters remain body after consuming one BOM: %j", body => {
  const source = "\uFEFF" + body;
  expect(parseMarkdown(Buffer.from(source))).toEqual({ data: {}, body, hasFrontmatter: false });
});

test("collection validation counts kept terminal breaks without rewriting source bytes", () => {
  const root = mkdtempSync(join(tmpdir(), "typedmark-terminal-newline-"));
  const fixtures = new Map([
    ["typedmark.md", Buffer.from("---\nspecification_version: 0.1.0\nname: terminal-newline\ndescription: Parsing.\n---\n")],
    [".typedmark/schemas/note.md", Buffer.from("---\nspecification_version: 0.1.0\ndescription: Note.\nstorage:\n  folder_pattern: ''\n  note_name_pattern: '{title}'\nfrontmatter:\n  text:\n    type: text\n    min: 10\n    max: 10\n---\n")],
    ["Example.md", Buffer.from("\uFEFF---\r\nnote_type: note\r\ntext: |+\r\n  retained\r\n\r\n...\r\nBody  \r\nsecond\r\n")],
  ]);
  try {
    for (const [relative, bytes] of fixtures) {
      const path = join(root, relative);
      mkdirSync(dirname(path), { recursive: true });
      writeFileSync(path, bytes);
    }
    const report = validateCollection({
      collectionRoot: root,
      schemaDirectory: resolve(import.meta.dir, "../../TypedMarkSpecification/schema/json-schema"),
    });
    for (const [relative, bytes] of fixtures) expect(readFileSync(join(root, relative))).toEqual(bytes);
    expect(report).toMatchObject({ evaluation: "complete", valid: true, results: [] });
  } finally { rmSync(root, { recursive: true, force: true }); }
});

test("system import retains final keep-chomp values in root metadata and scaffold notes", async () => {
  const parent = mkdtempSync(join(tmpdir(), "typedmark-import-newline-"));
  const sourceRoot = join(parent, "source"), targetRoot = join(parent, "instance");
  const schemaDirectory = resolve(import.meta.dir, "../../TypedMarkSpecification/schema/json-schema");
  const rootBody = "Root documentation.  \r\nNext line.\n", noteBody = "Note content.  \r\nNext line.\n";
  const fixtures = new Map([
    ["typedmark.md", "---\nspecification_version: 0.1.0\nname: '@example/newlines'\ndescription: Parsing.\nversion: 0.1.0\nextensions: {typedmark:systems: 0.1.0}\nscaffold:\n  notes: [{path: Notes/Example.md, note_type: note}]\nx_text: |+\n  retained\n\n---\n" + rootBody],
    [".typedmark/schemas/note.md", "---\nspecification_version: 0.1.0\ndescription: Note.\nstorage: {folder_pattern: Notes, note_name_pattern: Example}\n---\n"],
    [".typedmark/templates/note.md", "---\nnote_type: note\ndescription: |+\n  retained\n\n---\n" + noteBody],
  ]);
  try {
    for (const [relative, source] of fixtures) {
      const path = join(sourceRoot, relative);
      mkdirSync(dirname(path), { recursive: true });
      writeFileSync(path, source);
    }
    expect(validateCollection({ collectionRoot: sourceRoot, schemaDirectory, mode: "system_definition" }))
      .toMatchObject({ valid: true, evaluation: "complete", results: [] });
    const result = await instantiateSystem({ sourceRoot, targetRoot, schemaDirectory, collectionName: "working" });
    expect(result.report).toMatchObject({ valid: true, evaluation: "complete", results: [] });
    const root = parseMarkdown(readFileSync(join(targetRoot, "typedmark.md")), { preserveBodyLineEndings: true });
    const note = parseMarkdown(readFileSync(join(targetRoot, "Notes/Example.md")), { preserveBodyLineEndings: true });
    expect(root.data.x_text).toBe("retained\n\n");
    expect(root.body).toBe(rootBody);
    expect(note.data.description).toBe("retained\n\n");
    expect(note.body).toBe(noteBody);
  } finally {
    for (const [relative, source] of fixtures) expect(readFileSync(join(sourceRoot, relative))).toEqual(Buffer.from(source));
    rmSync(parent, { recursive: true, force: true });
  }
});

test.each([" \n", " \n \n", "\n \n", "retained\n\n"])("scaffold serialization preserves explicit multiline whitespace %j", async value => {
  const parent = mkdtempSync(join(tmpdir(), "typedmark-scaffold-whitespace-"));
  const sourceRoot = join(parent, "source"), targetRoot = join(parent, "instance");
  const schemaDirectory = resolve(import.meta.dir, "../../TypedMarkSpecification/schema/json-schema");
  const fixtures = new Map([
    ["typedmark.md", `---\nspecification_version: 0.1.0\nname: '@example/whitespace'\ndescription: Parsing.\nversion: 0.1.0\nextensions: {typedmark:systems: 0.1.0}\nscaffold:\n  notes:\n    - path: Notes/Example.md\n      note_type: note\n      values: {description: ${JSON.stringify(value)}}\n---\n`],
    [".typedmark/schemas/note.md", "---\nspecification_version: 0.1.0\ndescription: Note.\nstorage: {folder_pattern: Notes, note_name_pattern: Example}\n---\n"],
  ]);
  try {
    for (const [relative, source] of fixtures) {
      const path = join(sourceRoot, relative);
      mkdirSync(dirname(path), { recursive: true });
      writeFileSync(path, source);
    }
    expect(validateCollection({ collectionRoot: sourceRoot, schemaDirectory, mode: "system_definition" }))
      .toMatchObject({ valid: true, evaluation: "complete", results: [] });
    const result = await instantiateSystem({ sourceRoot, targetRoot, schemaDirectory, collectionName: "working" });
    expect(result.report).toMatchObject({ valid: true, evaluation: "complete", results: [] });
    expect(parseMarkdown(readFileSync(join(targetRoot, "Notes/Example.md"))).data.description).toBe(value);
  } finally {
    for (const [relative, source] of fixtures) expect(readFileSync(join(sourceRoot, relative))).toEqual(Buffer.from(source));
    rmSync(parent, { recursive: true, force: true });
  }
});
