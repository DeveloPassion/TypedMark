import { expect, test } from "bun:test";
import { regionDigest, classifyRegion } from "../src/template-drift";

test("digests use UTF-8 and normalize only line endings", () => {
  expect(regionDigest("")).toBe("sha256:e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855");
  expect(regionDigest("a\r\nb\rc")).toBe(regionDigest("a\nb\nc"));
  expect(regionDigest("é")).not.toBe(regionDigest("e\u0301"));
  expect(regionDigest("text ")).not.toBe(regionDigest("text"));
});

test.each([
  ["a", "b", "b", "current"], [undefined, undefined, "a", "template_added"],
  ["a", "a", "b", "template_changed"], ["a", "b", "a", "note_changed"],
  ["a", "b", "c", "both_changed"], ["a", undefined, "a", "region_missing"],
  ["a", "a", undefined, "template_removed"], ["a", "b", undefined, "template_removed_note_changed"],
  ["a", undefined, undefined, "retired"],
])("classifies baseline=%j note=%j template=%j as %s", (baseline, note, template, expected) => {
  expect(classifyRegion(baseline, note, template)).toBe(expected);
});
