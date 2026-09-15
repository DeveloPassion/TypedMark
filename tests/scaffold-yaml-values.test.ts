import { afterEach, expect, test } from "bun:test";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { isMap, isScalar, isSeq, parseDocument } from "yaml";
import { parseMarkdown } from "../src/frontmatter";
import { instantiateSystem } from "../src/system";
import { validateCollection } from "../src/validator";

const schemaDirectory = resolve(import.meta.dir, "../../TypedMarkSpecification/schema/json-schema");
const fixtures: Array<{ root: string; source: string; bytes: Record<string, string> }> = [];
const body = "# Starter\r\nFirst  \r\nsecond\r\n\r\n";
const attribution = "System attribution.  \r\nKeep this line.\r\n";
type Origin = "scaffold values" | "template literal" | "local default";

afterEach(() => {
  try {
    for (const fixture of fixtures) expect(snapshot(fixture.source)).toEqual(fixture.bytes);
  } finally {
    for (const fixture of fixtures.splice(0)) rmSync(fixture.root, { recursive: true, force: true });
  }
});

// FDR-29 admits every non-null YAML value. SCE-18/19 and RHT-79/81 select
// its source; MN-91 requires the concrete value without coercion.
for (const origin of ["scaffold values", "template literal", "local default"] as const) {
  test(`scaffolding preserves native set, ordered map, timestamp and binary from ${origin}`, async () => {
    const fixture = payloadFixture(origin, [
      "members: !!set {alpha: null, beta: null}",
      "ordered: !!omap [{later: 2}, {earlier: 1}]",
      "timestamp: !!timestamp 2026-09-15T10:20:30.123Z",
      "binary: !!binary AAH+/w==",
    ].join("\n"));
    const { data } = await instantiate(fixture);
    const payload = data.payload as Record<string, unknown>;

    expect(payload.members).toEqual(new Set(["alpha", "beta"]));
    expect(payload.ordered).toBeInstanceOf(Map);
    expect([...payload.ordered as Map<string, number>]).toEqual([["later", 2], ["earlier", 1]]);
    expect(payload.timestamp).toEqual(new Date("2026-09-15T10:20:30.123Z"));
    expect(payload.binary).toBeInstanceOf(Uint8Array);
    expect([...payload.binary as Uint8Array]).toEqual([0, 1, 254, 255]);
  });

  test(`scaffolding preserves precision beyond JavaScript Number and Date from ${origin}`, async () => {
    const fixture = payloadFixture(origin, [
      "integer: 9007199254740993",
      "decimal: 0.12345678901234567890123456789",
      "timestamp: !!timestamp 2026-09-15T10:20:30.123456789Z",
    ].join("\n"));
    const { source } = await instantiate(fixture);
    const document = yamlDocument(source, true);

    expect(document.getIn(["payload", "integer"])).toBe(9007199254740993n);
    expect(document.getIn(["payload", "decimal"], true)).toMatchObject({ source: "0.12345678901234567890123456789" });
    expect(document.getIn(["payload", "timestamp"], true)).toMatchObject({
      tag: "tag:yaml.org,2002:timestamp", source: "2026-09-15T10:20:30.123456789Z",
    });
  });

  test(`scaffolding preserves unknown tags and complex mapping keys from ${origin}`, async () => {
    const fixture = payloadFixture(origin, [
      "scalar: !widget keep",
      "sequence: !items [one, two]",
      "mapping: !record {value: retained}",
      "keyed:",
      "  ? [north, east]",
      "  : corner",
      "  ? {layer: 2}",
      "  : overlay",
      "  ? 7",
      "  : numeric key",
      '  ? "7"',
      "  : string key",
    ].join("\n"));
    const { source } = await instantiate(fixture);
    const document = yamlDocument(source);

    expect(document.getIn(["payload", "scalar"], true)).toMatchObject({ tag: "!widget", value: "keep" });
    expect(document.getIn(["payload", "sequence"], true)).toMatchObject({ tag: "!items", items: [{ value: "one" }, { value: "two" }] });
    expect(document.getIn(["payload", "mapping"], true)).toMatchObject({ tag: "!record" });
    const keyed = document.getIn(["payload", "keyed"], true);
    if (!isMap(keyed)) throw new Error("Expected the payload to retain a mapping with complex keys");
    expect(keyed.items).toHaveLength(4);
    expect(keyed.items.find(({ key }) => isSeq(key))).toMatchObject({
      key: { items: [{ value: "north" }, { value: "east" }] }, value: { value: "corner" },
    });
    expect(keyed.items.find(({ key }) => isMap(key))).toMatchObject({
      key: { items: [{ key: { value: "layer" }, value: { value: 2 } }] }, value: { value: "overlay" },
    });
    expect(keyed.items.find(({ key }) => isScalar(key) && key.value === 7)).toMatchObject({ value: { value: "numeric key" } });
    expect(keyed.items.find(({ key }) => isScalar(key) && key.value === "7")).toMatchObject({ value: { value: "string key" } });
  });
}

test("scaffold values preserve shared aliases and a recursive YAML value", async () => {
  const fixture = payloadFixture("scaffold values", [
    "first: &shared {value: retained}",
    "second: *shared",
    "loop: &loop {label: recursive, next: *loop}",
  ].join("\n"));
  const { data } = await instantiate(fixture);
  const payload = data.payload as { first: { value: string }; second: unknown; loop: { label: string; next: unknown } };

  expect(payload.first).toEqual({ value: "retained" });
  expect(payload.second).toBe(payload.first);
  expect(payload.loop.label).toBe("recursive");
  expect(payload.loop.next).toBe(payload.loop);
});

test("a template-root alias retains its original value while the note fills placeholders", async () => {
  const fixture = systemFixture({
    fields: "payload: {type: any}\nstatus: {type: text, default_value: ready}",
    template: "&template_root\ntitle: null\nstatus: null\npayload: *template_root",
  });
  const { data } = await instantiate(fixture);
  const original = data.payload as Record<string, unknown>;

  expect(data.title).toBe("Welcome");
  expect(data.status).toBe("ready");
  expect(original.title).toBeNull();
  expect(original.status).toBeNull();
  expect(original.payload).toBe(original);
  expect(Object.keys(original).sort()).toEqual(["payload", "status", "title"]);
});

test("a scaffold alias to the source root retains source identity and its recursive scaffold", async () => {
  const fixture = systemFixture({
    rootAnchor: true,
    fields: "payload: {type: any}",
    values: "title: Welcome\npayload: *source_root",
  });
  const { data } = await instantiate(fixture);
  const original = data.payload as { name: string; version: string; scaffold: { notes: Array<{ values: { payload: unknown } }> } };

  expect(original.name).toBe("@example/scaffold-yaml");
  expect(original.version).toBe("0.1.0");
  expect(original.scaffold.notes[0]!.values.payload).toBe(original);
  expect(Object.hasOwn(original, "composition")).toBe(false);
  expect(Object.hasOwn(original, "note_type")).toBe(false);
});

test("inherited and property-set defaults preserve the YAML value from the winning definition", async () => {
  const fixture = systemFixture({
    reuse: true,
    config: "default_property_sets: [shared]",
    schema: "extends: base\nproperty_sets: [selected]",
    fields: "local_wins: {type: any, default_value: !!binary AAH+/w==}\nreplaced: {type: any, nullable: true}",
    files: {
      ".typedmark/property-sets/shared.md": artifact("property_set: shared\nfrontmatter:\n  shared_only: {type: any, default_value: !!set {shared: null}}\n  parent_wins: {type: any, default_value: wrong}\n  set_wins: {type: any, default_value: wrong}\n  local_wins: {type: any, default_value: wrong}\n  replaced: {type: any, default_value: !!set {stale: null}}"),
      ".typedmark/schemas/base.md": artifact("abstract: true\nfrontmatter:\n  parent_wins: {type: any, default_value: !!omap [{second: 2}, {first: 1}]}\n  set_wins: {type: any, default_value: wrong}\n  local_wins: {type: any, default_value: wrong}"),
      ".typedmark/property-sets/selected.md": artifact("property_set: selected\nfrontmatter:\n  set_wins: {type: any, default_value: !!timestamp 2026-09-15T10:20:30.123Z}\n  local_wins: {type: any, default_value: wrong}"),
    },
  });
  const { data } = await instantiate(fixture);

  expect(data.shared_only).toEqual(new Set(["shared"]));
  expect(data.parent_wins).toBeInstanceOf(Map);
  expect([...data.parent_wins as Map<string, number>]).toEqual([["second", 2], ["first", 1]]);
  expect(data.set_wins).toEqual(new Date("2026-09-15T10:20:30.123Z"));
  expect(data.local_wins).toBeInstanceOf(Uint8Array);
  expect([...data.local_wins as Uint8Array]).toEqual([0, 1, 254, 255]);
  expect(data.replaced).toBeNull();
});

test("typed object and list defaults retain nested any values and explicit nested nulls", async () => {
  const fixture = systemFixture({
    fields: [
      "object:",
      "  type: object",
      "  default_value: {nothing: null}",
      "  fields:",
      "    nothing: {type: any, nullable: true, default_value: !!set {unused: null}}",
      "    payload: {type: any, default_value: !!set {nested: null}}",
      "rows:",
      "  type: list",
      "  default_value: [{payload: !!omap [{second: 2}, {first: 1}]}, {}]",
      "  items:",
      "    type: object",
      "    fields:",
      "      payload: {type: any, default_value: !!binary AAH+/w==}",
    ].join("\n"),
  });
  const { data } = await instantiate(fixture);
  const object = data.object as Record<string, unknown>;
  const rows = data.rows as Array<Record<string, unknown>>;

  expect(object.nothing).toBeNull();
  expect(object.payload).toEqual(new Set(["nested"]));
  expect(rows[0]!.payload).toBeInstanceOf(Map);
  expect([...rows[0]!.payload as Map<string, number>]).toEqual([["second", 2], ["first", 1]]);
  expect(rows[1]!.payload).toBeInstanceOf(Uint8Array);
  expect([...rows[1]!.payload as Uint8Array]).toEqual([0, 1, 254, 255]);
});

test("materialization still applies mandatory tags and generators without changing aliased starter values", async () => {
  const fixture = systemFixture({
    config: "mandatory_tags: [managed, shared]",
    schema: "mandatory_tags: [shared, type/note]",
    fields: "payload: {type: any}\nid: {type: text, format: slug, generated: uuid}\ncreated_at: {type: datetime}\nempty: {type: text, default_value: fallback}\nnothing: {type: any, nullable: true, default_value: fallback}",
    values: 'title: Welcome\nempty: ""\nnothing: null',
    template: "tags: &original_tags [personal, shared]\npayload: {original_tags: *original_tags}\nid: null\ncreated_at: null",
  });
  const before = Date.now();
  const { data } = await instantiate(fixture);
  const after = Date.now();

  expect(data.tags).toEqual(["personal", "shared", "managed", "type/note"]);
  expect(data.payload).toEqual({ original_tags: ["personal", "shared"] });
  expect(data.id).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/);
  expect(typeof data.created_at).toBe("string");
  expect(Date.parse(data.created_at as string)).toBeGreaterThanOrEqual(before);
  expect(Date.parse(data.created_at as string)).toBeLessThanOrEqual(after);
  expect(data.empty).toBe("");
  expect(data.nothing).toBeNull();
});

test("default source lookup follows YAML merges through field maps and definitions", async () => {
  const fixture = systemFixture({
    schema: "x_properties: &properties {type: any, default_value: 9007199254740993}\nx_fields: &fields {payload: {!!merge <<: *properties}}",
    fields: "!!merge <<: *fields",
  });
  const { source } = await instantiate(fixture);
  expect(yamlDocument(source, true).get("payload")).toBe(9007199254740993n);
});

test("scaffold value lookup follows an explicit YAML merge", async () => {
  const fixture = systemFixture({
    config: "x_values: &values {payload: !!set {one: null}, title: Welcome}",
    fields: "payload: {type: any}", values: "!!merge <<: *values",
  });
  expect((await instantiate(fixture)).data.payload).toEqual(new Set(["one"]));
});

test("template value lookup follows an explicit YAML merge and retains shared values", async () => {
  const fixture = systemFixture({
    fields: "base: {type: any}\npayload: {type: any}",
    template: "base: &base {payload: !!omap [{one: 1}, {two: 2}]}\n!!merge <<: *base",
  });
  const { data } = await instantiate(fixture);
  expect(data.payload).toEqual(new Map([["one", 1], ["two", 2]]));
  expect(data.payload).toBe((data.base as Record<string, unknown>).payload);
});

test("unchanged typed containers retain cross-field sharing while generated children leave source aliases intact", async () => {
  const fixture = systemFixture({
    fields: "unchanged: {type: object, fields: {value: {type: text}}}\nshared: {type: any}\nchanged: {type: object, fields: {uid: {type: text, generated: uuid}}}\noriginal: {type: any}\nrows: {type: list, items: {type: object, fields: {uid: {type: text, generated: uuid}}}}",
    template: "unchanged: &same {value: keep}\nshared: *same\nchanged: &before {}\noriginal: *before\nrows: [{}]",
  });
  const { data } = await instantiate(fixture);
  expect(data.unchanged).toBe(data.shared);
  expect(data.original).toEqual({});
  expect((data.changed as Record<string, unknown>).uid).toMatch(/^[0-9a-f-]{36}$/);
  expect((data.rows as Array<Record<string, unknown>>)[0]!.uid).toMatch(/^[0-9a-f-]{36}$/);
});

test("writer sources do not turn intrinsic Core defaults into missing authored defaults", async () => {
  const fixture = systemFixture({ fields: "tags: {type: tags}\naliases: {type: list, items: {type: text}}\ndeleted: {type: checkbox}\narchived: {type: checkbox}" });
  const { data } = await instantiate(fixture);
  expect(data).toMatchObject({ tags: [], aliases: [], deleted: false, archived: false });
});

test("adding an object default retains the original tag on a sibling key", async () => {
  const fixture = systemFixture({
    fields: "payload: {type: object, fields: {existing: {type: text}, added: {type: text, default_value: new}}}",
    template: "payload:\n  !custom/key existing: kept",
  });
  const { source } = await instantiate(fixture);
  expect(yamlDocument(source).get("payload", true)).toMatchObject({ items: [
    { key: { tag: "!custom/key", value: "existing" }, value: { value: "kept" } },
    { key: { value: "added" }, value: { value: "new" } },
  ] });
});

test("object defaults retain permitted opaque extra keys and values without JS key projection", async () => {
  const fixture = systemFixture({
    schema: "unknown_field: off",
    fields: "payload: {type: object, fields: {added: {type: text, default_value: new}}}",
    values: "title: Welcome\npayload:\n  ? [north, east]\n  : !widget corner\n  ? 7\n  : number\n  ? \"7\"\n  : string",
  });
  const { source } = await instantiate(fixture);
  const payload = yamlDocument(source).get("payload", true);
  if (!isMap(payload)) throw new Error("Expected payload mapping");
  expect(payload.items).toHaveLength(4);
  expect(payload.items[0]).toMatchObject({ key: { items: [{ value: "north" }, { value: "east" }] }, value: { tag: "!widget", value: "corner" } });
  expect(payload.items[1]).toMatchObject({ key: { value: 7 }, value: { value: "number" } });
  expect(payload.items[2]).toMatchObject({ key: { value: "7" }, value: { value: "string" } });
  expect(payload.get("added")).toBe("new");
});

test("merged field/default sources match the reader's native-key projection", async () => {
  const fixture = systemFixture({
    fields: "!!merge <<: {true: {type: any, default_value: !widget first}, 'true': {type: any, default_value: !widget second}}\npayload:\n  type: any\n  !!merge <<: {? [default_value]: !widget kept}",
  });
  const { source, data } = await instantiate(fixture);
  expect(data.true).toBe("first");
  expect(data.payload).toBe("kept");
  expect(yamlDocument(source).get("true", true)).toMatchObject({ tag: "!widget" });
});

test("independent repeated defaults do not invent an alias-resource failure", async () => {
  const fixture = systemFixture({
    fields: "rows: {type: list, items: {type: object, fields: {state: {type: text, default_value: ready}}}}",
    values: `title: Welcome\nrows: [${Array(101).fill("{}").join(", ")}]`,
  });
  const { data } = await instantiate(fixture);
  expect(data.rows).toEqual(Array.from({ length: 101 }, () => ({ state: "ready" })));
});

test("captured source lookup follows NFC-resolved metadata and template paths", async () => {
  const fixture = systemFixture({
    metadataDirectory: ".méta", templateFile: "nested/é.md",
    schema: "template: {file: 'nested/é.md'}", fields: "payload: {type: any}",
    template: "payload: !!set {kept: null}",
  });
  expect((await instantiate(fixture)).data.payload).toEqual(new Set(["kept"]));
});

test("a detached context-dependent merge-key alias cannot publish changed data", async () => {
  // The reader treats direct merge keys and aliases to them differently. Until
  // that boundary is resolved, fail closed instead of changing the value.
  const fixture = systemFixture({
    schema: "x_holder: {!!merge &op <<: {}}",
    fields: "payload: {type: any, default_value: {*op : {name: before}}}",
  });
  expect(validateCollection({ collectionRoot: fixture.source, schemaDirectory, mode: "system_definition" }))
    .toMatchObject({ valid: true, evaluation: "complete" });
  await expect(instantiateSystem({ sourceRoot: fixture.source, targetRoot: fixture.target, collectionName: "working", schemaDirectory }))
    .rejects.toThrow("Cannot preserve a merge-key alias");
  expect(existsSync(fixture.target)).toBe(false);
  expect(readdirSync(dirname(fixture.target))).toEqual(["source"]);
});

test("a child default through a merged collection key is actually assigned", async () => {
  const fixture = systemFixture({
    schema: "unknown_field: off",
    fields: "payload: {type: object, fields: {state: {type: text, nullable: true, default_value: ready}}}",
    template: "payload: {!!merge <<: {? [state]: null}}",
  });
  const { data } = await instantiate(fixture);
  expect((data.payload as Record<string, unknown>).state).toBe("ready");
});

function payloadFixture(origin: Origin, payload: string) {
  return systemFixture({
    fields: origin === "local default" ? `payload:\n  type: any\n  default_value:\n${indent(payload, 4)}` : "payload: {type: any}",
    values: origin === "scaffold values" ? `title: Welcome\npayload:\n${indent(payload, 2)}` : undefined,
    template: origin === "template literal" ? `payload:\n${indent(payload, 2)}` : "payload: null",
  });
}

function systemFixture(options: {
  fields: string; values?: string; template?: string; config?: string; schema?: string;
  reuse?: boolean; rootAnchor?: boolean; files?: Record<string, string>;
  metadataDirectory?: string; templateFile?: string;
}) {
  const root = mkdtempSync(join(tmpdir(), "typedmark-scaffold-yaml-"));
  const source = join(root, "source"), target = join(root, "instance");
  const metadata = options.metadataDirectory ?? ".typedmark";
  const files = {
    "typedmark.md": markdown([
      ...(options.rootAnchor ? ["&source_root"] : []),
      "specification_version: 0.1.0",
      `extensions: {typedmark:systems: 0.1.0${options.reuse ? ", typedmark:reuse: 0.1.0" : ""}}`,
      'name: "@example/scaffold-yaml"', "description: YAML value preservation.", "version: 0.1.0",
      ...(options.metadataDirectory ? [`metadata_directory: ${metadata.normalize("NFD")}`] : []),
      ...(options.config ? [options.config] : []),
      "scaffold:", "  notes:", "    - path: Notes/Welcome.md", "      note_type: note", "      values:",
      indent(options.values ?? "title: Welcome", 8),
    ].join("\n"), attribution),
    [`${metadata}/schemas/note.md`]: artifact([
      "note_type: note", "storage: {folder_pattern: Notes, note_name_pattern: '{title}'}",
      ...(options.schema ? [options.schema] : []), "frontmatter:", indent(options.fields, 2),
    ].join("\n")),
    [`${metadata}/templates/${options.templateFile ?? "note.md"}`]: markdown(options.template ?? "title: null", body),
    "LICENSE": "License bytes.\r\n",
    ...options.files,
  };
  for (const [path, bytes] of Object.entries(files)) {
    mkdirSync(dirname(join(source, path)), { recursive: true });
    writeFileSync(join(source, path), bytes);
  }
  fixtures.push({ root, source, bytes: snapshot(source) });
  return { source, target, files };
}

async function instantiate(fixture: ReturnType<typeof systemFixture>) {
  // SCE-42/43/46: require a valid source and target, unchanged source files,
  // exact copies of governed artifacts, and the original Markdown body.
  expect(validateCollection({ collectionRoot: fixture.source, schemaDirectory, mode: "system_definition" }))
    .toMatchObject({ valid: true, evaluation: "complete" });
  const result = await instantiateSystem({ sourceRoot: fixture.source, targetRoot: fixture.target, collectionName: "working-notes", schemaDirectory });
  expect(result.report).toMatchObject({ valid: true, evaluation: "complete" });
  expect(result.validateOffline()).toMatchObject({ valid: true, evaluation: "complete" });
  for (const [path, bytes] of Object.entries(fixture.files)) {
    if (path !== "typedmark.md") expect(readFileSync(join(fixture.target, path))).toEqual(Buffer.from(bytes));
  }
  const config = parseMarkdown(readFileSync(join(fixture.target, "typedmark.md")), { preserveBodyLineEndings: true });
  expect(config.body).toBe(attribution);
  const source = readFileSync(join(fixture.target, "Notes/Welcome.md"), "utf8");
  const note = parseMarkdown(source, { preserveBodyLineEndings: true });
  expect(note.body).toBe(body);
  return { source, data: note.data };
}

function markdown(yaml: string, content = "") {
  return `---\r\n${yaml.replaceAll("\n", "\r\n")}\r\n---\r\n${content}`;
}

function artifact(yaml: string) {
  return markdown(`specification_version: 0.1.0\ndescription: YAML value fixture.\n${yaml}`, "Artifact documentation.  \r\n");
}

function indent(value: string, spaces: number) {
  return value.split("\n").map((line) => " ".repeat(spaces) + line).join("\n");
}

function yamlDocument(source: string, intAsBigInt = false) {
  const lines = source.split(/\r\n?|\n/);
  const end = lines.findIndex((line, index) => index > 0 && (line === "---" || line === "..."));
  const document = parseDocument(lines.slice(1, end).join("\n"), { schema: "core", version: "1.2", resolveKnownTags: true, intAsBigInt });
  expect(document.errors).toEqual([]);
  return document;
}

function snapshot(root: string, prefix = ""): Record<string, string> {
  const contents: Record<string, string> = {};
  for (const entry of readdirSync(join(root, prefix), { withFileTypes: true })) {
    const path = prefix + entry.name;
    if (entry.isDirectory()) Object.assign(contents, snapshot(root, `${path}/`));
    else contents[path] = readFileSync(join(root, path)).toString("base64");
  }
  return contents;
}
