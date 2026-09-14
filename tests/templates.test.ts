import { afterEach, expect, test } from "bun:test";
import { mkdirSync, mkdtempSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { tmpdir } from "node:os";
import { deriveStarter, resolveTemplate, validateTemplateFields } from "../src/templates";

const roots: string[] = [];
const root = () => { const path = mkdtempSync(join(tmpdir(), "typedmark-template-unit-")); roots.push(path); return path; };
function file(directory: string, name: string, content: string) {
  const path = join(directory, ".typedmark/templates", name);
  mkdirSync(dirname(path), { recursive: true }); writeFileSync(path, content);
}
afterEach(() => { for (const path of roots.splice(0)) rmSync(path, { recursive: true, force: true }); });

test("template resolution distinguishes derived state from a broken explicit reference", () => {
  const directory = root();
  expect(resolveTemplate(directory, ".typedmark", "note", {})).toMatchObject({ kind: "derived" });
  expect(resolveTemplate(directory, ".typedmark", "note", { template: { file: "missing.md" } })).toMatchObject({ kind: "invalid", rule: "RHT-73" });
});

test("scaffold override precedes effective explicit and conventional templates", () => {
  const directory = root();
  for (const name of ["note.md", "explicit.md", "override.md"]) file(directory, name, name);
  const schema = { template: { file: "explicit.md" } };
  expect(resolveTemplate(directory, ".typedmark", "note", schema)).toMatchObject({ kind: "file", document: { body: "explicit.md" } });
  expect(resolveTemplate(directory, ".typedmark", "note", schema, "override.md")).toMatchObject({ kind: "file", document: { body: "override.md" } });
});

test("template resolution uses case-sensitive NFC names on every platform", () => {
  const directory = root(); file(directory, "e\u0301/Starter.md", "Text");
  expect(resolveTemplate(directory, ".typedmark", "note", {}, "é/Starter.md")).toMatchObject({ kind: "file" });
  expect(resolveTemplate(directory, ".typedmark", "note", {}, "é/starter.md")).toMatchObject({ kind: "invalid" });
});

test.each(["../outside.md", "/outside.md", "templates/note.md", ".typedmark/templates/note.md", "dir\\note.md"])("template path %s cannot escape or restate its base", (name) => {
  expect(resolveTemplate(root(), ".typedmark", "note", {}, name)).toMatchObject({ kind: "invalid", rule: "NTS-45" });
});

test("template resolution rejects linked ancestor directories", () => {
  const directory = root(), outside = root();
  mkdirSync(join(directory, ".typedmark/templates"), { recursive: true });
  writeFileSync(join(outside, "note.md"), "Outside");
  symlinkSync(outside, join(directory, ".typedmark/templates/linked"), "junction");
  expect(resolveTemplate(directory, ".typedmark", "note", {}, "linked/note.md")).toMatchObject({ kind: "invalid", rule: "RHT-73" });
});

test("derived starters preserve declared order without inventing optional Core fields", () => {
  const schema = { frontmatter: { status: { type: "text" as const }, details: { type: "object" as const } },
    headings: { required_h2: ["Context", "Decision"] }, mandatory_tags: ["é", "type/note"] };
  const starter = deriveStarter(schema, { mandatory_tags: ["managed", "e\u0301"] });
  expect(starter).toEqual({ data: { status: null, details: null, tags: ["managed", "e\u0301", "type/note"] }, body: "## Context\n\n## Decision\n" });
  expect(starter.data).not.toHaveProperty("created_at");
});

test("template overlays retain derived omissions and preserve the supplied body", () => {
  const schema = { frontmatter: { summary: { type: "text" as const }, status: { type: "text" as const } } };
  const document = { data: { status: "draft" }, body: "First  \nsecond\n", hasFrontmatter: true };
  const starter = deriveStarter(schema, {}, document);
  expect(starter).toEqual({ data: { summary: null, status: "draft" }, body: document.body });
  starter.data.status = "changed";
  expect(document.data.status).toBe("draft");
});

test("template fields validate concrete values before a caller can override them", () => {
  const schema = { frontmatter: { status: { type: "text" as const, allowed_values: ["open"] } } };
  expect(validateTemplateFields({ status: "bogus" }, schema, {}, "note")).toEqual([
    expect.objectContaining({ rule: "RHT-80", field: "status" }),
  ]);
});

test("template placeholders are allowed recursively without excusing concrete bad values", () => {
  const schema = { frontmatter: { details: { type: "object" as const, fields: {
    title: { type: "text" as const, min: 1 }, priority: { type: "integer" as const },
  } }, links: { type: "list" as const, items: { type: "link" as const, format: "note_link" } } } };
  expect(validateTemplateFields({ details: { title: "" }, links: [""] }, schema, {}, "note")).toEqual([]);
  expect(validateTemplateFields({ details: { priority: "bad" } }, schema, {}, "note")).toEqual([
    expect.objectContaining({ rule: "RHT-80", field: "details" }),
  ]);
});

test("template fields check Core identity, aliases, and undeclared nested properties", () => {
  const schema = { frontmatter: { details: { type: "object" as const, fields: {} } } };
  expect(validateTemplateFields({ note_type: "other", aliases: ["a/b"], details: { extra: true } }, schema, {}, "note")
    .map((failure) => failure.field)).toEqual(["note_type", "aliases", "details.extra"]);
});

test.each([{ aliases: [null, "a/b"] }, { aliases: [null, "ok", "ok"] }])("alias placeholders cannot mask invalid concrete aliases: %j", ({ aliases }) => {
  expect(validateTemplateFields({ aliases }, {}, {}, "note")).toEqual([expect.objectContaining({ rule: "RHT-80", field: "aliases" })]);
});

test.each([{ allowed_values: ["open"] }, { allowed_values_from: "statuses" }] as Array<{ allowed_values?: unknown[]; allowed_values_from?: string }>)("list constraints skip placeholders but check concrete entries: %j", (constraint) => {
  const schema = { frontmatter: { statuses: { type: "list" as const, items: { type: "text" as const }, ...constraint } } };
  const config = { vocabularies: { statuses: { values: ["open"] } } };
  expect(validateTemplateFields({ statuses: [null, "", "open"] }, schema, config, "note")).toEqual([]);
  expect(validateTemplateFields({ statuses: [null, "bad"] }, schema, config, "note")).toEqual([expect.objectContaining({ rule: "RHT-80" })]);
});

test.each([{ not_empty: true }, { const_value: { status: "open" } }])("template object constraints use deterministic child defaults: %j", (constraint) => {
  const schema = { frontmatter: { details: { type: "object" as const, fields: { status: { type: "text" as const, default_value: "open" } }, ...constraint } } };
  expect(validateTemplateFields({ details: {} }, schema, {}, "note")).toEqual([]);
});

test.each(["null", "~", "!!null null", "!!set {key: null}"])("explicit scalar/set frontmatter %s is not an empty template mapping", (value) => {
  const directory = root(); file(directory, "note.md", `---\n${value}\n---\n`);
  expect(resolveTemplate(directory, ".typedmark", "note", {})).toMatchObject({ kind: "invalid", rule: "RHT-67" });
});

test.each(["", "# comment"])("an empty/comment-only template mapping remains valid: %j", (value) => {
  const directory = root(); file(directory, "note.md", `---\n${value}\n---\n`);
  expect(resolveTemplate(directory, ".typedmark", "note", {})).toMatchObject({ kind: "file", document: { data: {} } });
});

test.each(["./note.md", "nested/./note.md", "nested//note.md"])("redundant relative template segments remain supported: %s", (name) => {
  const directory = root(); file(directory, "note.md", "Body"); file(directory, "nested/note.md", "Body");
  expect(resolveTemplate(directory, ".typedmark", "note", {}, name)).toMatchObject({ kind: "file" });
});

test.each(["!!set {extra: null}", "!!omap [{priority: bad}]"])("tagged nested %s values cannot become empty object fields", (value) => {
  const directory = root(); file(directory, "note.md", `---\ndetails: ${value}\n---\n`);
  const selected = resolveTemplate(directory, ".typedmark", "note", {});
  expect(selected.kind).toBe("file");
  if (selected.kind !== "file") throw new Error("Fixture template did not parse");
  expect(validateTemplateFields(selected.document.data, { frontmatter: { details: { type: "object", fields: {} } } }, {}, "note"))
    .toEqual([expect.objectContaining({ rule: "RHT-80", field: "details" })]);
});
