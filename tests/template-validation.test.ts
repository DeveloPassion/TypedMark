import { afterEach, expect, test } from "bun:test";
import { mkdirSync, mkdtempSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { stringify } from "yaml";
import { validateCollection } from "../src/validator";
import { regionDigest } from "../src/template-drift";

const schemaDirectory = resolve(import.meta.dir, "../../TypedMarkSpecification/schema/json-schema");
const roots: string[] = [];
function write(root: string, path: string, data: unknown, body = "") {
  mkdirSync(dirname(join(root, path)), { recursive: true });
  writeFileSync(join(root, path), `---\n${stringify(data)}---\n${body}`);
}
function fixture(config = {}, schema = {}) {
  const root = mkdtempSync(join(tmpdir(), "typedmark-template-validation-")); roots.push(root);
  write(root, "typedmark.md", { specification_version: "0.1.0", name: "template-checks", description: "Template validation.",
    version: "1.0.0", scaffold: {}, extensions: { "typedmark:systems": "0.1.0" }, ...config });
  write(root, ".typedmark/schemas/note.md", { specification_version: "0.1.0", description: "Note.",
    storage: { folder_pattern: "", note_name_pattern: "{title}" }, ...schema });
  return root;
}
const run = (root: string) => validateCollection({ collectionRoot: root, schemaDirectory, mode: "system_definition" });
afterEach(() => { for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true }); });

test("concrete template values are checked against their effective field contracts", () => {
  const root = fixture({}, { frontmatter: { amount: { type: "integer" } } });
  write(root, ".typedmark/templates/note.md", { amount: "bad" });
  expect(run(root).results).toContainEqual(expect.objectContaining({ code: "invalid_template", rule_id: "RHT-80", field: "amount" }));
});

test("scaffold values cannot hide an invalid explicit override template", () => {
  const root = fixture({ scaffold: { notes: [{ path: "New.md", note_type: "note", from_template: "override.md", values: { status: "open" } }] } },
    { frontmatter: { status: { type: "text", allowed_values: ["open"] } } });
  write(root, ".typedmark/templates/override.md", { status: "bad" });
  expect(run(root).results).toContainEqual(expect.objectContaining({ code: "invalid_template", path: ".typedmark/templates/override.md", rule_id: "RHT-80" }));
});

test("nested unknown template fields are not hidden by a known object field", () => {
  const root = fixture({}, { frontmatter: { details: { type: "object", fields: {} } } });
  write(root, ".typedmark/templates/note.md", { details: { extra: true } });
  expect(run(root).results).toContainEqual(expect.objectContaining({ code: "invalid_template", rule_id: "RHT-76", field: "details.extra" }));
});

test("a scaffold override is inspected without replacing the canonical drift baseline", () => {
  const root = fixture({ extensions: { "typedmark:systems": "0.1.0", "typedmark:template-tracking": "0.1.0" },
    scaffold: { notes: [{ path: "New.md", note_type: "note", from_template: "override.md" }] } });
  const region = (text: string) => `<!-- typedmark:template-region {"id":"body"} -->\n${text}\n<!-- /typedmark:template-region -->\n`;
  write(root, ".typedmark/templates/note.md", {}, region("Canonical"));
  write(root, ".typedmark/templates/override.md", {}, region("Override") + '<!-- typedmark:template-region {"id":"bad","extra":true} -->\n<!-- /typedmark:template-region -->\n');
  write(root, "A.md", { note_type: "note", template_regions: { body: { baseline: regionDigest("Canonical") } } }, region("Canonical"));
  const report = run(root);
  expect(report.results.some((finding) => finding.code === "template_drift")).toBe(false);
  expect(report.results).toContainEqual(expect.objectContaining({ code: "invalid_template_region", path: ".typedmark/templates/override.md" }));
});

test("a skipped template-directory link cannot masquerade as a missing conventional template", () => {
  const root = fixture(), outside = mkdtempSync(join(tmpdir(), "typedmark-template-outside-")); roots.push(outside);
  writeFileSync(join(outside, "note.md"), "Outside content");
  symlinkSync(outside, join(root, ".typedmark/templates"), "junction");
  expect(run(root).results).toContainEqual(expect.objectContaining({ code: "invalid_template", rule_id: "RHT-73" }));
});
