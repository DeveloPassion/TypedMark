import { afterEach, expect, test } from "bun:test";
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { stringify } from "yaml";
import { validateFieldValue } from "../src/field-values";
import { buildRelationshipGraph, inspectBodyLinks, interpretNoteLinkAnchor as interpret, NoteLinkError, parseNoteLink } from "../src/note-links";
import { queryCollection } from "../src/query";
import { readCollectionModel, validateCollection } from "../src/validator";

function caught(action: () => unknown): unknown {
  try { action(); } catch (error) { return error; }
}

// RFC 3986 section 3.5: fragment = *( pchar / "/" / "?" ). The sole
// TypedMark exception is one leading literal caret after CommonMark processing.
// Angle destinations/entities ensure these are recognized Markdown links.
const invalidFragments = [
  "Café", "Heading text", "📝", "Head|Tail", "Head{Tail}", "Head[Tail]",
  "Head`Tail", "Head&quot;Tail", "Head&lt;Tail&gt;", "Head&bsol;Tail", "Head#Tail",
  "Head^Tail", "^^part", "^part^tail", "%5E^part", "Head&#9;Tail",
  "&amp;#94;part", "bad%GG", "bad%",
].map((anchor) => ({ anchor, rule: "NL-6" }));
invalidFragments.push({ anchor: "%FF", rule: "NL-11" }, { anchor: "%E2%82", rule: "NL-11" });

test.each(invalidFragments)("rejects Markdown fragment $anchor with $rule at each link boundary", ({ anchor, rule }) => {
  const raw = `[label](<N.md#${anchor}>)`, prefix = "🧭 Before\r\n\r\n> ";
  const parsed = parseNoteLink(raw), inspected = inspectBodyLinks(prefix + raw);
  const helperError = caught(() => interpret({ form: "markdown", anchor }));
  expect(parsed).toBeUndefined();
  expect(inspected).toEqual({ links: [], failures: [expect.objectContaining({
    raw, source: { start: prefix.length, end: prefix.length + raw.length, raw },
    error: expect.objectContaining({ rule_id: rule }),
  })] });
  expect(helperError).toBeInstanceOf(NoteLinkError);
  expect(helperError).toMatchObject({ rule_id: rule });
});

test.each([
  ["Caf%C3%A9%20%F0%9F%93%9D", "heading", "Café 📝"],
  ["%7C%7B%7D%5B%5D%60%22%3C%3E%5C%23%5E", "heading", "|{}[]`\"<>\\#^"],
  // Independent RFC allowlist, not a URI helper used as its own oracle.
  ["ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789-._~!$&'()*+,;=:@/?", "heading", "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789-._~!$&'()*+,;=:@/?"],
  ["Head%09Tail%0A", "heading", "Head\tTail\n"],
  ["^part", "block", "part"], ["^", "block", ""],
  ["%5Epart", "block", "part"], ["%255Epart", "heading", "%5Epart"],
  ["^%5Epart", "block", "^part"], ["&#94;part", "block", "part"],
  ["\\^part", "block", "part"], ["&percnt;5Epart", "block", "part"],
  ["\\&percnt;5Epart", "heading", "&percnt;5Epart"],
  ["&amp;percnt;5Epart", "heading", "&percnt;5Epart"],
  ["%26%2394%3Bpart", "heading", "&#94;part"],
  ["Head&amp;Tail\\!", "heading", "Head&Tail!"], ["", "heading", ""],
] as const)("accepts and interprets encoded/allowed fragment %j exactly once", (anchor, kind, value) => {
  const displayText = "a\\[b\\] &amp;", raw = `![${displayText}](<N.md#${anchor}> 'title')`;
  const expected = { raw, form: "markdown" as const, target: "N.md", anchor, displayText, embed: true };
  expect(parseNoteLink(raw)).toEqual(expected);
  expect(interpret({ form: "markdown", anchor })).toEqual({ kind, value });
  const prefix = "🧭 Before\r\n\r\n> ", body = prefix + raw + " after.";
  expect(inspectBodyLinks(body)).toEqual({ failures: [], links: [{
    ...expected, source: { start: prefix.length, end: prefix.length + raw.length, raw },
  }] });
});

test("does not invent an absent fragment", () => {
  const link = parseNoteLink("[label](N.md)")!;
  expect(link).not.toHaveProperty("anchor");
  expect(interpret(link)).toBeUndefined();
  expect(interpret({ form: "markdown" })).toBeUndefined();
});

test("keeps physical multiline spans distinct from lexical components of accepted anchors", () => {
  const prefix = "🧭 Before\r\n\r\n> ";
  const physical = "![first &amp;\r\n> second](<N.md#%5Epart> 'title')";
  expect(inspectBodyLinks(prefix + physical)).toEqual({ failures: [], links: [{
    raw: "![first &amp;\nsecond](<N.md#%5Epart> 'title')", form: "markdown",
    target: "N.md", anchor: "%5Epart", displayText: "first &amp;\nsecond", embed: true,
    source: { start: prefix.length, end: prefix.length + physical.length, raw: physical },
  }] });
});

test("keeps wiki anchors literal, ignores external links, and retains URI field restrictions", () => {
  const raw = "[[N#Café ^middle#%FF|label]]", link = parseNoteLink(raw)!;
  expect(link).toMatchObject({ raw, anchor: "Café ^middle#%FF" });
  expect(interpret(link)).toEqual({ kind: "heading", value: "Café ^middle#%FF" });
  expect(inspectBodyLinks(raw).failures).toEqual([]);
  expect(inspectBodyLinks("[external](<https://example.test/#Café ^part%GG>)")).toEqual({ links: [], failures: [] });
  expect(validateFieldValue("https://example.test/#^part", { type: "link", format: "uri" }, "UTC")?.rule).toBe("FDR-140");
  expect(validateFieldValue("https://example.test/#%5Epart%FF", { type: "link", format: "uri" }, "UTC")).toBeUndefined();
});

const schemaDirectory = resolve(import.meta.dir, "../../TypedMarkSpecification/schema/json-schema");
const roots: string[] = [], sourcePath = "Notes/Source.md";
afterEach(() => { for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true }); });

test.each(["error", "warn", "off"])("invalid raw fragments stay out of relationships and dependent queries at severity %s", (severity) => {
  const root = mkdtempSync(join(tmpdir(), "typedmark-fragment-encoding-"));
  roots.push(root);
  const artifacts: Record<string, Record<string, unknown>> = {
    "typedmark.md": { specification_version: "0.1.0", name: "fragments", description: "Fragment encoding.", validation_defaults: { invalid_note_link: severity } },
    ".typedmark/schemas/source.md": {
      specification_version: "0.1.0", description: "Sources.", storage: { folder_pattern: "Notes", note_name_pattern: "{title}" },
      frontmatter: { reference: { type: "link", format: "note_link", relationship_kind: "related_to" } },
      relationships: { belongs_to: { allowed_note_types: {} }, related_to: { allowed_note_types: { target: {} } } },
    },
    ".typedmark/schemas/target.md": { specification_version: "0.1.0", description: "Targets.", storage: { folder_pattern: "Notes", note_name_pattern: "{title}" } },
    [sourcePath]: { note_type: "source", reference: "[field](<N.md#Heading text>)" },
    "Notes/N.md": { note_type: "target" }, "Notes/Good.md": { note_type: "target" },
  };
  const body = "🧭 [bad](<N.md#Café>) [good](Good.md#%5Emissing)\n";
  for (const [path, data] of Object.entries(artifacts)) {
    mkdirSync(dirname(join(root, path)), { recursive: true });
    writeFileSync(join(root, path), `\uFEFF---\n# Keep authored bytes.\n${stringify(data)}---\n${path === sourcePath ? body : ""}`.replaceAll("\n", "\r\n"));
  }
  const snapshot = () => Object.keys(artifacts).map((path) => readFileSync(join(root, path)));
  const before = snapshot(), input = { collectionRoot: root, schemaDirectory };
  try {
    const report = validateCollection(input);
    const graph = buildRelationshipGraph(readCollectionModel(input), (a, b) => a === b);
    const queryInput = { ...input, queryVersion: "0.1.0" };
    const dependentError = caught(() => queryCollection({ ...queryInput, query: {
      specification_version: "0.1.0", note_types: ["source"], select: [{ kind: "path", as: "path" }],
      where: { kind: "relationship", relationship: "related_to", count: { min: 1 } },
    } }));
    expect(report).toMatchObject({ valid: severity !== "error", evaluation: "complete" });
    expect(report.results).toHaveLength(severity === "off" ? 0 : 2);
    expect(report.results).toEqual(severity === "off" ? [] : expect.arrayContaining([
      expect.objectContaining({ code: "invalid_note_link", rule_id: "NL-6", path: sourcePath, field: "reference", severity }),
      expect.objectContaining({ code: "invalid_note_link", rule_id: "NL-6", path: sourcePath, severity }),
    ]));
    expect(report.results.filter((finding) => finding.field === undefined)).toHaveLength(severity === "off" ? 0 : 1);
    expect(graph.targets.get(sourcePath)!.related_to).toEqual(new Set(["Notes/Good.md"]));
    expect(graph.failures.get(sourcePath)?.map(({ rule_id }) => rule_id)).toEqual(["NL-6", "NL-6"]);
    expect(dependentError).toBeInstanceOf(Error);
    expect((dependentError as Error).message).toContain("CM-307: NL-6:");
    expect(queryCollection({ ...queryInput, query: {
      specification_version: "0.1.0", note_types: ["target"], select: [{ kind: "path", as: "path" }],
    } }).rows).toEqual([{ path: "Notes/Good.md" }, { path: "Notes/N.md" }]);
  } finally { expect(snapshot()).toEqual(before); }
});
