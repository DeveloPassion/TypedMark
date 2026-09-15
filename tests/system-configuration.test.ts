import { expect, test } from "bun:test";
import { isMap, parseDocument } from "yaml";
import { parseMarkdown, parseMarkdownWithNodes } from "../src/frontmatter";
import { instantiateConfiguration } from "../src/system-configuration";

const identity = { name: "working", source: { name: "@example/source", version: "0.1.0" } };
const base = 'name: "@example/source"\nversion: 0.1.0\nscaffold: {}\ndescription: Source';

function rewrite(yaml: string) {
  const source = parseMarkdownWithNodes(`---\n${yaml}\n---\n`);
  const before = source.frontmatter!.toString();
  const result = instantiateConfiguration(source.frontmatter!, identity);
  expect(source.frontmatter!.toString()).toBe(before);
  return { yaml: result, data: parseMarkdown(`---\n${result}---\n`).data };
}

test("root rewrite does not retain publishing fields inherited through explicit YAML merge", () => {
  const { data } = rewrite([
    'x_base: &base {name: "@example/source", version: 0.1.0, scaffold: {}, description: Source, x_payload: !!set {one: null}}',
    "!!merge <<: *base",
  ].join("\n"));
  expect(data.name).toBe(identity.name);
  expect(data.description).toBe("Source");
  expect(data.x_payload).toEqual(new Set(["one"]));
  expect(data.composition).toEqual({ sources: [identity.source] });
  expect(Object.hasOwn(data, "version")).toBe(false);
  expect(Object.hasOwn(data, "scaffold")).toBe(false);
  expect(data.x_base).toMatchObject({ name: identity.source.name, version: "0.1.0", scaffold: {} });
});

test("root merge materialization keeps explicit override and ordered-source precedence", () => {
  const { data } = rewrite([
    'x_first: &first {name: "@example/source", version: 0.1.0, scaffold: {}, description: First, x_winner: first}',
    "x_second: &second {description: Second, x_winner: second, x_added: yes}",
    "description: Explicit",
    "!!merge <<: [*first, *second]",
  ].join("\n"));
  expect(data.description).toBe("Explicit");
  expect(data.x_winner).toBe("first");
  expect(data.x_added).toBe("yes");
  expect(Object.hasOwn(data, "version")).toBe(false);
});

test("root rewrite binds reused anchor names before hoisting source nodes", () => {
  const { data } = rewrite([
    'name: &same "@example/source"', "x_name: *same", "version: &same 0.1.0", "x_version: *same",
    "scaffold: &same {}", "x_scaffold: *same", "x_later: &same [last]", "x_last: *same",
  ].join("\n"));
  expect(data).toMatchObject({ x_name: identity.source.name, x_version: "0.1.0", x_scaffold: {}, x_later: ["last"], x_last: ["last"] });
});

test("root rewrite preserves tagged pair sequences, shared scalars and negative zero", () => {
  const { data } = rewrite(`${base}\nx_number: &n -0.0\nx_alias: *n\nx_pairs: !!pairs [{a: 1}, {a: 2}]`);
  expect(Object.is(data.x_number, -0)).toBe(true);
  expect(Object.is(data.x_alias, -0)).toBe(true);
  expect(data.x_pairs).toEqual([{ a: 1 }, { a: 2 }]);
});

test("root rewrite retains Core resolution and expands custom tag directives without stream markers", () => {
  const { yaml, data } = rewrite(`%YAML 1.1\n%TAG !vendor! tag:example.com,2026:\n--- \n${base}\nx_editor: !vendor!layout {word: yes, number: 012}`);
  expect(data.x_editor).toEqual({ word: "yes", number: 12 });
  expect(yaml.split("\n")).not.toContain("---");
  expect(yaml).not.toContain("%TAG");
  const document = parseDocument(yaml, { schema: "core" });
  expect(document.errors).toEqual([]);
  const metadata = document.get("x_editor", true);
  expect(isMap(metadata) && metadata.tag).toBe("tag:example.com,2026:layout");
});

test("root rewrite retains blank lines in a final keep-chomp scalar", () => {
  const { data } = rewrite(`${base}\ncomposition: {sources: []}\nx_text: |+\n  retained\n\n\n`);
  // rewrite() adds the fourth YAML content newline before the delimiter.
  expect(data.x_text).toBe("retained\n\n\n\n");
});

test("root rewrite retains scalar precision beyond JavaScript Number and Date", () => {
  const { yaml } = rewrite(`${base}\nx_int: 9007199254740993\nx_float: 1e1000\nx_time: !!timestamp 2026-09-15T10:20:30.123456Z`);
  const document = parseDocument(yaml, { schema: "core", intAsBigInt: true });
  expect(document.get("x_int")).toBe(9007199254740993n);
  expect(document.get("x_float", true)).toMatchObject({ source: "1e1000" });
  expect(document.get("x_time", true)).toMatchObject({ source: "2026-09-15T10:20:30.123456Z" });
});
