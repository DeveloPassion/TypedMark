import { expect, test } from "bun:test";
import { cpSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { parseMarkdown } from "../src/frontmatter";
import { validateCollection } from "../src/validator";

for (const ending of ["\n", "\r\n", "\r"]) {
  test.each([0, 1, 2, 3])(`text and byte inputs consume one leading BOM at most: ending=${JSON.stringify(ending)} count=%i`, count => {
    const source = "\uFEFF".repeat(count) + ["---", "value: yes", "...", "Body  ", "\uFEFFContent", ""].join(ending);
    const bytes = Buffer.from(source);
    const before = Buffer.from(bytes);
    const text = parseMarkdown(source, { preserveBodyLineEndings: true });
    expect(text.hasFrontmatter).toBe(count < 2);
    expect(parseMarkdown(bytes, { preserveBodyLineEndings: true })).toEqual(text);
    expect(bytes.equals(before)).toBe(true);
  });
}

test("a second leading BOM remains body content, not a hidden delimiter prefix", () => {
  const body = "\uFEFF---\nnot YAML: [\n---\n";
  expect(parseMarkdown(Buffer.from("\uFEFF" + body))).toEqual({ data: {}, hasFrontmatter: false, body });
});

test("an ordinary encoded replacement character is not a decoding failure", () => {
  const source = "\uFEFF---\nvalue: \uFFFD\n---\nBody \uFFFD\n";
  expect(parseMarkdown(Buffer.from(source))).toEqual(parseMarkdown(source));
});

test("a doubled BOM cannot hide a malformed collection-config delimiter", () => {
  const root = mkdtempSync(join(tmpdir(), "typedmark-double-bom-"));
  const specification = resolve(import.meta.dir, "../../TypedMarkSpecification");
  try {
    cpSync(join(specification, "schema/fixtures/golden/core-valid/collection"), root, { recursive: true });
    const path = join(root, "typedmark.md");
    const bytes = Buffer.concat([Buffer.from("\uFEFF\uFEFF"), readFileSync(path)]);
    writeFileSync(path, bytes);
    const report = validateCollection({ collectionRoot: root, schemaDirectory: join(specification, "schema/json-schema") });
    expect(report.valid).toBe(false);
    expect(report.results).toContainEqual(expect.objectContaining({ code: "invalid_collection_configuration", path: "typedmark.md" }));
    expect(report.results.some(result => result.rule_id === "FND-28")).toBe(false);
    expect(readFileSync(path).equals(bytes)).toBe(true);
  } finally { rmSync(root, { recursive: true, force: true }); }
});
