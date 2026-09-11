import { expect, test } from "bun:test";
import { expansionValues, relationshipLink } from "../src/expansion-sources";

test("source conversion preserves scalar types and sequence order", () => {
  expect(expansionValues(["text", true, false, 3, -0])).toEqual(["text", "true", "false", "3", "0"]);
  expect(expansionValues(1e21, { type: "integer" })).toEqual(["1000000000000000000000"]);
  expect(expansionValues(1e21, { type: "number" })).toEqual(["1e+21"]);
  expect(expansionValues(null)).toEqual([]);
  expect(expansionValues(undefined)).toEqual([]);
  for (const value of [{ key: "value" }, [[1]], [null], Infinity]) expect(() => expansionValues(value)).toThrow();
});

test("relationship links escape labels and encode UTF-8 paths canonically", () => {
  expect(relationshipLink("Notes/É [x].md")).toBe("[É \\[x\\]](/Notes/%C3%89%20%5Bx%5D.md)");
});
