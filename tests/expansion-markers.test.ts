import { expect, test } from "bun:test";
import { parseExpansions } from "../src/expansion-markers";

const descriptor = { id: "summary", mode: "manual", state: "materialized", source: { kind: "self_field", field: "summary" }, render: { item: "${value}" } };
const start = `<!-- typedmark:expansion ${JSON.stringify(descriptor)} -->`;
const end = "<!-- /typedmark:expansion -->";

test("parses paired markers with exact line-normalized region text", () => {
  const result = parseExpansions(`${start}\r\nA\r\nB\r\n${end}\r\n`);
  expect(result.failures).toEqual([]);
  expect(result.expansions).toMatchObject([{ descriptor, region: "A\nB" }]);
});

test.each([
  `\x60\x60\x60md\n${start}\n${end}\n\x60\x60\x60\n`,
  `    ${start}\n    ${end}\n`,
  `- item\n\n  ~~~\n  ${start}\n  ${end}\n  ~~~\n`,
  `> ~~~\n> ${start}\n> ${end}\n> ~~~\n`,
])("ignores markers inside CommonMark code blocks: %j", (code) => {
  expect(parseExpansions(code)).toMatchObject({ used: false, expansions: [], failures: [] });
  expect(parseExpansions(`${code}\n${start}\n${end}`).expansions).toHaveLength(1);
});

test.each([
  [`${start}\n`, "RHT-101"], [`${end}\n`, "RHT-102"],
  [`${start}\n${start}\n${end}\n${end}`, "RHT-100"],
  [`${start}\n${end}\n${start}\n${end}`, "RHT-103"],
  [`${start} trailing\n${end}`, "RHT-95"],
  ["<!-- typedmark:expansion {broken} -->\n" + end, "RHT-95"],
  [start.replace("summary", "sum--mary") + "\n" + end, "RHT-175"],
])("rejects invalid expansion marker structure: %j", (body, rule) => {
  expect(parseExpansions(body).failures).toContainEqual(expect.objectContaining({ rule }));
});

test.each([
  `${start}\n~~~\ninside\n~~~\n${end}`,
  `${start}\n    inside\n${end}`,
  `- item\n\n  ~~~\n  inside\n  ~~~\n  ${start}\n  ${end}`,
  `- outer\n  - inner\n\n  ~~~\n  inside\n  ~~~\n  ${start}\n  ${end}`,
])("code blocks do not consume an adjacent active marker: %j", (body) => {
  const result = parseExpansions(body);
  expect(result.failures).toEqual([]);
  expect(result.expansions).toHaveLength(1);
});

test("invalid nesting does not copy every nested materialized region", () => {
  const result = parseExpansions(`${start}\n${start}\ntext\n${end}\n${end}`);
  expect(result.failures).toContainEqual(expect.objectContaining({ rule: "RHT-100" }));
  expect(result.expansions).toHaveLength(1);
});
