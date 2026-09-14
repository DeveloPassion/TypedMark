import { afterEach, expect, test } from "bun:test";
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { stringify } from "yaml";
import { validateCollection } from "../src/validator";
import { queryCollection } from "../src/query";

const schemaDirectory = resolve(import.meta.dir, "../../TypedMarkSpecification/schema/json-schema");
const roots: string[] = [];
const kinds = ["schema", "property-set"] as const;
type Kind = typeof kinds[number];

function collection(kind: Kind, version: unknown, unknownKeys = true) {
  const root = mkdtempSync(join(tmpdir(), "typedmark-artifact-versions-")); roots.push(root);
  const write = (path: string, data: unknown) => {
    mkdirSync(dirname(join(root, path)), { recursive: true });
    writeFileSync(join(root, path), `---\n${stringify(data)}---\n`);
  };
  write("typedmark.md", { specification_version: "0.1.0", name: "artifact-versions", description: "Version boundaries.",
    extensions: { "typedmark:reuse": "0.1.0" },
    validation_defaults: { unknown_field: "off", invalid_note_type_schema: "off", invalid_property_set: "off" } });
  const schema = { specification_version: "0.1.0", description: "Note.", storage: { folder_pattern: "", note_name_pattern: "{title}" } };
  const path = kind === "schema" ? ".typedmark/schemas/note.md" : ".typedmark/property-sets/shared.md";
  if (kind === "property-set") write(".typedmark/schemas/note.md", { ...schema, property_sets: ["shared"] });
  write(path, { ...(kind === "schema" ? schema : { description: "Shared fields.", property_set: "shared" }),
    specification_version: version, ...(unknownKeys ? { future_key: true } : {}),
    frontmatter: { value: { type: "text", nullable: true, ...(unknownKeys ? { future_nested: true } : {}) } } });
  write("Note.md", { note_type: "note" });
  return { root, path };
}

const run = (root: string) => validateCollection({ collectionRoot: root, schemaDirectory });
afterEach(() => { for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true }); });

for (const kind of kinds) {
  test.each([
    "0.1.bad", "0.1.00", "0.1.01", "0.1.0\n", "0.1.1+build", "0.1.1-rc.1",
    ["0.1.1"], { toString: 0, valueOf: 0 },
  ].map((version) => ({ version })))(`${kind} malformed version %j cannot enable best-effort warnings`, ({ version }) => {
    const { root, path } = collection(kind, version);
    const before = readFileSync(join(root, path));
    const report = run(root);
    expect(report.valid).toBe(false);
    expect(report.results.filter((finding) => finding.path === path && finding.code === "unknown_field"))
      .toEqual([expect.objectContaining({ severity: "error", rule_id: "CM-534" }), expect.objectContaining({ severity: "error", rule_id: "CM-534" })]);
    expect(report.results.some((finding) => finding.rule_id === "FND-11")).toBe(false);
    expect(readFileSync(join(root, path))).toEqual(before);
  });

  test(`${kind} implemented version keeps structural errors unsuppressible`, () => {
    const { root, path } = collection(kind, "0.1.0");
    expect(run(root)).toMatchObject({ valid: false, evaluation: "complete", results: [
      expect.objectContaining({ path, code: "unknown_field", severity: "error", rule_id: "CM-534" }),
      expect.objectContaining({ path, code: "unknown_field", severity: "error", rule_id: "CM-534" }),
    ] });
  });

  test.each(["0.1.1", "0.1.9007199254740993"])(`${kind} genuinely newer version %s stays incomplete with warnings`, (version) => {
    const { root, path } = collection(kind, version);
    expect(run(root)).toMatchObject({ valid: false, evaluation: "incomplete", results: [
      expect.objectContaining({ path, code: "unknown_field", severity: "warn", rule_id: "FND-11" }),
      expect.objectContaining({ path, code: "unknown_field", severity: "warn", rule_id: "FND-11" }),
    ] });
  });

  test.each(["0.2.0", "9.0.0"])(`${kind} unsupported version %s is not evaluated as a known shape`, (version) => {
    const { root, path } = collection(kind, version);
    const report = run(root);
    expect(report).toMatchObject({ valid: false, evaluation: "incomplete" });
    expect(report.results).toContainEqual(expect.objectContaining({ path, code: "unsupported_specification_version", rule_id: "FND-92" }));
    expect(report.results.some((finding) => finding.code === "unknown_field")).toBe(false);
  });

  test(`${kind} malformed version blocks querying even when its diagnostic is suppressed`, () => {
    const { root } = collection(kind, "0.1.bad", false);
    expect(() => queryCollection({ collectionRoot: root, schemaDirectory, queryVersion: "0.1.0",
      query: { specification_version: "0.1.0", note_types: ["note"], select: [{ kind: "path", as: "path" }] } })).toThrow("CM-308");
  });
}
