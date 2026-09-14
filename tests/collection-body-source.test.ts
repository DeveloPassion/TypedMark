import { afterEach, expect, test } from "bun:test";
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { tmpdir } from "node:os";
import { stringify } from "yaml";
import { readCollectionModel } from "../src/validator";

const schemaDirectory = resolve(import.meta.dir, "../../TypedMarkSpecification/schema/json-schema");
const roots: string[] = [];
const lineEndings = [
  { name: "LF", eol: "\n" },
  { name: "CRLF", eol: "\r\n" },
  { name: "CR", eol: "\r" },
];

function writeArtifact(root: string, path: string, data: unknown) {
  const destination = join(root, path);
  mkdirSync(dirname(destination), { recursive: true });
  writeFileSync(destination, `---\n${stringify(data)}---\n`);
}

function collection(source: string) {
  const root = mkdtempSync(join(tmpdir(), "typedmark-body-source-"));
  roots.push(root);
  writeArtifact(root, "typedmark.md", {
    specification_version: "0.1.0", name: "body-source", description: "Body source preservation.",
  });
  writeArtifact(root, ".typedmark/schemas/note.md", {
    specification_version: "0.1.0", description: "Note.",
    storage: { folder_pattern: "", note_name_pattern: "A" },
  });
  const path = join(root, "A.md");
  const bytes = Buffer.from(source, "utf8");
  writeFileSync(path, bytes);
  return { root, path, bytes };
}

afterEach(() => {
  for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true });
});

test.each(lineEndings)("retains the exact body after $name frontmatter in documents and managed notes", ({ eol }) => {
  const body = ["# Heading", "Cafe\u0301 📝  ", "", "Second line", ""].join(eol);
  const source = `---${eol}note_type: note${eol}---${eol}${body}`;
  const fixture = collection(source);

  const model = readCollectionModel({ collectionRoot: fixture.root, schemaDirectory });

  expect(readFileSync(fixture.path)).toEqual(fixture.bytes);
  expect(model.report).toMatchObject({ valid: true, results: [] });
  expect(model.documents).toHaveLength(1);
  expect(model.notes).toHaveLength(1);
  expect(model.documents[0]).toMatchObject({ path: "A.md", hasFrontmatter: true, frontmatterValid: true });
  expect(model.notes[0]).toMatchObject({ path: "A.md", noteType: "note" });
  expect(model.documents[0]!.body).toBe(body);
  expect(model.notes[0]!.body).toBe(body);
});

test.each(lineEndings)("retains the exact body when $name note frontmatter contains malformed YAML", ({ eol }) => {
  const body = ["# Surviving body", "Cafe\u0301 📝  ", "", "Last line without a terminator"].join(eol);
  const source = `---${eol}note_type: [unterminated${eol}---${eol}${body}`;
  const fixture = collection(source);

  const model = readCollectionModel({ collectionRoot: fixture.root, schemaDirectory });

  expect(readFileSync(fixture.path)).toEqual(fixture.bytes);
  expect(model.report.valid).toBe(false);
  expect(model.report.results).toContainEqual(expect.objectContaining({
    code: "invalid_note_frontmatter", path: "A.md", rule_id: "MN-118",
  }));
  expect(model.notes).toEqual([]);
  expect(model.documents).toHaveLength(1);
  expect(model.documents[0]).toMatchObject({ path: "A.md", frontmatterValid: false });
  expect(model.documents[0]!.body).toBe(body);
});

test.each(lineEndings)("keeps body-only notes with $name endings unchanged", ({ eol }) => {
  const body = ["# Ordinary note", "Cafe\u0301 📝  ", "", "No frontmatter"].join(eol);
  const fixture = collection(body);

  const model = readCollectionModel({ collectionRoot: fixture.root, schemaDirectory });

  expect(readFileSync(fixture.path)).toEqual(fixture.bytes);
  expect(model.report).toMatchObject({ valid: true, results: [] });
  expect(model.documents).toHaveLength(1);
  expect(model.documents[0]).toMatchObject({ path: "A.md", hasFrontmatter: false, frontmatterValid: true });
  expect(model.documents[0]!.body).toBe(body);
});
