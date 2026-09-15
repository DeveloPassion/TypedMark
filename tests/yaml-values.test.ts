import { expect, test } from "bun:test";
import { parseDocument } from "yaml";
import { YamlValue } from "../src/yaml-values";

const parse = (source: string) => parseDocument(source, { version: "1.2", schema: "core", resolveKnownTags: true, merge: false });

test("source lookup resolves aliases and explicit merges at every level", () => {
  const document = parse("defaults: &d {default_value: 9007199254740993}\nfields: &f {payload: {!!merge <<: *d}}\nfrontmatter: {!!merge <<: *f}\n");
  const before = document.toString();
  const value = YamlValue.from(document).field("frontmatter")!.field("payload")!.field("default_value")!;
  const output = parseDocument(value.toString(), { schema: "core", intAsBigInt: true });
  expect(output.toJS()).toBe(9007199254740993n);
  expect(document.toString()).toBe(before);
});

test("source mapping lookup retains explicit and ordered merge precedence", () => {
  const value = YamlValue.from(parse("first: &a {a: one, b: first}\nsecond: &b {b: second, c: three}\nvalue: {b: explicit, !!merge <<: [*a, *b]}\n")).field("value")!;
  expect(parse(value.field("a")!.toString()).toJS()).toBe("one");
  expect(parse(value.field("b")!.toString()).toJS()).toBe("explicit");
  expect(parse(value.field("c")!.toString()).toJS()).toBe("three");
});

test("combines independent source documents without colliding anchors or losing native tags", () => {
  const left = YamlValue.from(parse("value: &same !!set {one: null}\ncopy: *same\n"));
  const right = YamlValue.from(parse("value: &same !!omap [{z: 1}, {a: 2}]\ncopy: *same\n"));
  const result = YamlValue.mapping(new Map([
    ["left", left.field("value")!], ["left_copy", left.field("copy")!],
    ["right", right.field("value")!], ["right_copy", right.field("copy")!],
  ]));
  const actual = parse(result.toString()).toJS();
  expect(actual.left).toEqual(new Set(["one"]));
  expect(actual.right).toEqual(new Map([["z", 1], ["a", 2]]));
  expect(actual.left_copy).toBe(actual.left);
  expect(actual.right_copy).toBe(actual.right);
});

test("unchanged containers retain their source identity and cycles", () => {
  const source = YamlValue.from(parse("value: &v {name: before, self: *v}\ncopy: *v\n"));
  const original = source.field("value")!;
  const unchanged = YamlValue.mapping(new Map([["name", original.field("name")!], ["self", original.field("self")!]]), original);
  expect(unchanged.sameAs(original)).toBe(true);
  const output = parse(YamlValue.mapping(new Map([["value", unchanged], ["copy", source.field("copy")!]])).toString()).toJS();
  expect(output.value).toBe(output.copy);
  expect(output.value.self).toBe(output.value);
});

test("changing a container leaves aliases to its old value unchanged", () => {
  const document = parse("value: &v {name: before, self: *v}\ncopy: *v\n");
  const before = document.toString(), source = YamlValue.from(document), original = source.field("value")!;
  const changed = YamlValue.mapping(new Map([["name", YamlValue.literal("after")], ["self", original.field("self")!]]), original);
  const result = YamlValue.mapping(new Map([["value", changed], ["copy", source.field("copy")!]]));
  const output = parse(result.toString()).toJS();
  expect(output.value.name).toBe("after");
  expect(output.copy.name).toBe("before");
  expect(output.copy.self).toBe(output.copy);
  expect(output.value.self).toBe(output.copy);
  expect(document.toString()).toBe(before);
});

test("preserves unknown tags, complex keys, scalar precision and whitespace", () => {
  const source = YamlValue.from(parse("value: !custom/map\n  ? [a, b]\n  : !custom/value kept\n  time: !!timestamp 2026-09-15T00:00:00.123456Z\n  huge: 1e1000\n  blank: \" \\n\"\n"));
  const output = parse(source.field("value")!.toString());
  expect(output.contents?.tag).toBe("!custom/map");
  expect(output.get("time", true)).toMatchObject({ source: "2026-09-15T00:00:00.123456Z" });
  expect(output.get("huge", true)).toMatchObject({ source: "1e1000" });
  expect(output.get("blank")).toBe(" \n");
  expect(output.contents).toMatchObject({ items: [{ key: { items: [{ value: "a" }, { value: "b" }] }, value: { tag: "!custom/value" } }, {}, {}, {}] });
});

test("sequence materialization reuses unchanged values and preserves pair items", () => {
  const source = YamlValue.from(parse("value: !!pairs [{one: 1}, {one: 2}]\n")).field("value")!;
  const result = YamlValue.sequence([source.at(0)!, source.at(1)!], source);
  expect(result.sameAs(source)).toBe(true);
  expect(parse(result.toString()).toJS()).toEqual([{ one: 1 }, { one: 2 }]);
  expect(parse(source.at(0)!.toString()).toJS()).toEqual({ one: 1 });
});

test("an empty replacement mapping does not reuse a scalar base", () => {
  expect(parse(YamlValue.mapping(new Map(), YamlValue.literal("old")).toString()).toJS()).toEqual({});
});

test("literal binary slices do not expose bytes outside the selected view", () => {
  const bytes = new Uint8Array([99, 72, 105, 88]);
  const output = parse(YamlValue.literal(bytes.subarray(1, 3)).toString()).toJS();
  expect([...output]).toEqual([72, 105]);
  expect([...bytes]).toEqual([99, 72, 105, 88]);
});

test("mapping changes retain existing tagged and numeric key nodes", () => {
  const source = YamlValue.from(parse("!custom/key existing: kept\n9007199254740993: large\n"));
  const result = YamlValue.mapping(new Map([
    ["existing", source.field("existing")!], ["9007199254740992", source.field("9007199254740992")!],
    ["added", YamlValue.literal("new")],
  ]), source);
  const output = parseDocument(result.toString(), { schema: "core", intAsBigInt: true });
  expect(output.contents).toMatchObject({ items: [
    { key: { tag: "!custom/key", value: "existing" } },
    { key: { value: 9007199254740993n } },
    { key: { value: "added" } },
  ] });
});

test("merge namespaces use native-key precedence before object-name projection", () => {
  const source = YamlValue.from(parse("value: {!!merge <<: {true: first, 'true': second, null: empty, ? [default_value]: !widget kept}}\n")).field("value")!;
  expect(parse(source.field("true")!.toString()).toJS()).toBe("first");
  expect(parse(source.field("null")!.toString()).toJS()).toBe("empty");
  expect(parse(source.field("default_value")!.toString()).toJS()).toBe("kept");
});

test("partial updates do not turn repeated merge operators into ordinary alias keys", () => {
  const source = YamlValue.from(parse("value: &v {!!merge <<: {name: before}}\ncopy: *v\n"));
  const changed = YamlValue.withFields(new Map([["added", YamlValue.literal("after")]]), source.field("value")!);
  const output = parse(YamlValue.mapping(new Map([["value", changed], ["copy", source.field("copy")!]])).toString()).toJS();
  expect(output.value).toEqual({ name: "before", added: "after" });
  expect(output.copy).toEqual({ name: "before" });
});

test("default forks retain internal aliases without sharing identity across applications", () => {
  const source = YamlValue.from(parse("value: {first: &v {text: !widget kept}, second: *v}\n")).field("value")!;
  const output = parse(YamlValue.mapping(new Map([["a", source.fork()], ["b", source.fork()]])).toString()).toJS();
  expect(output.a.first).toBe(output.a.second);
  expect(output.b.first).toBe(output.b.second);
  expect(output.a.first).not.toBe(output.b.first);
});

test("an authored merge-key alias remains an alias when its definition is retained", () => {
  const document = parse("value: {!!merge &op <<: {}, *op : {name: before}}\n");
  const original = document.toJS().value;
  expect(parse(YamlValue.from(document).field("value")!.toString()).toJS()).toEqual(original);
});

test("context-dependent merge-key aliases cannot silently change values when detached", () => {
  const document = parse("holder: {!!merge &op <<: {}}\nvalue: {*op : {name: before}}\n");
  const before = document.toString();
  expect(() => YamlValue.from(document).field("value")!.toString()).toThrow("Cannot preserve a merge-key alias");
  expect(document.toString()).toBe(before);
});

test("named overrides of merged collection and null keys keep the intended field name", () => {
  for (const [yaml, name] of [["value: {!!merge <<: {? [name]: before}}", "name"], ["value: {!!merge <<: {null: before}}", "null"]]) {
    const value = YamlValue.from(parse(yaml)).field("value")!;
    const changed = YamlValue.withFields(new Map([[name!, YamlValue.literal("after")]]), value);
    expect(parse(changed.toString()).toJS()[name!]).toBe("after");
  }
});

test("complete mapping construction retains merged names when adding a sibling", () => {
  const base = YamlValue.from(parse("!!merge <<: {? [title]: before}\n"));
  const result = YamlValue.mapping(new Map([["title", base.field("title")!], ["added", YamlValue.literal("new")]]), base);
  expect(parse(result.toString()).toJS()).toEqual({ title: "before", added: "new" });
});

test("source lookup agrees with the reader for a native set used as a merge source", () => {
  const document = parse("frontmatter:\n  payload:\n    type: any\n    !!merge <<: !!set {? [default_value, kept]: null}\n");
  expect(document.errors).toEqual([]);
  const expected = document.toJS().frontmatter.payload.default_value;
  const source = YamlValue.from(document).field("frontmatter")!.field("payload")!.field("default_value");
  expect(source).toBeDefined();
  expect(parse(source!.toString()).toJS()).toBe(expected);
});
