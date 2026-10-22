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

test("validates list-item actions against the list's item definition", () => {
  const listed = { ...model, schemas: new Map([["note", { ...model.schemas.get("note"), frontmatter: {
    ...(model.schemas.get("note") as { frontmatter: object }).frontmatter,
    watchers: { type: "list", items: { type: "text", allowed_values: ["ana", "bo"] } },
    pinned: { type: "list", items: { type: "text" }, const_value: [] },
  } }]]) } as unknown as CollectionModel;
  for (const kind of ["add_list_item", "remove_list_item"]) {
    expect(validateAutomationRule({ ...rule, actions: [{ kind, field: "watchers", value: "ana" }] }, listed)).toEqual([]);
    expect(validateAutomationRule({ ...rule, actions: [{ kind, field: "watchers", value: "zed" }] }, listed)).toMatchObject([{ rule: "CM-278", field: "watchers" }]);
    expect(validateAutomationRule({ ...rule, actions: [{ kind, field: "watchers", value: ["ana"] }] }, listed)).toMatchObject([{ rule: "CM-278" }]);
    for (const field of ["status", "pinned", "missing"]) {
      expect(validateAutomationRule({ ...rule, actions: [{ kind, field, value: "ana" }] }, listed)).toMatchObject([{ rule: "CM-278", field }]);
    }
  }
  expect(validateAutomationRule({ ...rule, actions: [{ kind: "set_field", field: "status", value: "done", only_if_empty: true }] }, listed)).toEqual([]);
});

test("older_than predicates need a temporal field (CM-557)", () => {
  const dated = { ...model, schemas: new Map([["note", { ...model.schemas.get("note"), frontmatter: {
    ...(model.schemas.get("note") as { frontmatter: object }).frontmatter, completed_on: { type: "date", nullable: true }, finished_at: { type: "datetime", nullable: true },
  } }]]) } as unknown as CollectionModel;
  const archive = (when: object) => ({ trigger: { kind: "schedule", schedule: { cadence: "daily", at: "02:00" } }, scope: { note_types: ["note"] }, when, actions: [{ kind: "archive_note" }] });
  expect(validateAutomationRule(archive({ status: { equals: "done" }, completed_on: { older_than: "P30D" } }), dated)).toEqual([]);
  expect(validateAutomationRule(archive({ finished_at: { older_than: "P1Y" } }), dated)).toEqual([]);
  expect(validateAutomationRule(archive({ status: { older_than: "P30D" } }), dated)).toMatchObject([{ rule: "CM-557", field: "status" }]);
});

test("state predicates need a field declaring states (CM-560, CM-562)", () => {
  const stated = { ...model, schemas: new Map([["note", { ...model.schemas.get("note"), frontmatter: {
    ...(model.schemas.get("note") as { frontmatter: object }).frontmatter,
    lifecycle: { type: "text", allowed_values: ["open", "closed"], states: { closed: { done: true, outcome: "success" } } },
  } }]]) } as unknown as CollectionModel;
  const updated = (extra: object) => ({ ...rule, ...extra, actions: [{ kind: "add_tag", tag: "state/done" }] });
  expect(validateAutomationRule(updated({ when: { lifecycle: { state: { done: true } } } }), stated)).toEqual([]);
  expect(validateAutomationRule(updated({ trigger: { ...rule.trigger, changed: { lifecycle: { to_state: { done: true } } } } }), stated)).toEqual([]);
  expect(validateAutomationRule(updated({ when: { status: { state: { done: true } } } }), stated)).toMatchObject([{ rule: "CM-560", field: "status" }]);
  expect(validateAutomationRule(updated({ trigger: { ...rule.trigger, changed: { status: { from_state: { role: "active" } } } } }), stated)).toMatchObject([{ rule: "CM-562", field: "status" }]);
});

test("value_from needs a field of the matching temporal type (CM-563)", () => {
  const dated = { ...model, schemas: new Map([["note", { ...model.schemas.get("note"), frontmatter: {
    ...(model.schemas.get("note") as { frontmatter: object }).frontmatter,
    completed_on: { type: "date", nullable: true }, completed_at: { type: "datetime", nullable: true },
  } }]]) } as unknown as CollectionModel;
  const stamp = (field: string, value_from: string) => ({ ...rule, actions: [{ kind: "set_field", field, value_from, only_if_empty: true }] });
  expect(validateAutomationRule(stamp("completed_on", "trigger_date"), dated)).toEqual([]);
  expect(validateAutomationRule(stamp("completed_at", "trigger_datetime"), dated)).toEqual([]);
  expect(validateAutomationRule(stamp("completed_at", "trigger_date"), dated)).toMatchObject([{ rule: "CM-563", field: "completed_at" }]);
  expect(validateAutomationRule(stamp("status", "trigger_datetime"), dated)).toMatchObject([{ rule: "CM-563", field: "status" }]);
  expect(validateAutomationRule(stamp("fixed", "trigger_date"), dated)).toMatchObject([{ rule: "CM-278", field: "fixed" }]);
});
