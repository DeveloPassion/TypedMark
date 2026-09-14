import { afterEach, expect, test } from "bun:test";
import { mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { stringify } from "yaml";
import type { CollectionModel, ManagedNote } from "../src/collection-model";
import { buildRelationshipGraph, extractBodyLinks, inspectBodyLinks, parseNoteLink } from "../src/note-links";
import { queryCollection } from "../src/query";
import { SchemaRegistry } from "../src/schema-registry";
import type { ValidationMode } from "../src/types";
import { validateCollection } from "../src/validator";

const sourcePath = "Notes/Source.md";
const relationships = {
  belongs_to: { allowed_note_types: {} }, related_to: { allowed_note_types: { target: {} } },
};

function graphFor(body: string, targetNames = ["N", "N%GG", "N%", "N%2"]) {
  const source: ManagedNote = {
    path: sourcePath, noteType: "source", stored: {}, values: {}, fields: {}, problems: [], body,
  };
  const targets: ManagedNote[] = targetNames.map((name) => ({
    path: `Notes/${name}.md`, noteType: "target", stored: {}, values: {}, fields: {}, problems: [], body: "",
  }));
  const notes = [source, ...targets];
  const model = {
    notes, documents: notes, assets: new Set<string>(), schemas: new Map([
      ["source", { relationships }], ["target", {}],
    ]),
  } as unknown as CollectionModel;
  return buildRelationshipGraph(model, (actual, requested) => actual === requested);
}

// NL-6 covers the interpreted URI, including its fragment. A malformed
// percent triplet is neither a nonexistent target nor an absent body link.
const malformedDestinations = [
  "N%GG.md", "N%.md", "N%2.md", "N%2G.md", "N%G2.md",
  "N&percnt;GG.md", "N&#37;GG.md", "N&#x25;GG.md", "N\\%GG.md",
  "N.md#bad%GG", "N.md#bad%", "N.md#bad%2",
  "N.md#bad&percnt;GG", "N.md&#35;bad&#37;GG", "N.md&num;bad&#x25;GG",
];

test.each(malformedDestinations)("records NL-6 and creates no edge for body destination %s", (destination) => {
  for (const raw of [`[label](${destination})`, `![label](<${destination}> 'title')`]) {
    const graph = graphFor(`Before ${raw} after.`);
    expect({
      rules: graph.failures.get(sourcePath)?.map((failure) => failure.rule_id) ?? [],
      targets: [...graph.targets.get(sourcePath)!.related_to],
    }).toEqual({ rules: ["NL-6"], targets: [] });
  }
});

test("continues extracting neighboring and nested valid links after a malformed destination", () => {
  const graph = graphFor("[![nested](N.md)](N%GG.md) [also valid](N%25GG.md) [bad fragment](N.md#bad%)");
  expect(graph.failures.get(sourcePath)?.map((failure) => failure.rule_id)).toEqual(["NL-6", "NL-6"]);
  expect(graph.targets.get(sourcePath)!.related_to).toEqual(new Set(["Notes/N.md", "Notes/N%GG.md"]));
});

test.each([
  "https://example.com/%GG", "https&#58;//example.com/%", "mailto&colon;reader%2@example.com",
  "custom&#43;v1&colon;bad%GG#bad%2", "&#104;ttps://example.com/#bad&percnt;GG",
])("keeps malformed percent spelling in external destinations outside note-link validation: %s", (destination) => {
  const body = `[external](${destination}) ![external](<${destination}>)`;
  expect(parseNoteLink(`[external](${destination})`)).toBeUndefined();
  expect(extractBodyLinks(body)).toEqual([]);
  const graph = graphFor(body);
  expect(graph.failures.size).toBe(0);
  expect(graph.targets.get(sourcePath)!.related_to.size).toBe(0);
});

test.each([
  { destination: "N%25GG.md", target: "N%GG.md" },
  { destination: "N&percnt;25GG.md", target: "N%GG.md" },
  { destination: "N&#37;25GG.md", target: "N%GG.md" },
  { destination: "N&#x25;25GG.md", target: "N%GG.md" },
  { destination: "N&percnt;&#x34;&#49;.md", target: "NA.md" },
  { destination: "N&amp;percnt;GG.md", target: "N&percnt;GG.md" },
  { destination: "N\\&percnt;GG.md", target: "N&percnt;GG.md" },
  { destination: "N%26percnt%3BGG.md", target: "N&percnt;GG.md" },
])("validates percent spelling before its single decoding pass: $destination", ({ destination, target }) => {
  const raw = `[bad%GG label](${destination} "bad%GG title")`;
  expect(parseNoteLink(raw)).toMatchObject({ raw, form: "markdown", target });
  const graph = graphFor(raw, [target.slice(0, -3)]);
  expect(graph.failures.size).toBe(0);
  expect(graph.targets.get(sourcePath)!.related_to).toEqual(new Set([`Notes/${target}`]));
});

test("preserves physical source bytes around a valid encoded percent in a multiline embed", () => {
  const prefix = "🧭 Before\r\n\r\n> ";
  const physical = "![first\r\n> second](<N&percnt;25GG.md#bad%25GG> 'title%GG')";
  const body = prefix + physical + " after.";
  expect(extractBodyLinks(body)).toEqual([expect.objectContaining({
    target: "N%GG.md", anchor: "bad%25GG", embed: true,
    source: { start: prefix.length, end: prefix.length + physical.length, raw: physical },
  })]);
});

test("body inspection locates invalid destinations without losing nested valid links", () => {
  const prefix = "🧭 Before\r\n\r\n> ";
  const physical = "[first\r\n> ![nested](N.md)](<N.md#bad&percnt;GG>)";
  const body = prefix + physical + " [last](N%25GG.md).";
  const inspected = inspectBodyLinks(body);
  expect(inspected.failures).toHaveLength(1);
  expect(inspected.failures[0]).toMatchObject({
    raw: "[first\n![nested](N.md)](<N.md#bad&percnt;GG>)",
    source: { start: prefix.length, end: prefix.length + physical.length, raw: physical },
    error: { rule_id: "NL-6" },
  });
  expect(inspected.links.map((link) => link.target)).toEqual(["N.md", "N%GG.md"]);
  for (const value of [...inspected.links, ...inspected.failures]) {
    expect(body.slice(value.source.start, value.source.end)).toBe(value.source.raw);
  }
  expect(extractBodyLinks(body)).toEqual(inspected.links);
});

test.each(["N%GG.md", "N.md#bad%"])("frontmatter graph failures retain the URI rule and field context: %s", (destination) => {
  const value = `[label](${destination})`;
  expect(parseNoteLink(value)).toBeUndefined();
  const source: ManagedNote = {
    path: sourcePath, noteType: "source", body: "", problems: [],
    stored: { reference: value }, values: { reference: value },
    fields: { reference: { type: "link", format: "note_link", relationship_kind: "related_to" } },
  };
  const model = { notes: [source], documents: [source], assets: new Set<string>(),
    schemas: new Map([["source", { relationships }]]) } as unknown as CollectionModel;
  const graph = buildRelationshipGraph(model, (actual, requested) => actual === requested);
  expect(graph.failures.get(sourcePath)).toEqual([expect.objectContaining({ rule_id: "NL-6", field: "reference" })]);
  expect(graph.targets.get(sourcePath)!.related_to.size).toBe(0);
});

test.each(["N%GG", "N%", "N%2", "N&percnt;GG"])("keeps malformed URI-looking wikilinks literal: %s", (target) => {
  const raw = `![[${target}#bad%GG|label]]`;
  expect(parseNoteLink(raw)).toMatchObject({ raw, form: "wikilink", target, anchor: "bad%GG", embed: true });
  const graph = graphFor(raw, [target]);
  expect(graph.failures.size).toBe(0);
  expect(graph.targets.get(sourcePath)!.related_to).toEqual(new Set([`Notes/${target}.md`]));
});

test.each([
  "`[bad](N%GG.md) [bad](N.md#bad%)`",
  "```md\n[bad](N%GG.md) [bad](N.md#bad%)\n```",
  "~~~md\n[bad](N%GG.md) [bad](N.md#bad%)\n~~~",
  "    [bad](N%GG.md) [bad](N.md#bad%)",
  "\\[bad](N%GG.md) \\[bad](N.md#bad%)",
  '<!-- typedmark:expansion {"id":"[bad](N%GG.md)","item":"[bad](N.md#bad%)"} -->\n<!-- /typedmark:expansion -->',
  '<!-- typedmark:template-region {"id":"[bad](N%GG.md)","item":"[bad](N.md#bad%)"} -->\n<!-- /typedmark:template-region -->',
])("does not validate malformed URI spelling inside an excluded body region: %j", (body) => {
  expect(extractBodyLinks(body)).toEqual([]);
  const graph = graphFor(body);
  expect(graph.failures.size).toBe(0);
  expect(graph.targets.get(sourcePath)!.related_to.size).toBe(0);
});

const schemaDirectory = resolve(import.meta.dir, "../../TypedMarkSpecification/schema/json-schema");
const registry = new SchemaRegistry(schemaDirectory);
const roots: string[] = [];

function writeNote(root: string, path: string, data: Record<string, unknown>, body = "") {
  mkdirSync(dirname(join(root, path)), { recursive: true });
  writeFileSync(join(root, path), `\uFEFF---\n# Preserve authored bytes.\n${stringify(data)}---\n${body}`.replaceAll("\n", "\r\n"));
}

function collection(body: string, config: Record<string, unknown> = {}) {
  const root = mkdtempSync(join(tmpdir(), "typedmark-note-link-uri-"));
  roots.push(root);
  writeNote(root, "typedmark.md", {
    specification_version: "0.1.0", name: "note-link-uri", description: "URI validation tests.", ...config,
  }, "Artifact prose [ignored](N%GG.md).\n");
  for (const noteType of ["source", "target"]) {
    writeNote(root, `.typedmark/schemas/${noteType}.md`, {
      specification_version: "0.1.0", description: `${noteType} notes.`,
      storage: { folder_pattern: "Notes", note_name_pattern: "{title}" },
      ...(noteType === "source" ? { relationships } : {}),
    });
  }
  writeNote(root, sourcePath, { note_type: "source" }, body);
  for (const name of ["N", "N%GG"]) writeNote(root, `Notes/${name}.md`, { note_type: "target" });
  return root;
}

function sourceTree(root: string, prefix = ""): Array<{ path: string; content: Buffer | null }> {
  return readdirSync(join(root, prefix), { withFileTypes: true }).sort((left, right) => left.name.localeCompare(right.name))
    .flatMap((entry) => {
      const path = prefix + entry.name;
      return entry.isDirectory()
        ? [{ path, content: null }, ...sourceTree(root, `${path}/`)]
        : [{ path, content: readFileSync(join(root, path)) }];
    });
}

function validate(root: string, mode: ValidationMode = "instantiated_collection") {
  const before = sourceTree(root);
  try {
    const report = validateCollection({ collectionRoot: root, schemaDirectory, mode });
    expect(registry.validate("validation-report.schema.json", report)).toEqual([]);
    return report;
  } finally { expect(sourceTree(root)).toEqual(before); }
}

afterEach(() => { for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true }); });

test("reports malformed body destination spellings as portable NL-6 findings without rewriting source", () => {
  const report = validate(collection("🧭 [path](N%GG.md)\n\n> ![entity](<N&percnt;GG.md>)\n\n[fragment](N.md#bad%2)\n"));
  expect(report).toMatchObject({ valid: false, evaluation: "complete" });
  expect(report.results).toEqual(Array.from({ length: 3 }, () => expect.objectContaining({
    code: "invalid_note_link", rule_id: "NL-6", path: sourcePath, note_type: "source", severity: "error",
  })));
  for (const finding of report.results) expect(finding).not.toHaveProperty("field");
});

test.each(["warn", "off"])("%s severity cannot unlock a query that depends on invalid body links", (severity) => {
  const root = collection("[invalid](N%GG.md) [invalid fragment](N.md#bad%GG)", {
    validation_defaults: { invalid_note_link: severity },
  });
  const report = validate(root);
  expect(report).toMatchObject({ valid: true, evaluation: "complete" });
  expect(report.results).toEqual(severity === "off" ? [] : Array.from({ length: 2 }, () => expect.objectContaining({
    code: "invalid_note_link", rule_id: "NL-6", path: sourcePath, severity,
  })));

  const before = sourceTree(root);
  try {
    const input = { collectionRoot: root, schemaDirectory, queryVersion: "0.1.0" };
    expect(() => queryCollection({ ...input, query: {
      specification_version: "0.1.0", note_types: ["source"], select: [{ kind: "path", as: "path" }],
      where: { kind: "relationship", relationship: "related_to", count: { min: 1 } },
    } })).toThrow("CM-307: NL-6:");
    expect(queryCollection({ ...input, query: {
      specification_version: "0.1.0", note_types: ["target"], select: [{ kind: "path", as: "path" }],
    } }).rows).toHaveLength(2);
  } finally { expect(sourceTree(root)).toEqual(before); }
});

test("checks malformed live-note destinations in both mode while definition mode remains artifact-only", () => {
  const root = collection("[invalid](N.md#bad%)", {
    version: "1.0.0", extensions: { "typedmark:systems": "0.1.0" },
    scaffold: { notes: [{ path: "Notes/Starter.md", note_type: "target" }] },
  });
  expect(validate(root, "system_definition")).toMatchObject({ valid: true, evaluation: "complete", results: [] });
  expect(validate(root, "both")).toMatchObject({ valid: false, evaluation: "complete", results: [expect.objectContaining({
    code: "invalid_note_link", rule_id: "NL-6", path: sourcePath,
  })] });
});
