import { expect, test } from "bun:test";
import type { CollectionModel, ManagedNote } from "../src/collection-model";
import { buildRelationshipGraph, extractBodyLinks, inspectBodyLinks, parseNoteLink } from "../src/note-links";
import { markdownLinkDestination } from "../src/markdown-link-destination";
import { hasUriScheme } from "../src/uri-syntax";

// CommonMark destination escapes/entities precede NL-5 scheme classification
// and NL-11 target decoding. Authored labels and anchors remain lexical strings.
test.each([
  { destination: "N&period;md", target: "N.md" },
  { destination: "N&#46;md", target: "N.md" },
  { destination: "N&#x2e;md", target: "N.md" },
  { destination: "N&#X2E;md", target: "N.md" },
  { destination: "N&AMP;Co.md", target: "N&Co.md" },
  { destination: "N&amp;period;md", target: "N&period;md" },
  { destination: "N\\&period;md", target: "N&period;md" },
  { destination: "N&unknown;.md", target: "N&unknown;.md" },
  { destination: "N&periodmd", target: "N&periodmd" },
  { destination: "N%26period%3Bmd", target: "N&period;md" },
  { destination: "N%26%2346%3Bmd", target: "N&#46;md" },
  { destination: "N%23draft.md", target: "N#draft.md" },
  { destination: "N%2520.md", target: "N%20.md" },
  { destination: "N&percnt;2520.md", target: "N%20.md" },
  { destination: "N&#37;2520.md", target: "N%20.md" },
])("decodes the Markdown target once without inventing an anchor: $destination", ({ destination, target }) => {
  const raw = `[**Label** &amp; text](${destination})`;
  expect(parseNoteLink(raw)).toEqual({
    raw, form: "markdown", target, displayText: "**Label** &amp; text", embed: false,
  });
});

test.each([
  { destination: "N&#46;md#Head&amp;Tail", target: "N.md", anchor: "Head&amp;Tail" },
  { destination: "N&period;md&num;Head&#33;", target: "N.md", anchor: "Head&#33;" },
  { destination: "N.md&#35;Head&amp;Tail", target: "N.md", anchor: "Head&amp;Tail" },
  { destination: "N.md&#x23;^block", target: "N.md", anchor: "^block" },
  { destination: "N.md&num;Head%23Tail", target: "N.md", anchor: "Head%23Tail" },
  { destination: "N.md&num;", target: "N.md", anchor: "" },
  { destination: "N.md\\#Head&amp;Tail", target: "N.md", anchor: "Head&amp;Tail" },
  { destination: "N.md\\&#35;Head", target: "N.md&", anchor: "35;Head" },
])("keeps the authored tail after the interpreted fragment separator: $destination", ({ destination, target, anchor }) => {
  const raw = `![a\\[b\\]](<${destination}> 'title#part')`;
  expect(parseNoteLink(raw)).toEqual({
    raw, form: "markdown", target, anchor, displayText: "a\\[b\\]", embed: true,
  });
});

test.each([
  "https&#58;//example.com",
  "https&#x3a;//example.com",
  "https&colon;//example.com",
  "&#104;ttps://example.com",
  "https\\://example.com",
  "mailto&colon;reader@example.com",
  "custom&#43;v1&#46;a&#45;b&colon;payload",
])("excludes an external scheme after CommonMark processing: %s", (destination) => {
  for (const prefix of ["", "!"]) {
    const raw = `${prefix}[external](${destination})`;
    expect(parseNoteLink(raw)).toBeUndefined();
    expect(extractBodyLinks(`Before ${raw} after.`)).toEqual([]);
  }
});

test.each([
  { destination: "https%3A//example.com", target: "https://example.com" },
  { destination: "h&#116;tps%3A//example.com", target: "https://example.com" },
  { destination: "https&percnt;3A//example.com", target: "https://example.com" },
  { destination: "https\\&colon;//example.com", target: "https&colon;//example.com" },
  { destination: "https&amp;colon;//example.com", target: "https&colon;//example.com" },
])("classifies the scheme before percent decoding without re-decoding entities: $destination", ({ destination, target }) => {
  const raw = `[label](${destination})`;
  expect(parseNoteLink(raw)).toEqual({ raw, form: "markdown", target, displayText: "label", embed: false });
});

test.each([
  { destination: "N&#x1F4DD;.md", uri: "N📝.md" },
  { destination: "%68ttps://example.com", uri: "%68ttps://example.com" },
  { destination: "&#8490;:note", uri: "K:note" },
  { destination: "&#383;cheme:note", uri: "ſcheme:note" },
])("keeps Markdown decoding and scheme recognition distinct from URI validity: $destination", ({ destination, uri }) => {
  expect(markdownLinkDestination(destination)).toEqual({ uri, target: uri });
  expect(hasUriScheme(uri)).toBe(false);
  const raw = `[label](${destination})`;
  expect(parseNoteLink(raw)).toBeUndefined();
  expect(inspectBodyLinks(raw).failures.map(({ error }) => error.rule_id)).toEqual(["NL-6"]);
});

test("body extraction retains physical source and lexical components around decoded entities", () => {
  const prefix = "🧭 Before\r\n\r\n> ";
  const physical = "![first &amp;\r\n> second](<N&#46;md&num;Head&amp;Tail> 'title#part')";
  const body = prefix + physical + " after.";
  expect(extractBodyLinks(body)).toEqual([{
    raw: "![first &amp;\nsecond](<N&#46;md&num;Head&amp;Tail> 'title#part')",
    form: "markdown", target: "N.md", anchor: "Head&amp;Tail",
    displayText: "first &amp;\nsecond", embed: true,
    source: { start: prefix.length, end: prefix.length + physical.length, raw: physical },
  }]);
});

test.each([
  { raw: "[[N&period;md]]", target: "N&period;md" },
  { raw: "[[N%20.md]]", target: "N%20.md" },
  { raw: "[[https&colon;//example.com]]", target: "https&colon;//example.com" },
  { raw: "[[N&#46;md]]", target: "N&", anchor: "46;md" },
])("leaves wikilink destination spelling literal: $raw", (expected) => {
  expect(parseNoteLink(expected.raw)).toEqual({ ...expected, form: "wikilink", embed: false });
});

test("decoded note links create real relationships without an external-link edge to Notes/https&.md", () => {
  const parent = "[parent](P&#46;md)";
  const source: ManagedNote = {
    path: "Notes/Source.md", noteType: "source", stored: { parent }, values: { parent }, problems: [],
    body: "[external](https&#58;//example.com) [actual](N&period;md)",
    fields: { parent: { type: "link", format: "note_link", relationship_kind: "belongs_to", validate_exists: true } },
  };
  const targets: ManagedNote[] = ["Notes/P.md", "Notes/N.md", "Notes/https&.md"].map((path) => ({
    path, noteType: path === "Notes/P.md" ? "parent" : "note", stored: {}, values: {}, fields: {}, body: "", problems: [],
  }));
  const notes = [source, ...targets];
  const model = {
    notes, documents: notes, assets: new Set<string>(),
    schemas: new Map([["note", {}], ["parent", {}], ["source", { relationships: {
      belongs_to: { allowed_note_types: { parent: {} } },
      related_to: { allowed_note_types: { note: {} } },
    } }]]),
  } as unknown as CollectionModel;

  const graph = buildRelationshipGraph(model, (actual, requested) => actual === requested);
  expect(graph.targets.get(source.path)).toEqual({
    belongs_to: new Set(["Notes/P.md"]), related_to: new Set(["Notes/N.md"]),
  });
  expect(graph.failures.size).toBe(0);
});

// CommonMark numeric references name Unicode scalars, not Windows-1252 bytes.
// These helper checks concern Markdown processing, not URI-spelling validity.
test.each(Array.from({ length: 32 }, (_, index) => index + 0x80))(
  "preserves numeric reference code point %i without HTML C1 remapping", (code) => {
    const target = `N${String.fromCodePoint(code)}.md`;
    for (const spelling of [`&#${code};`, `&#x${code.toString(16)};`]) {
      expect(markdownLinkDestination(`N${spelling}.md`)).toEqual({ uri: target, target });
    }
  },
);

test.each(["&#0;", "&#x0;", "&#55296;", "&#xDFFF;", "&#1114112;", "&#xFFFFFF;"])(
  "replaces zero and invalid scalar references with U+FFFD: %s", (spelling) => {
    expect(markdownLinkDestination(`N${spelling}.md`)).toEqual({ uri: "N�.md", target: "N�.md" });
  },
);
