import { afterEach, expect, test } from "bun:test";
import { createHash } from "node:crypto";
import { mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { stringify } from "yaml";
import { readCollectionModel, validateCollection } from "../src/validator";
import { parseNoteLink, resolveNoteLink } from "../src/note-links";
import { queryCollection } from "../src/query";

const schemaDirectory = resolve(import.meta.dir, "../../TypedMarkSpecification/schema/json-schema");
const roots: string[] = [];
const states = [
  { name: "omitted", flags: {} },
  { name: "active", flags: { deleted: false, archived: false } },
  { name: "deleted", flags: { deleted: true, archived: false } },
  { name: "archived", flags: { deleted: false, archived: true } },
  { name: "deleted and archived", flags: { deleted: true, archived: true } },
] satisfies Array<{ name: string; flags: { deleted?: boolean; archived?: boolean } }>;
type Flags = { deleted?: boolean; archived?: boolean };
type Kind = "belongs_to" | "related_to";

function write(root: string, path: string, data: object, body = "") {
  mkdirSync(dirname(join(root, path)), { recursive: true });
  writeFileSync(join(root, path), `---\n${stringify(data)}---\n${body}`);
}
function snapshot(root: string): Array<[string, string]> {
  return readdirSync(root, { recursive: true, withFileTypes: true }).filter((entry) => entry.isFile())
    .map((entry): [string, string] => {
      const path = join(entry.parentPath, entry.name);
      return [path.slice(root.length + 1).replaceAll("\\", "/"), createHash("sha256").update(readFileSync(path)).digest("hex")];
    }).sort(([left], [right]) => left.localeCompare(right));
}
function fixture(source: Flags = {}, target: Flags = {}, kind: Kind = "belongs_to", sourceFolder?: string, withArchive = true) {
  const root = mkdtempSync(join(tmpdir(), "typedmark-lifecycle-audit-")); roots.push(root);
  write(root, "typedmark.md", { specification_version: "0.1.0", name: "lifecycle-audit", description: "Read-only lifecycle audit." });
  const storage = { folder_pattern: "Notes", note_name_pattern: "{title}",
    ...(withArchive ? { archive: { folder_pattern: "Archive", note_name_pattern: "{title}" } } : {}) };
  write(root, ".typedmark/schemas/source.md", {
    specification_version: "0.1.0", description: "Source.", storage, count: { min: 1, max: 1 },
    frontmatter: { score: { type: "integer", default_value: 1 },
      parent: { type: "link", format: "note_link", nullable: true, validate_exists: true, relationship_kind: kind } },
    headings: { require_h1_title: true, required_h2: ["Required"] },
    relationships: { belongs_to: { allowed_note_types: kind === "belongs_to" ? { target: { min: 1, max: 1 } } : {} },
      related_to: { allowed_note_types: kind === "related_to" ? { target: { min: 1, max: 1 } } : {} } },
  });
  write(root, ".typedmark/schemas/target.md", { specification_version: "0.1.0", description: "Target.", storage });
  const sourcePath = `${sourceFolder ?? (withArchive && source.archived ? "Archive" : "Notes")}/Source.md`;
  const targetPath = `${withArchive && target.archived ? "Archive" : "Notes"}/Target.md`;
  const sourceData = { note_type: "source", title: "Source", id: "source-id", parent: "[[stable]]", ...source };
  write(root, sourcePath, sourceData, "# Source\n\n## Required\n\n![[stable]] [[alias-target]]\n");
  write(root, targetPath, { note_type: "target", title: "Target", id: "stable", aliases: ["alias-target"], ...target });
  return { root, sourcePath, targetPath, sourceData };
}
function query(root: string, descriptor: Record<string, unknown> = {}) {
  return queryCollection({ collectionRoot: root, schemaDirectory, queryVersion: "0.1.0",
    query: { specification_version: "0.1.0", note_types: ["source"], select: [{ kind: "path", as: "path" }], ...descriptor } });
}
afterEach(() => { for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true }); });

test.each(states)("$name source retains type, fields, counts, storage and query selection", ({ flags }) => {
  const { root, sourcePath } = fixture(flags);
  const before = snapshot(root);
  const model = readCollectionModel({ collectionRoot: root, schemaDirectory });
  expect(model.report).toMatchObject({ valid: true, evaluation: "complete", results: [], required_extensions: {} });
  const source = model.notes.find((note) => note.path === sourcePath)!;
  expect(source.noteType).toBe("source");
  expect(source.values).toMatchObject({ id: "source-id", score: 1, deleted: flags.deleted ?? false, archived: flags.archived ?? false });
  expect(source.stored).not.toHaveProperty("score");
  expect(query(root)).toMatchObject({ evaluation: "complete", rows: flags.deleted ? [] : [{ path: sourcePath }] });
  expect(query(root, { include_deleted: true })).toMatchObject({ evaluation: "complete", rows: [{ path: sourcePath }] });
  expect(snapshot(root)).toEqual(before);
});

test.each(states)("$name source is still checked for field, heading, path and relationship violations", ({ flags }) => {
  const { root, sourcePath, sourceData } = fixture(flags);
  // A title mismatch makes the existing location invalid without moving a file.
  write(root, sourcePath, { ...sourceData, title: "Elsewhere", score: "bad", parent: null }, "# Wrong\n");
  const before = snapshot(root);
  const report = validateCollection({ collectionRoot: root, schemaDirectory });
  expect(report).toMatchObject({ valid: false, evaluation: "complete" });
  expect(new Set(report.results.map((finding) => finding.code))).toEqual(new Set([
    "invalid_field_value", "invalid_heading", "path", "invalid_relationship_instance",
  ]));
  expect(report.results.every((finding) => finding.path === sourcePath)).toBe(true);
  expect(report.results).toContainEqual(expect.objectContaining({ code: "invalid_field_value", field: "score" }));
  expect(report.results).toContainEqual(expect.objectContaining({ code: "path", rule_id: "NTS-146" }));
  expect(report.results).toContainEqual(expect.objectContaining({ code: "invalid_relationship_instance", rule_id: "RHT-31", relationship: "belongs_to" }));
  expect(snapshot(root)).toEqual(before);
});

test.each(states.slice(1))("$name source cannot use the opposite storage branch", ({ flags }) => {
  const { root, sourcePath } = fixture(flags, {}, "belongs_to", flags.archived ? "Notes" : "Archive");
  const before = snapshot(root);
  const report = validateCollection({ collectionRoot: root, schemaDirectory });
  expect(report).toMatchObject({ valid: false, evaluation: "complete" });
  expect(report.results).toEqual([expect.objectContaining({ code: "path", rule_id: "NTS-146", path: sourcePath })]);
  expect(snapshot(root)).toEqual(before);
});

for (const deleted of [false, true]) {
  test.each(["Notes", "Archive"])(`an archived source without an archive block still enforces active storage in %s (deleted=${deleted})`, (folder) => {
    const { root, sourcePath } = fixture({ archived: true, deleted }, {}, "belongs_to", folder, false);
    const before = snapshot(root);
    const report = validateCollection({ collectionRoot: root, schemaDirectory });
    expect(report).toMatchObject({ valid: folder === "Notes", evaluation: "complete" });
    expect(report.results).toEqual(folder === "Notes" ? [] : [expect.objectContaining({ code: "path", rule_id: "NTS-146", path: sourcePath })]);
    expect(snapshot(root)).toEqual(before);
  });
}

for (const kind of ["belongs_to", "related_to"] as const) {
  test.each(states)(`$name target remains resolvable with ${kind} cardinality based only on deletion`, ({ flags }) => {
    const { root, sourcePath, targetPath } = fixture({ deleted: true }, flags, kind);
    const before = snapshot(root);
    const model = readCollectionModel({ collectionRoot: root, schemaDirectory });
    expect(model.report.evaluation).toBe("complete");
    expect(model.report.valid).toBe(!flags.deleted);
    expect(model.report.results).toEqual(flags.deleted ? [expect.objectContaining({
      code: "invalid_relationship_instance", rule_id: "RHT-31", relationship: kind, path: sourcePath,
    })] : []);
    for (const raw of ["[[stable]]", "[[Target]]", "[[alias-target]]", `[[/${targetPath}]]`, `[target](/${targetPath})`, "![[stable]]"]) {
      expect(resolveNoteLink(parseNoteLink(raw)!, sourcePath, model)).toEqual({ kind: "note", path: targetPath });
    }
    expect(query(root, { include_deleted: true, where: { kind: "relationship", relationship: kind } }))
      .toMatchObject({ evaluation: "complete", rows: flags.deleted ? [] : [{ path: sourcePath }] });
    expect(snapshot(root)).toEqual(before);
  });
}

for (const deleted of [false, true]) {
  test.each(["field", "body", "embed"] as const)(`a lone %s related_to reference counts only a non-deleted target (deleted=${deleted})`, (origin) => {
    const { root, sourcePath, sourceData } = fixture({ deleted: true }, { deleted }, "related_to");
    write(root, sourcePath, { ...sourceData, parent: origin === "field" ? "[[stable]]" : null },
      `# Source\n\n## Required\n\n${origin === "field" ? "" : origin === "embed" ? "![[stable]]" : "[[stable]]"}\n`);
    const before = snapshot(root);
    const report = validateCollection({ collectionRoot: root, schemaDirectory });
    expect(report).toMatchObject({ valid: !deleted, evaluation: "complete" });
    expect(report.results).toEqual(deleted ? [expect.objectContaining({ code: "invalid_relationship_instance",
      rule_id: "RHT-31", relationship: "related_to", path: sourcePath })] : []);
    expect(snapshot(root)).toEqual(before);
  });
}

test.each(states)("$name notes keep collection-wide identifier uniqueness", ({ flags }) => {
  const { root, sourcePath, sourceData } = fixture(flags);
  // A path-form reference avoids making a duplicate identifier an ambiguous link.
  write(root, sourcePath, { ...sourceData, id: "stable", parent: "[[/Notes/Target.md]]" }, "# Source\n\n## Required\n");
  const before = snapshot(root);
  const report = validateCollection({ collectionRoot: root, schemaDirectory });
  expect(report).toMatchObject({ valid: false, evaluation: "complete" });
  expect(report.results).toEqual([expect.objectContaining({ code: "duplicate_unique_value", rule_id: "MN-48", field: "id" })]);
  expect(snapshot(root)).toEqual(before);
});

test("lifecycle-looking fields do not make an untyped note managed", () => {
  const { root } = fixture();
  write(root, "Untyped.md", { deleted: true, archived: true, id: "stable", score: "bad" }, "# Ordinary prose\n");
  const before = snapshot(root);
  const model = readCollectionModel({ collectionRoot: root, schemaDirectory });
  expect(model.report).toMatchObject({ valid: true, evaluation: "complete", results: [] });
  expect(model.documents.some((note) => note.path === "Untyped.md")).toBe(true);
  expect(model.notes.some((note) => note.path === "Untyped.md")).toBe(false);
  expect(queryCollection({ collectionRoot: root, schemaDirectory, queryVersion: "0.1.0",
    query: { specification_version: "0.1.0", include_deleted: true, select: [{ kind: "path", as: "path" }] } }).rows)
    .toEqual([{ path: "Notes/Source.md" }, { path: "Notes/Target.md" }]);
  expect(snapshot(root)).toEqual(before);
});
