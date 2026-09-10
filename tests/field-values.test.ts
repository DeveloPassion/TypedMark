import { expect, test } from "bun:test";
import { classifyConversion, compareFieldValues, equalFieldValues, validateFieldValue } from "../src/field-values";

test("compares text by NFC code points, numeric values numerically, and datetimes by instant", () => {
  expect(equalFieldValues("e\u0301", "é", { type: "text" }, "UTC")).toBe(true);
  expect(compareFieldValues("\u{10000}", "\uE000", { type: "text" }, "UTC")).toBeGreaterThan(0);
  expect(compareFieldValues(10, 2, { type: "number" }, "UTC")).toBeGreaterThan(0);
  expect(equalFieldValues("2026-01-01T11:00Z", "2026-01-01T12:00+01:00", { type: "datetime" }, "UTC")).toBe(true);
});

test("compares objects independently of key order and sequences in order", () => {
  expect(equalFieldValues({ b: [1, "e\u0301"], a: true }, { a: true, b: [1, "é"] }, { type: "any" }, "UTC")).toBe(true);
  expect(equalFieldValues(["a", "b"], ["b", "a"], { type: "tags" }, "UTC")).toBe(false);
});

test.each([
  ["integer", "number", "lossless"], ["number", "integer", "conditional"],
  ["date", "text", "lossless"], ["text", "date", "conditional"],
  ["datetime", "date", "incompatible"], ["checkbox", "text", "incompatible"],
  ["object", "object", "exact"], ["object", "any", "lossless"], ["any", "object", "conditional"],
] as const)("classifies %s to %s as %s", (source, target, expected) => {
  expect(classifyConversion({ type: source }, { type: target })).toBe(expected);
});

test("validates temporal bounds by instant and rejects ambiguous local time", () => {
  expect(validateFieldValue("2026-01-01T12:00+02:00", { type: "datetime", max: "2026-01-01T11:00Z" }, "UTC")).toBeUndefined();
  expect(validateFieldValue("2026-10-25T02:30", { type: "datetime" }, "Europe/Brussels")).toBeDefined();
});

test("enforces full regex matching, canonical tag uniqueness, and nested nullability", () => {
  expect(validateFieldValue("a\n", { type: "text", regex: "a" }, "UTC")).toBeDefined();
  expect(validateFieldValue(["é", "e\u0301"], { type: "tags" }, "UTC")).toBeDefined();
  expect(validateFieldValue({ value: null }, { type: "object", fields: { value: { type: "text", nullable: true } } }, "UTC")).toBeUndefined();
  expect(validateFieldValue([null], { type: "list", items: { type: "text" } }, "UTC")).toBeDefined();
});
