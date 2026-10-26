import { expect, test } from "bun:test";
import { validateAutomationRule } from "../src/automation-rules";
import type { CollectionModel } from "../src/collection-model";

const model = {
  config: {},
  schemas: new Map([
    [
      "item",
      {
        specification_version: "0.1.0",
        storage: { folder_pattern: "Items" },
        frontmatter: {
          copies: { type: "integer", nullable: true },
          lent_to: { type: "text", nullable: true },
          lent_on: { type: "date", nullable: true },
          acquired_on: { type: "date", nullable: true, immutable: true },
          rating: { type: "integer", default_value: 3 },
          code: { type: "text" },
          ownership: { type: "list", items: { type: "text" } },
        },
      },
    ],
  ]),
  report: { evaluated_extensions: { "typedmark:authoring": "0.1.0" } },
} as unknown as CollectionModel;
const rule = {
  trigger: { kind: "event", event: "note.updated" },
  scope: { note_types: ["item"] },
  actions: [{ kind: "unset_field", field: "lent_on" }],
};

test("unset_field targets assignable fields with a conforming absence fallback (MN-318, MN-320)", () => {
  expect(validateAutomationRule(rule, model)).toEqual([]);
  for (const field of ["rating", "title", "tags"]) expect(validateAutomationRule({ ...rule, actions: [{ kind: "unset_field", field }] }, model)).toEqual([]);
  for (const field of ["acquired_on", "missing", "id", "note_type", "code"])
    expect(validateAutomationRule({ ...rule, actions: [{ kind: "unset_field", field }] }, model)).toMatchObject([{ rule: "CM-278", field }]);
});

test("empty predicates apply to any field (CM-565)", () => {
  expect(validateAutomationRule({ ...rule, when: { lent_to: { empty: true }, ownership: { empty: false } } }, model)).toEqual([]);
});

test("ordering predicates need an orderable field and a valid operand (CM-566)", () => {
  expect(validateAutomationRule({ ...rule, when: { copies: { greater_than: 1, less_than_or_equal: 10 } } }, model)).toEqual([]);
  expect(validateAutomationRule({ ...rule, when: { lent_on: { less_than: "2026-01-01" } } }, model)).toEqual([]);
  expect(validateAutomationRule({ ...rule, when: { ownership: { greater_than: "owned" } } }, model)).toMatchObject([{ rule: "CM-566", field: "ownership" }]);
  expect(validateAutomationRule({ ...rule, when: { copies: { greater_than: "1" } } }, model)).toMatchObject([{ rule: "CM-566", field: "copies" }]);
});
