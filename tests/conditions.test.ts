import { expect, test } from "bun:test";
import { conditionFailures, validateConditions } from "../src/conditions";

const fields = { status: { type: "text" }, reason: { type: "text", nullable: true }, tags: { type: "tags" } };
const required = { when: { status: { equals: "archived" } }, then: { require: ["reason"] } };

test("conditions compare effective values but test stored presence", () => {
  expect(conditionFailures([required], {}, { status: "archived", reason: null })).toMatchObject([{ code: "missing_required_field", field: "reason" }]);
  const absent = { when: { status: { exists: false, equals: "archived" } }, then: { require: ["reason"] } };
  expect(conditionFailures([absent], {}, { status: "archived", reason: "ok" })).toEqual([]);
  expect(conditionFailures([absent], { status: null }, { status: null, reason: null })).toEqual([]);
});

test("all matching conditions apply and opposing requirements are diagnosed", () => {
  const empty = { when: { status: { equals: "archived" } }, then: { require_null: ["reason"] } };
  expect(conditionFailures([required, empty], {}, { status: "archived", reason: "ok" })).toMatchObject([
    { rule: "NTS-90", code: "invalid_field_value", field: "reason" },
    { rule: "NTS-92", code: "invalid_field_value", field: "reason" },
  ]);
});

test("condition equality preserves parsed YAML types and ignores mapping key order", () => {
  const rule = { when: { payload: { equals: { a: 1, b: "é" } } }, then: { require: ["reason"] } };
  expect(conditionFailures([rule], {}, { payload: { b: "e\u0301", a: 1 }, reason: null })).toHaveLength(1);
  expect(conditionFailures([rule], {}, { payload: { a: "1", b: "é" }, reason: null })).toEqual([]);
});

test("regex and containment use NFC strings, full matches, and AND semantics", () => {
  const rule = { when: { status: { regex: "é" }, tags: { contains_any: ["a"], contains_all: ["a", "b"] } }, then: { require: ["reason"] } };
  expect(conditionFailures([rule], {}, { status: "e\u0301", tags: ["a", "b"], reason: null })).toHaveLength(1);
  expect(conditionFailures([rule], {}, { status: "é\n", tags: ["a", "b"], reason: null })).toEqual([]);
  expect(conditionFailures([rule], {}, { status: "é", tags: ["a"], reason: null })).toEqual([]);
});

test("condition definitions validate field references and regexes before any notes exist", () => {
  expect(validateConditions([required], fields)).toEqual([]);
  expect(validateConditions([{ ...required, when: { missing: { equals: 1 } } }], fields)).toMatchObject([{ rule: "NTS-87" }]);
  expect(validateConditions([{ ...required, then: { require: ["missing"] } }], fields)).toMatchObject([{ rule: "NTS-87" }]);
  expect(validateConditions([{ ...required, when: { status: { regex: "[" } } }], fields)).toMatchObject([{ rule: "FND-31" }]);
});
