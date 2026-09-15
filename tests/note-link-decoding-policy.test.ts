import { afterEach, expect, test } from "bun:test";
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { stringify } from "yaml";
import { validateFieldValue } from "../src/field-values";
import * as noteLinks from "../src/note-links";
import { interpretNoteLinkAnchor as interpret } from "../src/note-links";
import { queryCollection } from "../src/query";
import { readCollectionModel, validateCollection } from "../src/validator";

test.each([
  ["%5Eblock", "block", "block"], ["%5eblock", "block", "block"],
  ["Caf%C3%A9%20%F0%9F%93%9D", "heading", "Café 📝"],
  ["r%C3%A9sum%C3%A9%20%F0%9F%93%9D", "heading", "résumé 📝"], ["%255Eblock", "heading", "%5Eblock"],
  ["A+B%2BC", "heading", "A+B+C"], ["", "heading", ""],
  ["&#94;block", "block", "block"], ["\\^block", "block", "block"],
  ["&percnt;5Eblock", "block", "block"],
  ["\\&percnt;5Eblock", "heading", "&percnt;5Eblock"],
  ["&amp;percnt;5Eblock", "heading", "&percnt;5Eblock"],
  ["%26percnt%3B5Eblock", "heading", "&percnt;5Eblock"],
  ["Head&amp;Tail\\!", "heading", "Head&Tail!"],
] as const)("interprets Markdown anchor %j while preserving authored components", (anchor, kind, value) => {
  const raw = `[a\\[b\\] &amp;](<N.md#${anchor}> 'title')`;
  const parsed = noteLinks.parseNoteLink(raw)!;
  expect(parsed).toEqual({ raw, form: "markdown", target: "N.md", anchor, displayText: "a\\[b\\] &amp;", embed: false });
  expect(interpret(parsed)).toEqual({ kind, value });
  const prefix = "🧭 Before\r\n\r\n> ";
  const inspected = noteLinks.inspectBodyLinks(prefix + raw);
  expect(inspected.failures).toEqual([]);
  expect(inspected.links).toEqual([{ ...parsed, source: { start: prefix.length, end: prefix.length + raw.length, raw } }]);
  expect(interpret(inspected.links[0]!)).toEqual({ kind, value });
  expect(parsed.anchor).toBe(anchor);
});

test.each([
  ["%5Eblock", "heading", "%5Eblock"], ["^block", "block", "block"],
  ["%FF", "heading", "%FF"], ["&percnt;5Eblock", "heading", "&percnt;5Eblock"],
  ["\\^block", "heading", "\\^block"], ["", "heading", ""],
] as const)("interprets wikilink anchor %j literally", (anchor, kind, value) => {
  const raw = `[[N%FF#${anchor}|label]]`;
  const link = noteLinks.parseNoteLink(raw)!;
  expect(link).toMatchObject({ raw, target: "N%FF", anchor, displayText: "label" });
  expect(interpret(link)).toEqual({ kind, value });
  expect(noteLinks.inspectBodyLinks(raw).failures).toEqual([]);
});

test("keeps absent anchors distinct from explicitly empty anchors", () => {
  for (const raw of ["[label](N.md)", "[[N]]"]) {
    const link = noteLinks.parseNoteLink(raw)!;
    expect(link).not.toHaveProperty("anchor");
    expect(interpret(link)).toBeUndefined();
  }
});

// Illegal leading byte, stray continuation, overlong encoding, surrogate,
// truncated sequence, and a scalar beyond U+10FFFF are distinct UTF-8 failures.
const invalidOctets = ["%FF", "%80", "%C0%AF", "%ED%A0%80", "%E2%82", "%F4%90%80%80"];
test.each(invalidOctets.flatMap((octets) => [`N${octets}.md`, `N.md#${octets}`]))(
  "retains an NL-11 diagnostic for non-UTF-8 destination %s", (destination) => {
    const raw = `[label](${destination})`;
    expect(noteLinks.parseNoteLink(raw)).toBeUndefined();
    const inspected = noteLinks.inspectBodyLinks(raw);
    expect(inspected.links).toEqual([]);
    expect(inspected.failures).toEqual([expect.objectContaining({
      raw, source: { start: 0, end: raw.length, raw }, error: expect.objectContaining({ rule_id: "NL-11" }),
    })]);
  },
);

test.each(["bad%", "bad%GG", ...invalidOctets])("anchor helper rejects malformed or undecodable Markdown %s", (anchor) => {
  let failure: unknown;
  try { interpret({ form: "markdown", anchor }); } catch (error) { failure = error; }
  expect(failure).toBeInstanceOf(noteLinks.NoteLinkError);
  expect(failure).toMatchObject({ rule_id: anchor.startsWith("bad") ? "NL-6" : "NL-11" });
});

test("retains located failures and nested/neighboring valid links in a multiline body", () => {
  const prefix = "🧭 Before\r\n\r\n> ";
  const physical = "[first\r\n> ![nested](N.md#%5Eblock)](<N%FF.md>)";
  const body = prefix + physical + " [last](N.md#%255Eblock)";
  const inspected = noteLinks.inspectBodyLinks(body);
  expect(inspected.failures).toEqual([expect.objectContaining({
    raw: "[first\n![nested](N.md#%5Eblock)](<N%FF.md>)",
    source: { start: prefix.length, end: prefix.length + physical.length, raw: physical },
    error: expect.objectContaining({ rule_id: "NL-11" }),
  })]);
  expect(inspected.links.map(({ target, anchor, embed }) => ({ target, anchor, embed }))).toEqual([
    { target: "N.md", anchor: "%5Eblock", embed: true }, { target: "N.md", anchor: "%255Eblock", embed: false },
  ]);
  for (const entry of [...inspected.links, ...inspected.failures]) expect(body.slice(entry.source.start, entry.source.end)).toBe(entry.source.raw);
});

test.each(["https://example.test/#section", "urn:example:note#", "x:?#", "x:%FF?octets=%80#%ED%A0%80"])(
  "URI fields allow scheme-qualified fragments and arbitrary encoded octets: %s", (value) => {
    expect(validateFieldValue(value, { type: "link", format: "uri" }, "UTC")).toBeUndefined();
  },
);
test.each(["#section", "N.md#section", "x:path#bad%GG"])("URI fields retain syntax restrictions: %s", (value) => {
  expect(validateFieldValue(value, { type: "link", format: "uri" }, "UTC")?.rule).toBe("FDR-140");
});
test("external Markdown destinations remain outside internal-link UTF-8 validation", () => {
  expect(noteLinks.inspectBodyLinks("[external](https://example.test/%FF#%80)")).toEqual({ links: [], failures: [] });
});

const schemaDirectory = resolve(import.meta.dir, "../../TypedMarkSpecification/schema/json-schema");
const roots: string[] = [];
const sourcePath = "Notes/Source.md";
const uri = "HTTPS://EXAMPLE.test/%FF#%80";
function collection(body: string, reference: string, severity = "error") {
  const root = mkdtempSync(join(tmpdir(), "typedmark-decoding-policy-"));
  roots.push(root);
  const artifacts: Record<string, Record<string, unknown>> = {
    "typedmark.md": { specification_version: "0.1.0", name: "decoding-policy", description: "Decoding policy.", validation_defaults: { invalid_note_link: severity } },
    ".typedmark/schemas/source.md": {
      specification_version: "0.1.0", description: "Source notes.", storage: { folder_pattern: "Notes", note_name_pattern: "{title}" },
      frontmatter: { reference: { type: "link", format: "note_link", relationship_kind: "related_to" }, uri: { type: "link", format: "uri" } },
      relationships: { belongs_to: { allowed_note_types: {} }, related_to: { allowed_note_types: { target: {} } } },
    },
    ".typedmark/schemas/target.md": { specification_version: "0.1.0", description: "Targets.", storage: { folder_pattern: "Notes", note_name_pattern: "{title}" } },
    [sourcePath]: { note_type: "source", reference, uri }, "Notes/N.md": { note_type: "target" },
  };
  for (const [path, data] of Object.entries(artifacts)) {
    mkdirSync(dirname(join(root, path)), { recursive: true });
    writeFileSync(join(root, path), `\uFEFF---\n# Keep spelling.\n${stringify(data)}---\n${path === sourcePath ? body : ""}`.replaceAll("\n", "\r\n"));
  }
  return { root, snapshot: () => Object.keys(artifacts).map((path) => readFileSync(join(root, path))) };
}
afterEach(() => { for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true }); });

test.each(["error", "warn", "off"])("invalid UTF-8 creates no graph edges or usable query model with severity %s", (severity) => {
    const { root, snapshot } = collection("[body](N%FF.md)", "[field](N.md#%80)", severity);
    const before = snapshot();
    try {
      const report = validateCollection({ collectionRoot: root, schemaDirectory });
      expect(report).toMatchObject({ valid: severity !== "error", evaluation: "complete" });
      expect(report.results).toHaveLength(severity === "off" ? 0 : 2);
      expect(report.results).toEqual(severity === "off" ? [] : expect.arrayContaining([
        expect.objectContaining({ code: "invalid_note_link", rule_id: "NL-11", path: sourcePath, field: "reference", severity }),
        expect.objectContaining({ code: "invalid_note_link", rule_id: "NL-11", path: sourcePath, severity }),
      ]));
      expect(report.results.filter((finding) => finding.field === undefined)).toHaveLength(severity === "off" ? 0 : 1);
      const graph = noteLinks.buildRelationshipGraph(readCollectionModel({ collectionRoot: root, schemaDirectory }), (a, b) => a === b);
      expect(graph.targets.get(sourcePath)!.related_to.size).toBe(0);
      expect(graph.failures.get(sourcePath)?.map(({ rule_id }) => rule_id)).toEqual(["NL-11", "NL-11"]);
      const input = { collectionRoot: root, schemaDirectory, queryVersion: "0.1.0" };
      expect(() => queryCollection({ ...input, query: { specification_version: "0.1.0", note_types: ["source"], select: [{ kind: "path", as: "path" }] } })).toThrow("CM-307: NL-11:");
      expect(queryCollection({ ...input, query: { specification_version: "0.1.0", note_types: ["target"], select: [{ kind: "path", as: "path" }] } }).rows).toEqual([{ path: "Notes/N.md" }]);
    } finally { expect(snapshot()).toEqual(before); }
});

test("encoded anchors resolve without requiring matching headings and preserve URI projection bytes", () => {
  const { root, snapshot } = collection("![body](N.md#%5Emissing)", "[field](N.md#Caf%C3%A9)");
  const before = snapshot();
  try {
    expect(validateCollection({ collectionRoot: root, schemaDirectory })).toMatchObject({ valid: true, evaluation: "complete", results: [] });
    const graph = noteLinks.buildRelationshipGraph(readCollectionModel({ collectionRoot: root, schemaDirectory }), (a, b) => a === b);
    expect(graph.failures.size).toBe(0);
    expect(graph.targets.get(sourcePath)!.related_to).toEqual(new Set(["Notes/N.md"]));
    expect(queryCollection({ collectionRoot: root, schemaDirectory, queryVersion: "0.1.0", query: {
      specification_version: "0.1.0", note_types: ["source"], select: [{ kind: "field", field: "uri", as: "uri" }],
    } }).rows).toEqual([{ uri }]);
  } finally { expect(snapshot()).toEqual(before); }
});
