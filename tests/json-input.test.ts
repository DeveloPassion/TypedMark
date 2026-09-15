import { afterEach, expect, test } from "bun:test";
import { cpSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { basename, dirname, join, resolve } from "node:path";
import { stringify } from "yaml";
import { runConformanceVector, type VectorRunResult } from "../src/adapter";
import { queryCollection, QueryError } from "../src/query";
import { runQueryCases, type QueryCaseResult } from "../src/query-vectors";
import { SchemaRegistry } from "../src/schema-registry";
import { readVectorContext } from "../src/vector-context";
import { checkMigrationReadiness } from "../src/system";
import type { ValidationReport } from "../src/types";

const specificationRoot = resolve(import.meta.dir, "../../TypedMarkSpecification");
const schemaDirectory = join(specificationRoot, "schema/json-schema");
const cliPath = join(import.meta.dir, "../src/cli.ts");
const unicode = "caf\u00e9 \u{1f642} \ufffd";
const marker = "REPLACE_WITH_RAW_BYTES";
const roots: string[] = [];

function temporaryRoot(): string {
  const root = mkdtempSync(join(tmpdir(), "typedmark-json-input-"));
  roots.push(root);
  return root;
}

afterEach(() => {
  for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true });
});

function writeMarkdown(root: string, path: string, data: unknown): void {
  const file = join(root, path);
  mkdirSync(dirname(file), { recursive: true });
  writeFileSync(file, `---\n${stringify(data)}---\n`);
}

function collection(root: string, status = unicode): string {
  const path = join(root, "collection");
  writeMarkdown(path, "typedmark.md", {
    specification_version: "0.1.0", name: "json-input", description: "JSON input tests.",
  });
  writeMarkdown(path, ".typedmark/schemas/note.md", {
    specification_version: "0.1.0", description: "Note.",
    storage: { folder_pattern: "Notes", note_name_pattern: "{title}" },
    frontmatter: { status: { type: "text" } },
  });
  writeMarkdown(path, "Notes/One.md", { note_type: "note", status });
  return path;
}

function query(value = unicode) {
  return {
    specification_version: "0.1.0",
    select: [{ kind: "field", field: "status", as: "status" }],
    where: { kind: "field", field: "status", operator: "equals", value },
  };
}

function queryCases(expectedValue = unicode) {
  return [{
    name: "unicode-value", query_version: "0.1.0", rules: ["CM-331"], query: query(),
    expected_result: { evaluation: "complete", rows: [{ status: expectedValue }] },
  }];
}

function rawJson(value: unknown, bytes: readonly number[]): Buffer {
  const json = JSON.stringify(value);
  const offset = json.indexOf(marker);
  if (offset < 0 || json.indexOf(marker, offset + marker.length) >= 0) throw new Error("Expected one byte marker");
  return Buffer.concat([
    Buffer.from(json.slice(0, offset)), Buffer.from(bytes), Buffer.from(json.slice(offset + marker.length)),
  ]);
}

function snapshot(root: string): Array<[string, string]> {
  const files: Array<[string, string]> = [];
  function visit(directory: string, prefix = ""): void {
    for (const entry of readdirSync(directory, { withFileTypes: true })) {
      const path = join(directory, entry.name);
      const relative = `${prefix}${entry.name}`;
      if (entry.isDirectory()) visit(path, `${relative}/`);
      else files.push([relative, readFileSync(path).toString("base64")]);
    }
  }
  visit(root);
  return files.sort(([a], [b]) => a < b ? -1 : a > b ? 1 : 0);
}

async function withoutWrites<T>(root: string, operation: () => T | Promise<T>): Promise<T> {
  const before = snapshot(root);
  try { return await operation(); }
  finally { expect(snapshot(root)).toEqual(before); }
}

async function rejection(root: string, operation: () => unknown): Promise<Error> {
  let caught: unknown;
  await withoutWrites(root, async () => {
    try { await operation(); }
    catch (error) { caught = error; }
  });
  expect(caught).toBeInstanceOf(Error);
  return caught as Error;
}

async function expectUtf8Failure(fixture: ApiFixture): Promise<void> {
  const error = await rejection(fixture.root, fixture.run);
  expect(error).not.toBeInstanceOf(QueryError);
  expect(error.message).toMatch(/UTF-?8/i);
  expect(error.message).toContain(basename(fixture.path));
}

function cli(collectionRoot: string, path: string) {
  return Bun.spawnSync([
    process.execPath, cliPath, "query", collectionRoot, "--query", path,
    "--query-version", "0.1.0", "--schemas", schemaDirectory,
  ], { stdout: "pipe", stderr: "pipe" });
}

type ApiSurface = "expected report" | "query cases" | "vector context" | "schema registry";
interface ApiFixture {
  root: string;
  path: string;
  run: () => unknown;
}

function apiFixture(surface: ApiSurface): ApiFixture {
  const root = temporaryRoot();
  if (surface === "expected report") {
    cpSync(join(specificationRoot, "schema/fixtures/golden/core-invalid-field-value"), root, { recursive: true });
    return {
      root, path: join(root, "expected-validation-report.json"),
      run: () => runConformanceVector({ vectorDirectory: root, schemaDirectory }),
    };
  }
  if (surface === "schema registry") {
    const path = join(root, "unicode.schema.json");
    writeFileSync(path, JSON.stringify({ $id: "https://example.test/unicode.schema.json", type: "string", enum: [unicode] }));
    return { root, path, run: () => new SchemaRegistry(root) };
  }
  const registry = new SchemaRegistry(schemaDirectory);
  if (surface === "vector context") {
    const path = join(root, "vector.json");
    writeFileSync(path, "{}");
    return { root, path, run: () => readVectorContext(root, registry) };
  }
  const collectionRoot = collection(root);
  const path = join(root, "query-cases.json");
  writeFileSync(path, JSON.stringify(queryCases()));
  return {
    root, path,
    run: () => runQueryCases(root, collectionRoot, schemaDirectory, { "typedmark:queries": "0.1.0" }, registry),
  };
}

test.each([
  { name: "a lone continuation byte", bytes: [0x80] },
  { name: "an overlong sequence", bytes: [0xc0, 0xaf] },
  { name: "an encoded surrogate", bytes: [0xed, 0xa0, 0x80] },
  { name: "a code point above U+10FFFF", bytes: [0xf4, 0x90, 0x80, 0x80] },
  { name: "an incomplete multibyte sequence", bytes: [0xe2, 0x82] },
])("the query CLI rejects $name before it can match repaired predicate text", async ({ bytes }) => {
  const root = temporaryRoot();
  // The valid stored text deliberately matches what a lossy byte decoder produces.
  const collectionRoot = collection(root, Buffer.from(bytes).toString("utf8"));
  const path = join(root, "requested query.json");
  writeFileSync(path, rawJson(query(marker), bytes));
  const result = await withoutWrites(root, () => cli(collectionRoot, path));
  expect(result.stderr.toString()).toMatch(/UTF-?8/i);
  expect(result.stderr.toString()).toContain(basename(path));
  expect(result.exitCode).not.toBe(0);
  expect(result.stdout.toString()).toBe("");
  expect(result.stderr.toString()).not.toContain('"rule_id"');
});

test("the query CLI rejects malformed bytes in a mapped-column label even when rows are otherwise valid", async () => {
  const root = temporaryRoot();
  const collectionRoot = collection(root);
  const path = join(root, "label-query.json");
  const descriptor = {
    specification_version: "0.1.0",
    select: [{ kind: "mapped_field", as: "status", definition: { type: "text", label: marker },
      sources: [{ note_types: ["note"], field: "status" }] }],
  };
  writeFileSync(path, rawJson(descriptor, [0xff]));
  const result = await withoutWrites(root, () => cli(collectionRoot, path));
  expect(result.stderr.toString()).toMatch(/UTF-?8/i);
  expect(result.stderr.toString()).toContain(basename(path));
  expect(result.exitCode).not.toBe(0);
  expect(result.stdout.toString()).toBe("");
  expect(result.stderr.toString()).not.toContain('"rule_id"');
});

test("expected-report messages cannot hide malformed bytes behind a passing vector comparison", async () => {
  const fixture = apiFixture("expected report");
  const report = JSON.parse(readFileSync(fixture.path, "utf8")) as ValidationReport;
  report.results[0]!.message = marker;
  writeFileSync(fixture.path, rawJson(report, [0xff]));
  await expectUtf8Failure(fixture);
});

test("query-case expected rows cannot be repaired into passing evidence", async () => {
  const fixture = apiFixture("query cases");
  writeFileSync(fixture.path, rawJson(queryCases(marker), [...Buffer.from("caf\u00e9 \u{1f642} "), 0x80]));
  await expectUtf8Failure(fixture);
});

test("vector context rejects malformed bytes before extension-name shape checks", async () => {
  const fixture = apiFixture("vector context");
  writeFileSync(fixture.path, rawJson({ disabled_extensions: [`typedmark:${marker}`] }, [0xed, 0xa0, 0x80]));
  await expectUtf8Failure(fixture);
});

test("schema registration cannot repair malformed enum strings into accepted values", async () => {
  const fixture = apiFixture("schema registry");
  writeFileSync(fixture.path, rawJson({ $id: "https://example.test/unicode.schema.json", type: "string", enum: [marker] }, [0xc0, 0xaf]));
  await expectUtf8Failure(fixture);
});

test("truncated UTF-8 at end of input is rejected before JSON syntax interpretation", async () => {
  const fixture = apiFixture("vector context");
  writeFileSync(fixture.path, Buffer.concat([Buffer.from('{"disabled_extensions":["typedmark:'), Buffer.from([0xf0, 0x9f])]));
  await expectUtf8Failure(fixture);
});

test.each<ApiSurface>(["expected report", "query cases", "vector context", "schema registry"])(
  "%s retains JSON SyntaxError behavior for a leading BOM and malformed JSON text", async (surface) => {
    const fixture = apiFixture(surface);
    const original = readFileSync(fixture.path);
    await withoutWrites(fixture.root, fixture.run);
    for (const bytes of [Buffer.concat([Buffer.from([0xef, 0xbb, 0xbf]), original]), Buffer.from('{"unfinished":')]) {
      writeFileSync(fixture.path, bytes);
      const error = await rejection(fixture.root, fixture.run);
      expect(error).toBeInstanceOf(SyntaxError);
      expect(error.message).not.toMatch(/UTF-?8/i);
    }
  },
);

test("the query CLI retains JSON syntax failure for a leading BOM and malformed JSON text", async () => {
  const root = temporaryRoot();
  const collectionRoot = collection(root);
  const path = join(root, "syntax-query.json");
  for (const text of [`\ufeff${JSON.stringify(query())}`, '{"unfinished":']) {
    writeFileSync(path, text);
    const result = await withoutWrites(root, () => cli(collectionRoot, path));
    expect(result.exitCode).not.toBe(0);
    expect(result.stdout.toString()).toBe("");
    expect(result.stderr.toString()).toContain("SyntaxError");
    expect(result.stderr.toString()).not.toContain('"rule_id"');
  }
});

test.each([
  { surface: "expected report" as const, input: {}, message: "Expected report violates validation-report.schema.json" },
  { surface: "query cases" as const, input: {}, message: "Invalid query cases" },
  { surface: "vector context" as const, input: { disabled_extensions: [] }, message: "invalid negotiation context" },
  { surface: "schema registry" as const, input: { $id: "https://example.test/unicode.schema.json", type: 42 }, message: "schema is invalid" },
])("valid UTF-8 with invalid $surface shape retains its existing failure", async ({ surface, input, message }) => {
  const fixture = apiFixture(surface);
  writeFileSync(fixture.path, JSON.stringify(input));
  const error = await rejection(fixture.root, fixture.run);
  expect(error.message).toContain(message);
  expect(error.message).not.toMatch(/UTF-?8/i);
  expect(error).not.toBeInstanceOf(SyntaxError);
});

test("the query CLI retains semantic shape errors for valid UTF-8 JSON", async () => {
  const root = temporaryRoot();
  const collectionRoot = collection(root);
  const path = join(root, "shape-query.json");
  writeFileSync(path, "{}");
  const result = await withoutWrites(root, () => cli(collectionRoot, path));
  expect(result.exitCode).toBe(1);
  expect(result.stdout.toString()).toBe("");
  expect(JSON.parse(result.stderr.toString())).toMatchObject({ rule_id: "CM-301" });
});

test("the CLI and in-memory query API preserve valid encoded U+FFFD and other Unicode", async () => {
  const root = temporaryRoot();
  const collectionRoot = collection(root);
  const descriptor = query();
  const before = structuredClone(descriptor);
  const path = join(root, "unicode-query.json");
  writeFileSync(path, JSON.stringify(descriptor));
  const result = await withoutWrites(root, () => cli(collectionRoot, path));
  expect(result.exitCode, result.stderr.toString()).toBe(0);
  expect(result.stderr.toString()).toBe("");
  expect(JSON.parse(result.stdout.toString()).rows).toEqual([{ status: unicode }]);
  const inMemory = await withoutWrites(root, () => queryCollection({
    collectionRoot, schemaDirectory, queryVersion: "0.1.0", query: descriptor,
  }));
  expect(inMemory.rows).toEqual([{ status: unicode }]);
  expect(descriptor).toEqual(before);
});

test("expected-report messages preserve valid U+FFFD and Unicode while comparison remains message-independent", async () => {
  const fixture = apiFixture("expected report");
  const report = JSON.parse(readFileSync(fixture.path, "utf8")) as ValidationReport;
  report.results[0]!.message = unicode;
  writeFileSync(fixture.path, JSON.stringify(report));
  const result = await withoutWrites(fixture.root, fixture.run) as VectorRunResult;
  expect(result.expected.results[0]!.message).toBe(unicode);
  expect(result.differences).toEqual([]);
  expect(result.collectionChanged).toBe(false);
});

test("query cases preserve valid U+FFFD and Unicode in expected and actual rows", async () => {
  const fixture = apiFixture("query cases");
  const result = await withoutWrites(fixture.root, fixture.run) as QueryCaseResult[];
  expect(result).toHaveLength(1);
  expect(result[0]).toMatchObject({ status: "passed", differences: [], actual_result: { rows: [{ status: unicode }] } });
});

test("schema registration preserves valid U+FFFD and Unicode enum values exactly", async () => {
  const fixture = apiFixture("schema registry");
  const registry = await withoutWrites(fixture.root, fixture.run) as SchemaRegistry;
  expect(registry.validate("unicode.schema.json", unicode)).toEqual([]);
  expect(registry.validate("unicode.schema.json", unicode.replace("\ufffd", ""))).not.toEqual([]);
});

test("migration readiness preserves its fail-closed adapter for an unreadable schema", async () => {
  const root = temporaryRoot();
  const systemRoot = collection(root);
  writeMarkdown(systemRoot, "typedmark.md", {
    specification_version: "0.1.0", name: "json-input", description: "Readiness input.",
    extensions: { "typedmark:systems": "0.1.0" }, version: "0.1.0", scaffold: {},
  });
  const schemas = join(root, "schemas");
  cpSync(schemaDirectory, schemas, { recursive: true });
  const input = { systemRoot, fromVersion: "0.1.0", schemaDirectory: schemas };
  expect(await withoutWrites(root, () => checkMigrationReadiness(input))).toEqual({ status: "ready", reasons: [] });
  const path = join(schemas, "typedmark.schema.json");
  const schema = JSON.parse(readFileSync(path, "utf8"));
  schema.title = marker;
  writeFileSync(path, rawJson(schema, [0xff]));
  await expectUtf8Failure({ root, path, run: () => new SchemaRegistry(schemas) });
  expect(await withoutWrites(root, () => checkMigrationReadiness(input))).toEqual({
    status: "manual_resolution_required",
    reasons: ["The target system could not be read as a stable, interpretable snapshot."],
  });
});
