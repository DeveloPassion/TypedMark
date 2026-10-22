import { afterEach, expect, test } from "bun:test";
import { dirname, join, resolve } from "node:path";
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { stringify } from "yaml";
import { validateCollection } from "../src/validator";
import { getCapabilities } from "../src/adapter";

const schemaDirectory = resolve(import.meta.dir, "../../TypedMarkSpecification/schema/json-schema");
const roots: string[] = [];
const version = { specification_version: "0.1.0", description: "Automation." };
const extensions = { "typedmark:automation": "0.1.0" };
const rule = { ...version, automation: "rule", trigger: { kind: "event", event: "note.updated" }, scope: { note_types: ["note"] }, actions: [{ kind: "set_field", field: "status", value: "done" }] };
function write(root: string, path: string, data: unknown) {
  mkdirSync(dirname(join(root, path)), { recursive: true });
  writeFileSync(join(root, path), `---\n${stringify(data)}---\n`);
}
function collection() {
  const root = mkdtempSync(join(tmpdir(), "typedmark-automation-")); roots.push(root);
  write(root, "typedmark.md", { ...version, name: "automations", extensions });
  write(root, ".typedmark/schemas/note.md", { ...version, storage: { folder_pattern: "", note_name_pattern: "{title}" }, frontmatter: { status: { type: "text", allowed_values: ["open", "done"] } } });
  write(root, "A.md", { note_type: "note", status: "open" });
  write(root, ".typedmark/automations/rule.md", rule);
  return root;
}
const run = (collectionRoot: string, supportedExtensions?: Record<string, string>) => validateCollection({ collectionRoot, schemaDirectory, supportedExtensions });
afterEach(() => { for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true }); });

test("validates automation artifacts without executing even destructive actions", () => {
  const root = collection();
  write(root, ".typedmark/automations/rule.md", { ...rule, actions: [...rule.actions, { kind: "hard_delete_note" }] });
  const before = readFileSync(join(root, "A.md"));
  expect(run(root)).toMatchObject({ evaluation: "complete", valid: true, results: [], evaluated_extensions: extensions });
  expect(readFileSync(join(root, "A.md"))).toEqual(before);
  expect(Object.keys(getCapabilities().operations).some((key) => key.includes("automation"))).toBe(false);
});

test.each([
  [{ scope: { note_types: ["missing"] } }, "CM-253"],
  [{ actions: [{ kind: "set_field", field: "missing", value: true }] }, "CM-278"],
  [{ actions: [{ kind: "set_field", field: "status", value: 123 }] }, "CM-278"],
  [{ actions: [{ kind: "create_note", note_type: "missing" }] }, "CM-274"],
  [{ when: { status: { regex: "[" } } }, "FND-31"],
])("reports invalid artifact references and action contracts: %j", (overrides, expectedRule) => {
  const root = collection(); write(root, ".typedmark/automations/rule.md", { ...rule, ...overrides });
  expect(run(root).results).toContainEqual(expect.objectContaining({ code: "invalid_automation", rule_id: expectedRule, path: ".typedmark/automations/rule.md" }));
});

test("validates targetless schedules without needing any clock input", () => {
  const root = collection(); write(root, ".typedmark/automations/rule.md", { ...version, automation: "rule", trigger: { kind: "schedule", schedule: { cadence: "monthly", day: 31, at: "02:30" } }, actions: [{ kind: "create_note", note_type: "note", values: { status: "open", title: "New" } }] });
  expect(run(root)).toMatchObject({ valid: true, results: [] });
});

test("undeclared artifact/default uses and explicitly disabled evaluation remain distinct", () => {
  const root = collection(); write(root, "typedmark.md", { ...version, name: "automations", automation_defaults: {} });
  const missing = run(root);
  expect(missing.results).toContainEqual(expect.objectContaining({ code: "invalid_extension_declaration", extension: "typedmark:automation", path: "typedmark.md" }));
  write(root, "typedmark.md", { ...version, name: "automations", extensions, automation_defaults: "future syntax" });
  write(root, ".typedmark/automations/rule.md", { future: "syntax" });
  expect(run(root, {})).toMatchObject({ evaluation: "incomplete", valid: false });
  expect(run(root, {}).results.some((item) => ["invalid_automation", "invalid_collection_configuration"].includes(item.code))).toBe(false);
});

test("unavailable model dependencies do not turn automation artifacts into invalid data", () => {
  const root = collection();
  write(root, ".typedmark/schemas/note.md", { ...version, specification_version: "0.2.0", future_key: true });
  const report = run(root);
  expect(report.evaluation).toBe("incomplete");
  expect(report.evaluated_extensions).not.toHaveProperty("typedmark:automation");
  expect(report.results.some((item) => item.code === "invalid_automation")).toBe(false);
});

test("unknown and missing artifact shape fields produce the right categories", () => {
  const root = collection(); write(root, ".typedmark/automations/rule.md", { ...rule, unknown_key: true });
  expect(run(root).results).toContainEqual(expect.objectContaining({ code: "unknown_field", severity: "error", rule_id: "CM-534" }));
  write(root, ".typedmark/automations/rule.md", { ...rule, actions: undefined });
  expect(run(root).results).toContainEqual(expect.objectContaining({ code: "invalid_automation", rule_id: "CM-243" }));
});

test.each(["0.1.0", "0.1.1"])("nested unknown automation keys use %s reporting policy", (specification_version) => {
  const root = collection();
  write(root, ".typedmark/automations/rule.md", { ...rule, specification_version, trigger: { ...rule.trigger, future_key: true }, actions: [{ ...rule.actions[0], future_key: true }] });
  const report = run(root);
  expect(report.results).toContainEqual(expect.objectContaining({ code: "unknown_field", severity: specification_version === "0.1.0" ? "error" : "warn", rule_id: specification_version === "0.1.0" ? "CM-534" : "FND-11" }));
  expect(report.results.some((finding) => finding.code === "invalid_automation")).toBe(false);
  if (specification_version === "0.1.1") expect(report.evaluation).toBe("incomplete");
});

test("list-item actions and only_if_empty are accepted artifact shapes", () => {
  const root = collection();
  write(root, ".typedmark/schemas/note.md", { ...version, storage: { folder_pattern: "", note_name_pattern: "{title}" }, frontmatter: {
    status: { type: "text", allowed_values: ["open", "done"] }, watchers: { type: "list", items: { type: "text" }, default_value: [] },
  } });
  write(root, ".typedmark/automations/rule.md", { ...rule, actions: [
    { kind: "set_field", field: "status", value: "done", only_if_empty: true },
    { kind: "add_list_item", field: "watchers", value: "ana" }, { kind: "remove_list_item", field: "watchers", value: "bo" },
  ] });
  expect(run(root).results).toEqual([]);
  write(root, ".typedmark/automations/rule.md", { ...rule, actions: [{ kind: "add_list_item", field: "watchers" }, { kind: "set_field", field: "status", value: "done", only_if_empty: "yes" }] });
  expect(run(root).results.map((result) => result.code)).toEqual(["invalid_automation"]);
});

test("older_than is an accepted automation predicate shape but not a mapping predicate", () => {
  const root = collection();
  write(root, ".typedmark/schemas/note.md", { ...version, storage: { folder_pattern: "", note_name_pattern: "{title}" }, frontmatter: {
    status: { type: "text", allowed_values: ["open", "done"] }, completed_on: { type: "date", nullable: true, default_value: null },
  } });
  write(root, ".typedmark/automations/rule.md", { ...rule, trigger: { kind: "schedule", schedule: { cadence: "daily", at: "02:00" } }, when: { completed_on: { older_than: "P30D" } }, actions: [{ kind: "archive_note" }] });
  expect(run(root).results).toEqual([]);
  write(root, ".typedmark/automations/rule.md", { ...rule, when: { completed_on: { older_than: "P1M15D" } } });
  expect(run(root).results.map((result) => result.code)).toEqual(["invalid_automation"]);
  write(root, ".typedmark/automations/rule.md", rule);
  write(root, "typedmark.md", { ...version, name: "automations", extensions, note_type_mappings: [{ kind: "fixed", when: { frontmatter: { completed_on: { older_than: "P30D" } } }, note_type: "note" }] });
  expect(run(root).results).toContainEqual(expect.objectContaining({ code: "invalid_collection_configuration" }));
  write(root, "typedmark.md", { ...version, name: "automations", extensions, note_type_mappings: [{ kind: "fixed", when: { frontmatter: { completed_on: { exists: true } } }, note_type: "note" }] });
  expect(run(root).results.filter((result) => result.path === "typedmark.md")).toEqual([]);
});

test("state predicates and state change predicates are accepted automation shapes", () => {
  const root = collection();
  write(root, ".typedmark/schemas/note.md", { ...version, storage: { folder_pattern: "", note_name_pattern: "{title}" }, frontmatter: {
    status: { type: "text", allowed_values: ["open", "done"], states: { done: { done: true, outcome: "success" }, open: { role: "active" } } },
  } });
  write(root, ".typedmark/automations/rule.md", { ...rule, trigger: { ...rule.trigger, changed: { status: { to_state: { done: true } } } }, when: { status: { state: { outcome: "success" } } }, actions: [{ kind: "archive_note" }] });
  expect(run(root).results).toEqual([]);
  write(root, ".typedmark/automations/rule.md", { ...rule, when: { status: { state: { finished: true } } } });
  expect(run(root).results.map((result) => result.code)).toEqual(["invalid_automation"]);
});
