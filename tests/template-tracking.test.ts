import { afterEach, expect, test } from "bun:test";
import { dirname, join, resolve } from "node:path";
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { stringify } from "yaml";
import { validateCollection } from "../src/validator";
import { regionDigest } from "../src/template-drift";

const schemaDirectory = resolve(import.meta.dir, "../../TypedMarkSpecification/schema/json-schema");
const roots: string[] = [];
const version = { specification_version: "0.1.0", description: "Tracking." };
const extensions = { "typedmark:template-tracking": "0.1.0" };
function write(root: string, path: string, data: unknown, body = "") {
  mkdirSync(dirname(join(root, path)), { recursive: true });
  writeFileSync(join(root, path), `---\n${stringify(data)}---\n${body}`);
}
const region = (content: string, id = "guidance") => `<!-- typedmark:template-region ${JSON.stringify({ id })} -->\n${content}${content ? "\n" : ""}<!-- /typedmark:template-region -->\n`;
function collection(template = "Baseline", note = "Baseline", receipts: unknown = { guidance: { baseline: regionDigest("Baseline") } }) {
  const root = mkdtempSync(join(tmpdir(), "typedmark-tracking-")); roots.push(root);
  write(root, "typedmark.md", { ...version, name: "tracking", extensions });
  write(root, ".typedmark/schemas/note.md", { ...version, storage: { folder_pattern: "", note_name_pattern: "{title}" } });
  write(root, ".typedmark/templates/note.md", {}, region(template));
  write(root, "A.md", { note_type: "note", template_regions: receipts }, region(note));
  return root;
}
const run = (collectionRoot: string, supportedExtensions?: Record<string, string>) => validateCollection({ collectionRoot, schemaDirectory, supportedExtensions });
afterEach(() => { for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true }); });

test("current regions and stale-but-agreed baselines validate without writes", () => {
  const root = collection("Agreed", "Agreed"); const before = readFileSync(join(root, "A.md"));
  expect(run(root)).toMatchObject({ valid: true, evaluation: "complete", results: [] });
  expect(readFileSync(join(root, "A.md"))).toEqual(before);
});

test.each([
  ["Updated", "Baseline", "template_changed"], ["Baseline", "Edited", "note_changed"], ["Updated", "Edited", "both_changed"],
])("classifies template=%j note=%j as %s", (template, note, drift_kind) => {
  expect(run(collection(template, note)).results).toContainEqual(expect.objectContaining({ code: "template_drift", severity: "warn", template_region: "guidance", drift_kind, path: "A.md" }));
});

test.each(["template_added", "region_missing", "template_removed", "template_removed_note_changed", "retired", "detached"])("classifies %s receipt/marker membership", (state) => {
  const root = collection();
  if (["template_removed", "template_removed_note_changed", "retired"].includes(state)) write(root, ".typedmark/templates/note.md", {}, "Unmarked prose");
  const body = state === "template_removed" ? region("Baseline") : state === "template_removed_note_changed" ? region("Edited") : "No tracked body";
  const receipts = state === "template_added" ? {} : state === "detached" ? { guidance: { detached: true } } : { guidance: { baseline: regionDigest("Baseline") } };
  write(root, "A.md", { note_type: "note", template_regions: receipts }, body);
  const results = run(root).results;
  if (["retired", "detached"].includes(state)) expect(results).toEqual([]);
  else expect(results).toContainEqual(expect.objectContaining({ code: "template_drift", drift_kind: state, template_region: "guidance" }));
});

test("unenrolled notes do not drift and note-owned content is ignored", () => {
  const root = collection();
  write(root, "A.md", { note_type: "note" }, "Independent prose");
  expect(run(root).results).toEqual([]);
  write(root, "A.md", { note_type: "note", template_regions: { guidance: { baseline: regionDigest("Baseline") } } }, "Before\n" + region("Baseline") + "After\n");
  expect(run(root).results).toEqual([]);
});

test.each([null, { guidance: { baseline: "bad" } }, { guidance: { detached: false } }, { guidance: { baseline: regionDigest("Baseline"), detached: true } }])("invalid receipts suppress drift for invalid state: %j", (receipts) => {
  const report = run(collection("Changed", "Edited", receipts));
  expect(report.results).toContainEqual(expect.objectContaining({ code: "invalid_template_region" }));
  expect(report.results.some((item) => item.code === "template_drift")).toBe(false);
});

test("markers need same-identifier baselines and cannot accompany detached receipts", () => {
  for (const receipts of [{}, { guidance: { detached: true } }]) {
    const report = run(collection("Baseline", "Baseline", receipts));
    expect(report.results).toContainEqual(expect.objectContaining({ code: "invalid_template_region", template_region: "guidance" }));
    expect(report.results.some((item) => item.code === "template_drift")).toBe(false);
  }
});

test("tracking requires declarations and does not interpret disabled receipts", () => {
  const root = collection();
  write(root, "typedmark.md", { ...version, name: "tracking" });
  expect(run(root).results).toContainEqual(expect.objectContaining({ code: "invalid_extension_declaration", extension: "typedmark:template-tracking" }));
  write(root, "typedmark.md", { ...version, name: "tracking", extensions });
  write(root, "A.md", { note_type: "note", template_regions: "future syntax" });
  const report = run(root, {});
  expect(report.evaluation).toBe("incomplete");
  expect(report.results.some((item) => ["invalid_template_region", "unknown_field"].includes(item.code))).toBe(false);
});

test("untyped notes and template frontmatter cannot carry tracking receipts", () => {
  const root = collection(); write(root, "Untyped.md", { template_regions: {} });
  write(root, ".typedmark/templates/note.md", { template_regions: {} }, region("Baseline"));
  const results = run(root).results;
  expect(results).toContainEqual(expect.objectContaining({ code: "invalid_template_region", path: "Untyped.md" }));
  expect(results).toContainEqual(expect.objectContaining({ code: "invalid_template_region", path: ".typedmark/templates/note.md", rule_id: "MN-293" }));
});

test("static regions cannot contain expansions or be inside expansions", () => {
  const root = collection();
  write(root, "typedmark.md", { ...version, name: "tracking", extensions: { ...extensions, "typedmark:expansion": "0.1.0", "typedmark:expressions": "0.1.0" } });
  const start = '<!-- typedmark:expansion {"id":"once","mode":"once","state":"materialized","source":{"kind":"file","value":"stem"},"render":{"item":"${value}"}} -->';
  const end = "<!-- /typedmark:expansion -->";
  for (const body of [region(`${start}\nA\n${end}`), `${start}\n${region("Baseline")}${end}\n`]) {
    write(root, "A.md", { note_type: "note", template_regions: { guidance: { baseline: regionDigest("Baseline") } } }, body);
    const report = run(root);
    expect(report.results).toContainEqual(expect.objectContaining({ code: "invalid_template_region" }));
    expect(report.results.some((item) => item.code === "template_drift")).toBe(false);
  }
});

test("marker-shaped code is inert and template frontmatter does not affect drift", () => {
  const root = collection();
  write(root, ".typedmark/templates/note.md", { title: "Different starter" }, "```md\n" + region("Inert", "code") + "```\n" + region("Baseline"));
  expect(run(root).results).toEqual([]);
});

test("an invalid receipt does not hide drift for another structurally valid identifier", () => {
  const root = collection();
  write(root, ".typedmark/templates/note.md", {}, region("Updated") + region("Other", "other"));
  write(root, "A.md", { note_type: "note", template_regions: { guidance: { baseline: regionDigest("Baseline") }, other: { baseline: "bad" } } }, region("Baseline") + region("Other", "other"));
  const results = run(root).results;
  expect(results).toContainEqual(expect.objectContaining({ code: "invalid_template_region", template_region: "other" }));
  expect(results).toContainEqual(expect.objectContaining({ code: "template_drift", template_region: "guidance", drift_kind: "template_changed" }));
});

test("unavailable schema versions and missing explicit templates never become removal drift", () => {
  const root = collection();
  write(root, ".typedmark/schemas/note.md", { ...version, specification_version: "0.2.0", future_key: true });
  const unsupported = run(root);
  expect(unsupported.evaluation).toBe("incomplete");
  expect(unsupported.evaluated_extensions).not.toHaveProperty("typedmark:template-tracking");
  expect(unsupported.results.some((item) => item.code === "template_drift")).toBe(false);
  write(root, ".typedmark/schemas/note.md", { ...version, storage: { folder_pattern: "", note_name_pattern: "{title}" }, template: { file: "missing.md" } });
  expect(run(root).results.some((item) => item.code === "template_drift")).toBe(false);
});

test("future compatible receipt metadata warns without invalidating a known baseline", () => {
  const root = collection("Baseline", "Baseline", { guidance: { baseline: regionDigest("Baseline"), future: true } });
  write(root, ".typedmark/schemas/note.md", { ...version, specification_version: "0.1.1", storage: { folder_pattern: "", note_name_pattern: "{title}" } });
  const report = run(root);
  expect(report.evaluation).toBe("incomplete");
  expect(report.results).toContainEqual(expect.objectContaining({ code: "unknown_field", severity: "warn", rule_id: "FND-11" }));
  expect(report.results.some((item) => ["invalid_template_region", "template_drift"].includes(item.code))).toBe(false);
});

test("suppressing diagnostics does not turn structurally invalid states into drift", () => {
  const root = collection("Updated", "Edited", { guidance: { baseline: "bad" } });
  write(root, "typedmark.md", { ...version, name: "tracking", extensions, validation_defaults: { invalid_template_region: "off" } });
  expect(run(root).results).toEqual([]);
});

test.each(["note", "template"])("an invalid %s descriptor does not hide another identifier's drift", (owner) => {
  const root = collection();
  const invalid = '<!-- typedmark:template-region {"id":"other","extra":true} -->\nOther\n<!-- /typedmark:template-region -->\n';
  write(root, ".typedmark/templates/note.md", {}, region("Updated") + (owner === "template" ? invalid : region("Other", "other")));
  write(root, "A.md", { note_type: "note", template_regions: { guidance: { baseline: regionDigest("Baseline") }, other: { baseline: regionDigest("Other") } } }, region("Baseline") + (owner === "note" ? invalid : region("Other", "other")));
  const results = run(root).results;
  expect(results).toContainEqual(expect.objectContaining({ code: "invalid_template_region", template_region: "other" }));
  expect(results).toContainEqual(expect.objectContaining({ code: "template_drift", template_region: "guidance", drift_kind: "template_changed" }));
  expect(results.some((result) => result.code === "template_drift" && result.template_region === "other")).toBe(false);
});

test("suppressed canonical parse errors cannot masquerade as template removal", () => {
  const root = collection();
  write(root, "typedmark.md", { ...version, name: "tracking", extensions, validation_defaults: { invalid_template: "off" } });
  writeFileSync(join(root, ".typedmark/templates/note.md"), "---\nbad: [\n---\n");
  const results = run(root).results;
  expect(results.some((result) => result.code === "template_drift")).toBe(false);
  expect(results).toEqual([]);
});

test("identified malformed closing markers do not hide unrelated drift", () => {
  const root = collection();
  write(root, ".typedmark/templates/note.md", {}, region("Updated") + region("Other", "other"));
  write(root, "A.md", { note_type: "note", template_regions: { guidance: { baseline: regionDigest("Baseline") }, other: { baseline: regionDigest("Other") } } }, region("Baseline") + region("Other", "other").replace("<!-- /typedmark:template-region -->", "<!-- /typedmark:template-region --> trailing"));
  expect(run(root).results).toContainEqual(expect.objectContaining({ code: "template_drift", template_region: "guidance", drift_kind: "template_changed" }));
});
