import { expect, test } from "bun:test";
import { computedFailures, hasComputed, validateComputedFields } from "../src/expressions";

const fields = {
  day: { type: "date" },
  when: { type: "datetime" },
  name: { type: "text" },
  year: { type: "integer", from_date: { field: "day", part: "GGGG" } },
  month: { type: "text", from_date: { field: "day", part: "YYYY-MM" } },
};

test("from_date needs a sibling date and a part its type can hold (FDR-293, FDR-294)", () => {
  expect(hasComputed(fields)).toBe(true);
  expect(validateComputedFields(fields)).toEqual([]);
  expect(validateComputedFields({ ...fields, bad: { type: "integer", from_date: { field: "name", part: "YYYY" } } })).toMatchObject([
    { field: "bad", rule: "FDR-293" },
  ]);
  expect(validateComputedFields({ ...fields, bad: { type: "integer", from_date: { field: "day", part: "YYYY-MM" } } })).toMatchObject([
    { field: "bad", rule: "FDR-294" },
  ]);
});

test("stored date parts must equal the derived value, null without a source (FDR-295, FDR-297, FDR-298)", () => {
  expect(computedFailures(fields, { year: 2026, month: "2025-12" }, { day: "2025-12-29" }, "UTC")).toEqual([]);
  expect(computedFailures(fields, { year: 2025 }, { day: "2025-12-29" }, "UTC")).toMatchObject([{ field: "year", rule: "FDR-298" }]);
  expect(computedFailures(fields, { year: null }, { day: null }, "UTC")).toEqual([]);
  expect(computedFailures(fields, { year: 2026 }, { day: null }, "UTC")).toMatchObject([{ field: "year", rule: "FDR-298" }]);
});
