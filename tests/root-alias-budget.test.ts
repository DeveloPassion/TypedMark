import { afterEach, expect, test } from "bun:test";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { parseMarkdown } from "../src/frontmatter";
import { instantiateSystem } from "../src/system";
import { validateCollection } from "../src/validator";

const roots: string[] = [];
const schemaDirectory = resolve(import.meta.dir, "../../TypedMarkSpecification/schema/json-schema");
const sourceIdentity = { name: "@example/source", version: "0.1.0" };
const sourceFields = [
  "specification_version: 0.1.0",
  "extensions: {typedmark:systems: 0.1.0}",
  'name: "@example/source"',
  "description: Source",
  "version: 0.1.0",
  "scaffold: {}",
];
const sharedDag = [
  "x_a: &a {left: first, right: last}",
  "x_b: &b {left: *a, right: *a}",
  "x_c: &c {left: *b, right: *b}",
  "x_d: &d {left: *c, right: *c}",
];

afterEach(() => {
  for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true });
});

// EXT-24/EXT-27 preserve the accepted YAML graph while SCE-151/SCE-47 change
// only the working collection's identity and provenance. These are intended
// success cases for the known E1 gap, using the ordinary guarded reader.
test.each(["late", "early"] as const)(
  "system import preserves a four-level shared vendor DAG with the root alias declared %s",
  async (placement) => {
    // The late variant is the source in system-metadata.test.ts's existing
    // rejection test. The early variant changes only the root alias position.
    const source = markdown([
      "&root",
      ...(placement === "early" ? ["x_root: *root"] : []),
      ...sourceFields,
      ...sharedDag,
      ...(placement === "late" ? ["x_root: *root"] : []),
    ].join("\n"));
    const { config, snapshot } = await importAcceptedSource(source, assertSharedDag);

    assertSharedDag(config);
    assertSharedDag(snapshot);
    for (const key of ["x_a", "x_b", "x_c", "x_d"]) {
      expect(config[key]).toBe(snapshot[key]);
    }
  },
);

test("system import preserves an early root cycle and 98 top-level aliases to opaque mapping and sequence values", async () => {
  const referenceCount = 98;
  const source = markdown([
    "&root",
    "x_root: *root",
    ...sourceFields,
    "x_shared: &shared {panels: [notes, preview], options: {enabled: true, limit: null}}",
    ...Array.from({ length: referenceCount }, (_, index) => `x_vendor_${index}: *shared`),
  ].join("\n"));
  const assertShared = (config: Record<string, unknown>) => {
    const shared = config.x_shared as { panels: string[]; options: { enabled: boolean; limit: null } };
    expect(shared).toEqual({ panels: ["notes", "preview"], options: { enabled: true, limit: null } });
    for (let index = 0; index < referenceCount; index++) {
      const vendor = config[`x_vendor_${index}`] as typeof shared;
      expect(vendor).toBe(shared);
      expect(vendor.panels).toBe(shared.panels);
      expect(vendor.options).toBe(shared.options);
    }
  };
  const { config, snapshot } = await importAcceptedSource(source, assertShared);

  assertShared(config);
  assertShared(snapshot);
  expect(config.x_shared).toBe(snapshot.x_shared);
  const shared = config.x_shared as { panels: string[]; options: Record<string, unknown> };
  const sourceShared = snapshot.x_shared as typeof shared;
  expect(shared.panels).toBe(sourceShared.panels);
  expect(shared.options).toBe(sourceShared.options);
});

test("the reader's default alias guard rejects an over-budget source without publishing a target", async () => {
  // One anchored collection plus 100 references exceeds the default budget.
  // No parser option is changed, and the fixture uses only 100 alias nodes.
  const source = markdown([
    ...sourceFields,
    "x_shared: &shared {panels: [notes, preview]}",
    ...Array.from({ length: 100 }, (_, index) => `x_vendor_${index}: *shared`),
  ].join("\n"));
  const fixture = createSource(source);
  try {
    expect(() => parseMarkdown(source)).toThrow("Excessive alias count");
    expect(validateCollection({ collectionRoot: fixture.sourceRoot, schemaDirectory, mode: "system_definition" })).toMatchObject({ valid: false });
    await expect(instantiateSystem({
      sourceRoot: fixture.sourceRoot,
      targetRoot: fixture.targetRoot,
      collectionName: "working",
      schemaDirectory,
    })).rejects.toThrow("Excessive alias count");
    expect(existsSync(fixture.targetRoot)).toBe(false);
    expect(readdirSync(fixture.targetParent)).toEqual([]);
  } finally {
    assertSourceBytes(fixture);
  }
});

function assertSharedDag(config: Record<string, unknown>): void {
  expect(config.x_a).toEqual({ left: "first", right: "last" });
  for (const [parent, child] of [["x_b", "x_a"], ["x_c", "x_b"], ["x_d", "x_c"]]) {
    const branch = config[parent] as { left: unknown; right: unknown };
    expect(branch.left).toBe(config[child]);
    expect(branch.right).toBe(config[child]);
  }
}

async function importAcceptedSource(source: string, assertGraph: (config: Record<string, unknown>) => void) {
  const fixture = createSource(source);
  try {
    // SCE-42: prove this is an accepted source before requiring import success.
    expect(validateCollection({ collectionRoot: fixture.sourceRoot, schemaDirectory, mode: "system_definition" })).toMatchObject({
      valid: true, evaluation: "complete", results: [],
    });
    const original = parseMarkdown(source).data;
    expect(original.x_root).toBe(original);
    assertGraph(original);

    const result = await instantiateSystem({
      sourceRoot: fixture.sourceRoot,
      targetRoot: fixture.targetRoot,
      collectionName: "working",
      description: "Working collection",
      schemaDirectory,
    });
    expect(result.source).toEqual(sourceIdentity);
    expect(result.report).toMatchObject({ valid: true, evaluation: "complete", results: [] });
    expect(result.validateOffline()).toMatchObject({ valid: true, evaluation: "complete", results: [] });
    const { data: config, body } = parseMarkdown(readFileSync(join(fixture.targetRoot, "typedmark.md")), { preserveBodyLineEndings: true });
    expect(body).toBe("");
    expect(config).toMatchObject({
      specification_version: "0.1.0",
      extensions: { "typedmark:systems": "0.1.0" },
      name: "working",
      description: "Working collection",
      composition: { sources: [sourceIdentity] },
    });
    expect(Object.hasOwn(config, "version")).toBe(false);
    expect(Object.hasOwn(config, "scaffold")).toBe(false);

    const snapshot = config.x_root as Record<string, unknown>;
    expect(snapshot).not.toBe(config);
    expect(snapshot).toMatchObject({
      specification_version: "0.1.0",
      extensions: { "typedmark:systems": "0.1.0" },
      ...sourceIdentity,
      description: "Source",
      scaffold: {},
    });
    expect(snapshot.x_root).toBe(snapshot);
    expect(Object.hasOwn(snapshot, "composition")).toBe(false);
    // SCE-43: the source metadata artifact is also copied byte for byte.
    expect(readFileSync(join(fixture.targetRoot, ".typedmark/schemas/note.md"))).toEqual(Buffer.from(fixture.sources[".typedmark/schemas/note.md"]));
    expect(readdirSync(fixture.targetParent)).toEqual(["instance"]);
    return { config, snapshot };
  } finally {
    assertSourceBytes(fixture);
  }
}

function createSource(source: string) {
  const sourceRoot = createRoot(), targetParent = createRoot(), targetRoot = join(targetParent, "instance");
  const sources = {
    "typedmark.md": source,
    ".typedmark/schemas/note.md": markdown("specification_version: 0.1.0\ndescription: Note\nstorage: {folder_pattern: Notes, note_name_pattern: '{title}'}"),
  };
  for (const [path, bytes] of Object.entries(sources)) {
    mkdirSync(dirname(join(sourceRoot, path)), { recursive: true });
    writeFileSync(join(sourceRoot, path), bytes);
  }
  return { sourceRoot, targetParent, targetRoot, sources };
}

function assertSourceBytes(fixture: ReturnType<typeof createSource>): void {
  for (const [path, source] of Object.entries(fixture.sources)) {
    expect(readFileSync(join(fixture.sourceRoot, path))).toEqual(Buffer.from(source));
  }
}

function createRoot(): string {
  const root = mkdtempSync(join(tmpdir(), "typedmark-root-alias-budget-"));
  roots.push(root);
  return root;
}

function markdown(yaml: string): string {
  return `---\r\n${yaml.replaceAll("\n", "\r\n")}\r\n---\r\n`;
}
