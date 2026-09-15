import { afterEach, expect, test } from "bun:test";
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { stringify } from "yaml";
import type { CollectionModel, ManagedNote } from "../src/collection-model";
import { buildRelationshipGraph, inspectBodyLinks, parseNoteLink } from "../src/note-links";
import { SchemaRegistry } from "../src/schema-registry";
import { validateCollection } from "../src/validator";

const sourcePath = "Notes/Source.md";

// NL-6 checks the interpreted, pre-percent-decoding relative reference.
// Each example below is recognized as an inline link by the pinned parser.
const invalidDestinations = [
  "N note.md", "N\t.md", "N\u0001.md", "N\u007f.md", "Café.md", "N📝.md",
  "N|draft.md", "N{draft}.md", "N[draft].md", "N\\x.md", 'N".md', "N`.md",
  "N&#32;note.md", "N&#x9;note.md", "N&#10;note.md", "N&#13;note.md",
  "N&vert;draft.md", "N&lbrace;draft&rbrace;.md", "N&#x1F4DD;.md",
  "N\\|draft.md", "N\\[draft\\].md", "N&bsol;x.md", "N&lt;draft&gt;.md",
  "%68ttps:foo", "1note:part", ".note:part", "&#8490;:note", "&#383;cheme:note",
  "N.md?tag=one two", "N.md?tag=[draft]", "N.md?tag={draft}", "N.md?tag=é",
  "//example.test/N[draft].md", "//[2001:db8::1]/N.md?tag=[draft]", "//user[draft]@example.test/N.md",
];

test.each(invalidDestinations)("retains an NL-6 failure for a recognized unencoded target: %j", (destination) => {
  for (const prefix of ["", "!"]) {
    const raw = `${prefix}[label](<${destination}>)`;
    expect(parseNoteLink(raw)).toBeUndefined();
    const inspected = inspectBodyLinks(raw);
    expect(inspected.links).toEqual([]);
    expect(inspected.failures).toEqual([expect.objectContaining({
      raw, source: { start: 0, end: raw.length, raw }, error: expect.objectContaining({ rule_id: "NL-6" }),
    })]);
  }
});

test.each([
  { destination: "N%20note.md", target: "N note.md" },
  { destination: "N%09%01%7F.md", target: "N\t\u0001\u007f.md" },
  { destination: "Caf%C3%A9.md", target: "Café.md" },
  { destination: "N%F0%9F%93%9D.md", target: "N📝.md" },
  { destination: "N%7Cdraft.md", target: "N|draft.md" },
  { destination: "N%7Bdraft%7D.md", target: "N{draft}.md" },
  { destination: "N%5Bdraft%5D.md", target: "N[draft].md" },
  { destination: "N%5Cx.md", target: "N\\x.md" },
  { destination: "N%22%60%3C%3E.md", target: 'N"`<>.md' },
  { destination: "%68ttps%3Afoo", target: "https:foo" },
  { destination: "N%2520.md", target: "N%20.md" },
  { destination: "N%25GG.md", target: "N%GG.md" },
  { destination: "N%23draft.md", target: "N#draft.md" },
  { destination: "N&percnt;20note.md", target: "N note.md" },
  { destination: "N&#37;7Cdraft.md", target: "N|draft.md" },
  { destination: "N.md?tag=%5Bdraft%5D%20%C3%A9", target: "N.md?tag=[draft] é" },
])("accepts encoded target data without revalidating the decoded spelling: $destination", ({ destination, target }) => {
  const raw = `[label](${destination})`;
  expect(parseNoteLink(raw)).toEqual({ raw, form: "markdown", target, displayText: "label", embed: false });
  expect(inspectBodyLinks(raw).failures).toEqual([]);
});

test.each([
  "", "N-._~!$&'()*+,;=@.md", "/N:part.md", "./N:part.md", "../N:part.md", "Notes/N:part.md",
  "N\\(part\\).md", "N&amp;Co.md", "N\\&period;md", "N&amp;period;md", "https\\&colon;foo", "https&amp;colon;foo",
  "N.md?tag=a/b?c:d@e;f!g$h&i'j(k)*l+m,n=op", "?q=path:part/@value?extra",
  "//example.test/N.md", "//user:password@example.test:8080/N.md",
  "//[2001:db8::1]/N.md", "//[::ffff:192.0.2.1]:8080/N.md", "//[v1.a:b]/N.md",
])("keeps valid relative-reference punctuation and authority syntax: %j", (destination) => {
  const raw = `[label](<${destination}>)`;
  expect(parseNoteLink(raw)).toBeDefined();
  expect(inspectBodyLinks(raw).failures).toEqual([]);
});

test("leaves authored labels and encoded fragments intact during URI syntax checks", () => {
  const raw = "![a\\[b\\] &amp; 📝](<N%20note.md&num;Head%20%7Bdraft%7D%7C%5Bx%5D\\!&amp;Tail> 'title with spaces')";
  expect(parseNoteLink(raw)).toEqual({
    raw, form: "markdown", target: "N note.md", embed: true,
    displayText: "a\\[b\\] &amp; 📝", anchor: "Head%20%7Bdraft%7D%7C%5Bx%5D\\!&amp;Tail",
  });
  expect(inspectBodyLinks(raw).failures).toEqual([]);
});

test("retains physical spans and neighboring links when a multiline outer target is invalid", () => {
  const prefix = "🧭 Before\r\n\r\n> ";
  const physical = "[first &amp;\r\n> ![nested](N%20note.md)](<N&#32;note.md#Head&amp;Tail>)";
  const last = "[last](N%7Cdraft.md)";
  const body = prefix + physical + " " + last;
  const inspected = inspectBodyLinks(body);
  expect(inspected.failures).toEqual([expect.objectContaining({
    raw: "[first &amp;\n![nested](N%20note.md)](<N&#32;note.md#Head&amp;Tail>)",
    source: { start: prefix.length, end: prefix.length + physical.length, raw: physical },
    error: expect.objectContaining({ rule_id: "NL-6" }),
  })]);
  expect(inspected.links.map((link) => ({ target: link.target, embed: link.embed }))).toEqual([
    { target: "N note.md", embed: true }, { target: "N|draft.md", embed: false },
  ]);
  for (const entry of [...inspected.links, ...inspected.failures]) {
    expect(body.slice(entry.source.start, entry.source.end)).toBe(entry.source.raw);
  }
  expect(inspected.links[1]!.source).toEqual({
    start: prefix.length + physical.length + 1, end: body.length, raw: last,
  });
});

function graphFor(body: string, reference?: string) {
  const source: ManagedNote = {
    path: sourcePath, noteType: "source", body, problems: [],
    stored: reference === undefined ? {} : { reference }, values: reference === undefined ? {} : { reference },
    fields: reference === undefined ? {} : { reference: { type: "link", format: "note_link", relationship_kind: "belongs_to", validate_exists: true } },
  };
  const targets: ManagedNote[] = ["N note", "N|draft", "Café", "N{draft}", "N\\x", "%68ttps:foo"].map((name) => ({
    path: `Notes/${name}.md`, noteType: reference !== undefined && name === "N note" ? "parent" : "target", stored: {}, values: {}, fields: {}, body: "", problems: [],
  }));
  const notes = [source, ...targets];
  const model = { notes, documents: notes, assets: new Set<string>(), schemas: new Map([
    ["source", { relationships: {
      belongs_to: { allowed_note_types: { parent: {} } }, related_to: { allowed_note_types: { target: {} } },
    } }], ["target", {}], ["parent", {}],
  ]) } as unknown as CollectionModel;
  return buildRelationshipGraph(model, (actual, requested) => actual === requested);
}

test("unencoded field and body targets create failures even when matching managed notes exist", () => {
  const graph = graphFor("[body](N|draft.md)", "[field](<N note.md>)");
  expect(graph.targets.get(sourcePath)).toEqual({ belongs_to: new Set(), related_to: new Set() });
  expect(graph.failures.get(sourcePath)).toEqual([
    expect.objectContaining({ rule_id: "NL-6", field: "reference" }),
    expect.objectContaining({ rule_id: "NL-6", field: undefined }),
  ]);
});

test("encoded equivalents create field and body relationships to the exact decoded note paths", () => {
  const graph = graphFor("![body](N%7Cdraft.md)", "[field](N%20note.md)");
  expect(graph.failures.size).toBe(0);
  expect(graph.targets.get(sourcePath)).toEqual({
    belongs_to: new Set(["Notes/N note.md"]), related_to: new Set(["Notes/N|draft.md"]),
  });
});

test.each(["N note", "Café", "N{draft}", "N\\x", "%68ttps:foo"])(
  "wikilinks keep target spelling literal outside the Markdown encoding contract: %j", (target) => {
    const raw = `![[${target}#Heading {draft}|label]]`;
    expect(parseNoteLink(raw)).toEqual({
      raw, form: "wikilink", target, anchor: "Heading {draft}", displayText: "label", embed: true,
    });
    const graph = graphFor(raw);
    expect(graph.failures.size).toBe(0);
    expect(graph.targets.get(sourcePath)!.related_to).toEqual(new Set([`Notes/${target}.md`]));
  },
);

test.each([
  "https://example.test/a b|é", "https&#58;//example.test/a b", "&#104;ttps://example.test/{draft}",
  "https\\://example.test/[draft]", "mailto&colon;reader|é@example.test", "custom+v1.a-b:payload {draft}",
])("external ASCII schemes are excluded before target character checking: %j", (destination) => {
  const body = `[external](<${destination}>) ![external](<${destination}>)`;
  expect(inspectBodyLinks(body)).toEqual({ links: [], failures: [] });
  const graph = graphFor(body);
  expect(graph.failures.size).toBe(0);
  expect(graph.targets.get(sourcePath)!.related_to.size).toBe(0);
});

test.each([
  "`[bad](<N note.md>)`", "```md\n[bad](N|draft.md)\n```", "~~~md\n[bad](N|draft.md)\n~~~",
  "    [bad](N|draft.md)", "\\[bad](N|draft.md)",
  "[bad](N note.md)", "[bad](<N\nnote.md>)", "[bad](<N note.md>",
])("code, escaped links, and unrecognized Markdown remain outside destination diagnostics: %j", (body) => {
  expect(inspectBodyLinks(body)).toEqual({ links: [], failures: [] });
});

const schemaDirectory = resolve(import.meta.dir, "../../TypedMarkSpecification/schema/json-schema");
const registry = new SchemaRegistry(schemaDirectory);
const roots: string[] = [];

function writeNote(root: string, path: string, data: Record<string, unknown>, body = "") {
  mkdirSync(dirname(join(root, path)), { recursive: true });
  writeFileSync(join(root, path), `\uFEFF---\n# Keep source spelling.\n${stringify(data)}---\n${body}`.replaceAll("\n", "\r\n"));
}

function collection(severity: string, body: string, reference: string, minimum = 0) {
  const root = mkdtempSync(join(tmpdir(), "typedmark-note-link-encoding-"));
  roots.push(root);
  writeNote(root, "typedmark.md", {
    specification_version: "0.1.0", name: "note-link-encoding", description: "Target encoding tests.",
    validation_defaults: { invalid_note_link: severity },
  });
  for (const noteType of ["source", "target"]) writeNote(root, `.typedmark/schemas/${noteType}.md`, {
    specification_version: "0.1.0", description: `${noteType} notes.`,
    storage: { folder_pattern: "Notes", note_name_pattern: "{title}" },
    ...(noteType === "source" ? {
      frontmatter: { details: { type: "object", fields: { references: {
        type: "list", items: { type: "link", format: "note_link" },
      } } } },
      relationships: {
        belongs_to: { allowed_note_types: {} }, related_to: { allowed_note_types: { target: { min: minimum } } },
      },
    } : {}),
  });
  writeNote(root, sourcePath, { note_type: "source", details: { references: [reference] } }, body);
  writeNote(root, "Notes/N note.md", { note_type: "target" });
  return root;
}

function validate(root: string) {
  const before = readFileSync(join(root, sourcePath));
  const report = validateCollection({ collectionRoot: root, schemaDirectory });
  expect(registry.validate("validation-report.schema.json", report)).toEqual([]);
  expect(readFileSync(join(root, sourcePath))).toEqual(before);
  return report;
}

afterEach(() => { for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true }); });

test.each(["error", "warn", "off"])(
  "CM-54 routes invalid target spelling in body and nested fields only through invalid_note_link at %s severity", (severity) => {
    const report = validate(collection(severity, "[body](<N note.md>)", "[field](<N&#32;note.md>)"));
    expect(report).toMatchObject({ valid: severity !== "error", evaluation: "complete" });
    const findings = report.results.map(({ code, rule_id, severity, path, field }) => ({ code, rule_id, severity, path, field }));
    expect(findings).toEqual(severity === "off" ? [] : expect.arrayContaining([
      { code: "invalid_note_link", rule_id: "NL-6", severity, path: sourcePath, field: undefined },
      { code: "invalid_note_link", rule_id: "NL-6", severity, path: sourcePath, field: "details.references" },
    ]));
    expect(findings).toHaveLength(severity === "off" ? 0 : 2);
  },
);

test("suppressing an invalid body target does not let it satisfy relationship cardinality", () => {
  const report = validate(collection("off", "[body](<N note.md>)", "[field](N%20note.md)", 1));
  expect(report).toMatchObject({ valid: false, evaluation: "complete" });
  expect(report.results).toEqual([expect.objectContaining({
    code: "invalid_relationship_instance", rule_id: "RHT-31", path: sourcePath, relationship: "related_to",
  })]);
});

test("encoded body and field targets validate against a real collection without rewriting the note", () => {
  const report = validate(collection("error", "![body](N%20note.md)", "[field](N%20note.md)", 1));
  expect(report).toMatchObject({ valid: true, evaluation: "complete", results: [] });
});
