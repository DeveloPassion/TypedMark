import { expect, test } from "bun:test";
import { hasUriScheme, isUriReference } from "../src/uri-syntax";

test.each([
  { name: "path", wrap: (value: string) => `x:${value}` },
  { name: "query", wrap: (value: string) => `x:?q=${value}` },
  { name: "fragment", wrap: (value: string) => `x:#${value}` },
  { name: "userinfo", wrap: (value: string) => `x://${value}@host/` },
  { name: "registered name", wrap: (value: string) => `x://${value}/` },
])("validates long $name components without imposing a regex-engine size limit", ({ wrap }) => {
  for (const value of ["a".repeat(1_000_000), "%FF".repeat(340_000)]) {
    expect(isUriReference(wrap(value))).toBe(true);
    expect(isUriReference(wrap(`${value}%GG`))).toBe(false);
    expect(isUriReference(wrap(`${value}é`))).toBe(false);
  }
});

test("scheme recognition uses raw ASCII characters without decoding or Unicode folding", () => {
  for (const value of ["a:", "HTTP:", "x+y.z-0:"]) expect(hasUriScheme(value)).toBe(true);
  for (const value of ["%68ttps:", "K:", "ſcheme:", "1x:", "x_y:", "é:"]) expect(hasUriScheme(value)).toBe(false);
});
