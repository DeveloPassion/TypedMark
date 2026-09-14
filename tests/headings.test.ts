import { afterEach, expect, test } from "bun:test";
import { mkdtempSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { validateCollection } from "../src/validator";

const roots: string[] = [];
const schemaDirectory = resolve(import.meta.dir, "../../TypedMarkSpecification/schema/json-schema");

interface HeadingRules {
  required_h2?: readonly string[];
  optional_h2?: readonly string[];
  allow_other_h2?: boolean;
  require_order?: boolean;
  require_h1_title?: boolean;
}

function validate(body: string, headings: HeadingRules, title = "Example") {
  const root = mkdtempSync(join(tmpdir(), "typedmark-headings-"));
  roots.push(root);
  mkdirSync(join(root, ".typedmark", "schemas"), { recursive: true });
  const files = [
    ["typedmark.md", "---\nspecification_version: 0.1.0\nname: headings-test\ndescription: Heading validation.\n---\n"],
    [".typedmark/schemas/note.md", "---\nspecification_version: 0.1.0\ndescription: Note.\n"
      + "storage:\n  folder_pattern: ''\n  note_name_pattern: Example\n"
      + `headings: ${JSON.stringify(headings)}\n---\n`],
    ["Example.md", `---\nnote_type: note\ntitle: ${JSON.stringify(title)}\n---\n\n${body}`],
  ] as const;
  for (const [path, source] of files) writeFileSync(join(root, path), source);

  const report = validateCollection({ collectionRoot: root, schemaDirectory });
  for (const [path, source] of files) {
    expect(readFileSync(join(root, path))).toEqual(Buffer.from(source));
  }
  return report;
}

afterEach(() => {
  for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true });
});

const contextOnly = { required_h2: ["Context"], allow_other_h2: false };
const titledContext = { ...contextOnly, require_h1_title: true };
const complete = { evaluation: "complete", valid: true, results: [] };

// RHT-47 and FND-94: these are CommonMark block structures, not line matches.
test("a shorter backtick fence does not end the enclosing code block", () => {
  const body = "````\n```\n## Hidden\n````\n\n## Context\n";
  expect(validate(body, contextOnly)).toMatchObject(complete);
});

test("a different fence character does not end the enclosing code block", () => {
  const body = "```\n~~~\n## Hidden\n```\n\n## Context\n";
  expect(validate(body, contextOnly)).toMatchObject(complete);
});

test("a longer matching fence closes code before the next heading", () => {
  const body = "~~~\n## Hidden\n~~~~\n\n## Context\n";
  expect(validate(body, contextOnly)).toMatchObject(complete);
});

test("indented and container code do not contribute headings", () => {
  const body = "    ## Indented\n\n"
    + "> ~~~\n> ## Quoted code\n> ~~~\n\n"
    + "- item\n\n      ## List code\n\n"
    + "- item\n\n  ~~~\n  ## Fenced list code\n  ~~~\n\n"
    + "## Context\n";
  expect(validate(body, contextOnly)).toMatchObject(complete);
});

test("headings inside a blockquote satisfy the H1 and H2 contracts", () => {
  expect(validate("> # Example\n>\n> ## Context\n", titledContext)).toMatchObject(complete);
});

test("headings inside list items satisfy the H1 and H2 contracts", () => {
  expect(validate("- # Example\n\n- ## Context\n", titledContext)).toMatchObject(complete);
});

test("multiline setext H1 and H2 content lines join with spaces", () => {
  const body = "A long\ntitle\n===\n\nProject\ncontext\n---\n";
  expect(validate(body, {
    require_h1_title: true, required_h2: ["Project context"], allow_other_h2: false,
  }, "A long title")).toMatchObject(complete);
});

// RHT-54 and RHT-56: compare the inline source, retaining literal Markdown.
test("whitespace-separated ATX closing hashes are delimiters", () => {
  expect(validate("# Example ### \n\n## Context ##\n", titledContext)).toMatchObject(complete);
});

test("ATX trailing hashes without preceding whitespace remain heading text", () => {
  expect(validate("# Example#\n\n## Context#\n", {
    require_h1_title: true, required_h2: ["Context#"], allow_other_h2: false,
  }, "Example#")).toMatchObject(complete);
});

test("an empty ATX H2 is still an undeclared heading", () => {
  const report = validate("##\n", { allow_other_h2: false });
  expect(report).toMatchObject({ evaluation: "complete", valid: false });
  expect(report.results).toEqual([
    expect.objectContaining({ code: "invalid_heading", path: "Example.md" }),
  ]);
});

test("escaped heading markers and code spans do not create headings", () => {
  const body = "\\# Escaped\n\n\\## Escaped\n\n`## Code span`\n\n## Context\n";
  expect(validate(body, contextOnly)).toMatchObject(complete);
});

test("inline emphasis, code and entity spelling remain raw H1 and H2 text", () => {
  const title = "*Example* `code` &amp;";
  const heading = "*Context* `code` &amp;";
  expect(validate(`# ${title}\n\n## ${heading}\n`, {
    require_h1_title: true, required_h2: [heading], allow_other_h2: false,
  }, title)).toMatchObject(complete);
});

// FND-38 and FND-40 apply to both operands, without rewriting source bytes.
test("H1 titles and both declared H2 lists compare after NFC normalization", () => {
  for (const [title, bodyTitle, required, bodyRequired, optional, bodyOptional] of [
    ["Caf\u00e9", "Cafe\u0301", "R\u00e9sum\u00e9", "Re\u0301sume\u0301", "Na\u00efve", "Nai\u0308ve"],
    ["Cafe\u0301", "Caf\u00e9", "Re\u0301sume\u0301", "R\u00e9sum\u00e9", "Nai\u0308ve", "Na\u00efve"],
  ]) {
    expect(validate(`# ${bodyTitle}\r\n\r\n## ${bodyRequired}\r\n\r\n## ${bodyOptional}\r\n`, {
      require_h1_title: true, required_h2: [required!], optional_h2: [optional!], allow_other_h2: false,
    }, title)).toMatchObject(complete);
  }
});

test("H1 title and declared H2 matching remain case-sensitive", () => {
  const report = validate("# example\n\n## context\n", titledContext);
  expect(report).toMatchObject({ evaluation: "complete", valid: false });
  expect(report.results).toHaveLength(3);
  expect(report.results).toEqual(expect.arrayContaining([
    expect.objectContaining({ code: "invalid_heading", path: "Example.md", heading: "Context" }),
    expect.objectContaining({ code: "invalid_heading", path: "Example.md", heading: "context" }),
  ]));
});

const ordered = {
  required_h2: ["Context", "Decision"], optional_h2: ["Notes", "References"],
  allow_other_h2: false, require_order: true,
};

test("required and optional H2 lists preserve order independently when interleaved", () => {
  const body = "## Notes\n\n## Context\n\n## References\n\n## Decision\n";
  expect(validate(body, ordered)).toMatchObject(complete);
});

test("a reversed required or optional H2 list violates its own order", () => {
  for (const body of [
    "## Decision\n\n## Notes\n\n## Context\n\n## References\n",
    "## Context\n\n## References\n\n## Decision\n\n## Notes\n",
  ]) {
    const report = validate(body, ordered);
    expect(report).toMatchObject({ evaluation: "complete", valid: false });
    expect(report.results).toEqual([
      expect.objectContaining({ code: "invalid_heading", path: "Example.md" }),
    ]);
  }
});

test.each([
  { body: "", rules: { required_h2: ["Context"] }, rule: "RHT-58" },
  { body: "## Notes\n\n## Notes\n", rules: { optional_h2: ["Notes"] }, rule: "RHT-59" },
  { body: "## Unexpected\n", rules: { allow_other_h2: false }, rule: "RHT-60" },
  { body: "## B\n\n## A\n", rules: { required_h2: ["A", "B"], require_order: true }, rule: "RHT-62" },
])("H2 diagnostics identify the owning constraint: $rule", ({ body, rules, rule }) => {
  expect(validate(body, rules).results).toEqual([expect.objectContaining({ code: "invalid_heading", rule_id: rule })]);
});

test.each(["## Context\t##\n", "Context\n---\t\n"])("CommonMark tab delimiters remain valid: %j", (body) => {
  expect(validate(body, contextOnly)).toMatchObject(complete);
});

test.each([" A\n   B\n---\n", "> A\n>   B\n> ---\n"])("setext continuation indentation is not heading content: %j", (body) => {
  expect(validate(body, { required_h2: ["A B"], allow_other_h2: false })).toMatchObject(complete);
});

test("a non-breaking space after opening hashes does not create an ATX heading", () => {
  expect(validate("##\u00a0Not a heading\n", { allow_other_h2: false })).toMatchObject(complete);
});

test.each(["\u2028", "\u2029"])("Unicode separator %j is inline content, not a Markdown line boundary", (separator) => {
  const text = `A${separator}B`;
  expect(validate(`## ${text}\n`, { required_h2: [text], allow_other_h2: false })).toMatchObject(complete);
});

test("CommonMark replaces NUL in parsed heading content without rewriting source bytes", () => {
  expect(validate("## A\0B\n", { required_h2: ["A\ufffdB"], allow_other_h2: false })).toMatchObject(complete);
});

test("a link-reference definition does not break a following setext paragraph continuation", () => {
  expect(validate("[A]: /url\n    B\n---\n", { required_h2: ["B"], allow_other_h2: false })).toMatchObject(complete);
});

test("a blank line after a reference definition allows an indented code block", () => {
  expect(validate("[A]: /url\n\n    B\n---\n\n## Context\n", contextOnly)).toMatchObject(complete);
});
