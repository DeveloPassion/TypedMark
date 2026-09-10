import { expect, test } from "bun:test";
import { selectVectorCapabilities } from "../src/vector-context";

const required = { "typedmark:systems": "0.1.0" };

test("records an explicit limited scope without changing the collection's requirements", () => {
  expect(selectVectorCapabilities(required, required, { disabled_extensions: ["typedmark:systems"] }))
    .toEqual({ supportedExtensions: {} });
  expect(required).toEqual({ "typedmark:systems": "0.1.0" });
});

test("does not run an unsupported negotiation case when the adapter supports its requirement", () => {
  expect(selectVectorCapabilities(required, required, { unsupported_extensions: ["typedmark:systems"] }).skip?.status)
    .toBe("not_run_precondition");
});

test("does not mislabel an unavailable contract as deliberately disabled", () => {
  expect(selectVectorCapabilities(required, {}, { disabled_extensions: ["typedmark:systems"] }).skip?.status)
    .toBe("not_run_precondition");
});

test("does not run a normal case missing an implemented required capability", () => {
  expect(selectVectorCapabilities(required, {}, {}).skip).toMatchObject({
    status: "not_run_unsupported", extensions: ["typedmark:systems"],
  });
});

test("runs an explicit unsupported case only for the exact required version", () => {
  const extensions = { "typedmark:systems": "0.1.0+other" };
  expect(selectVectorCapabilities(extensions, required, { unsupported_extensions: ["typedmark:systems"] }).skip)
    .toBeUndefined();
});

test("rejects context for undeclared or contradictory extension requirements", () => {
  expect(() => selectVectorCapabilities({}, {}, { unsupported_extensions: ["typedmark:systems"] })).toThrow("declared");
  expect(() => selectVectorCapabilities(required, required, {
    disabled_extensions: ["typedmark:systems"], unsupported_extensions: ["typedmark:systems"],
  })).toThrow("both");
});
