import { expect, test } from "bun:test";
import { isExcluded } from "../src/paths";

test.each([
  ["A.md", "**/*.md", true], ["one/two/A.md", "**/*.md", true],
  ["cache", "cache/**", true], ["cache/A.md", "cache/**", true],
  ["a/b.md", "a/**/b.md", true], ["a/one/two/b.md", "a/**/b.md", true],
  ["a/one/b.md", "a/*/b.md", true], ["a/b.md", "a/*/b.md", false],
  ["a/one/two/b.md", "a/*/b.md", false], ["A.md", "a.md", false],
  ["é/A.md", "e\u0301/**", true], ["😀.md", "?.md", true],
  ["aXb.md", "a.b.md", false], ["A.md", "!A.md", false],
  ["line\nname/A.md", "**/*.md", true],
  ["fooA.md", "foo**/A.md", false], ["foo/A.md", "foo**/A.md", true],
])("glob %j against %j yields %j", (path, glob, expected) => {
  expect(isExcluded(path as string, [glob as string])).toBe(expected);
});
