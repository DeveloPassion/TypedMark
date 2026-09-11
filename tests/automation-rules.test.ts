import { expect, test } from "bun:test";
import { validateAutomationRule } from "../src/automation-rules";
import type { CollectionModel } from "../src/collection-model";

const model = {
  config: {}, schemas: new Map([["note", { specification_version: "0.1.0", storage: { folder_pattern: "Notes", note_name_pattern: "{title}" }, mandatory_tags: ["required"], frontmatter: { status: { type: "text", allowed_values: ["open", "done"] }, fixed: { type: "text", const_value: "fixed" }, computed: { type: "text", computed: "literal" } } }]]),
  report: { evaluated_extensions: { "typedmark:expressions": "0.1.0" } },
} as unknown as CollectionModel;
const rule = { trigger: { kind: "event", event: "note.updated" }, scope: { note_types: ["note"] }, actions: [{ kind: "set_field", field: "status", value: "done" }] };

test("validates action compatibility against effective schema contracts", () => {
  expect(validateAutomationRule(rule, model)).toEqual([]);
  for (const field of ["missing", "fixed", "computed", "id", "note_type"]) expect(validateAutomationRule({ ...rule, actions: [{ kind: "set_field", field, value: "value" }] }, model)).not.toEqual([]);
  expect(validateAutomationRule({ ...rule, actions: [{ kind: "set_field", field: "status", value: "invalid" }] }, model)).not.toEqual([]);
});

test("checks scope and creation references even when there are no notes", () => {
  expect(validateAutomationRule({ ...rule, scope: { note_types: ["missing"] } }, model)).toMatchObject([{ rule: "CM-253" }]);
  expect(validateAutomationRule({ ...rule, actions: [{ kind: "create_note", note_type: "missing" }] }, model)).toMatchObject([{ rule: "CM-274" }]);
  expect(validateAutomationRule({ ...rule, actions: [{ kind: "create_note", note_type: "note", values: { missing: true } }] }, model)).not.toEqual([]);
});

test("rejects invalid predicate regexes and unresolvable fields", () => {
  expect(validateAutomationRule({ ...rule, when: { status: { regex: "[" } } }, model)).toMatchObject([{ rule: "FND-31" }]);
  expect(validateAutomationRule({ ...rule, trigger: { ...rule.trigger, changed: { missing: { to: 1 } } } }, model)).not.toEqual([]);
});

test("preserves mandatory tags and reserved path boundaries", () => {
  expect(validateAutomationRule({ ...rule, actions: [{ kind: "remove_tag", tag: "required" }] }, model)).not.toEqual([]);
  expect(validateAutomationRule({ ...rule, actions: [{ kind: "move_note", path: "typedmark.md" }] }, model)).not.toEqual([]);
  expect(validateAutomationRule({ ...rule, actions: [{ kind: "move_note", path: ".typedmark/Hidden.md" }] }, model)).not.toEqual([]);
  expect(validateAutomationRule({ ...rule, actions: [{ kind: "move_note", path: "Elsewhere/A.md" }] }, model)).not.toEqual([]);
  expect(validateAutomationRule({ ...rule, actions: [{ kind: "move_note", path: "Notes/A.md" }] }, model)).toEqual([]);
  expect(validateAutomationRule({ ...rule, actions: [{ kind: "move_note", path: "Notes/.hidden.md" }] }, model)).not.toEqual([]);
  const dated = { ...model, schemas: new Map([["note", { ...model.schemas.get("note"), storage: { folder_pattern: "Notes", note_name_pattern: "{created_at:YYYY}" } }]]) };
  expect(validateAutomationRule({ ...rule, actions: [{ kind: "move_note", path: "Notes/not-a-year.md" }] }, dated)).not.toEqual([]);
  expect(validateAutomationRule({ ...rule, actions: [{ kind: "move_note", path: "Notes/2026.md" }] }, dated)).toEqual([]);
  const excluded = { ...model, schemas: new Map([["note", { ...model.schemas.get("note"), storage: { folder_pattern: ".git", note_name_pattern: "{title}" } }]]) };
  expect(validateAutomationRule({ ...rule, actions: [{ kind: "move_note", path: ".git/A.md" }] }, excluded)).not.toEqual([]);
  for (const control of ["\u007f", "\u0085"]) expect(validateAutomationRule({ ...rule, actions: [{ kind: "move_note", path: `Notes/A${control}.md` }] }, model)).not.toEqual([]);
  const unicode = { ...model, schemas: new Map([["note", { ...model.schemas.get("note"), storage: { folder_pattern: "Notes", note_name_pattern: "Cafe\u0301" } }]]) };
  expect(validateAutomationRule({ ...rule, actions: [{ kind: "move_note", path: "Notes/Café.md" }] }, unicode)).toEqual([]);
  const boundary = { ...model, schemas: new Map([["note", { ...model.schemas.get("note"), storage: { folder_pattern: "Notes", note_name_pattern: "Cafe{title}" } }]]) };
  expect(validateAutomationRule({ ...rule, actions: [{ kind: "move_note", path: "Notes/Café.md" }] }, boundary)).toEqual([]);
});
