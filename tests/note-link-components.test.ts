import { expect, test } from "bun:test";
import { extractBodyLinks, parseNoteLink, resolveNoteLink } from "../src/note-links";
import type { CollectionModel } from "../src/validator";

// NL-2/3/9/10/11: each listed form exposes its authored components.
const forms = [
  { raw: "[[Target]]", form: "wikilink", target: "Target" },
  { raw: "[[Target|Display text]]", form: "wikilink", target: "Target", displayText: "Display text" },
  { raw: "[[Target#Heading]]", form: "wikilink", target: "Target", anchor: "Heading" },
  { raw: "[[Target#Heading|Display text]]", form: "wikilink", target: "Target", anchor: "Heading", displayText: "Display text" },
  { raw: "[[Target#^block-id]]", form: "wikilink", target: "Target", anchor: "^block-id" },
  { raw: "[[Target#^block-id|Display text]]", form: "wikilink", target: "Target", anchor: "^block-id", displayText: "Display text" },
  { raw: "[Display text](Target)", form: "markdown", target: "Target", displayText: "Display text" },
  { raw: "[Display text](Target.md)", form: "markdown", target: "Target.md", displayText: "Display text" },
  { raw: "[Display text](Target.md#Heading)", form: "markdown", target: "Target.md", anchor: "Heading", displayText: "Display text" },
  { raw: "[Display text](Target.md#^block-id)", form: "markdown", target: "Target.md", anchor: "^block-id", displayText: "Display text" },
];

const links = forms.flatMap((form) => [
  { ...form, embed: false },
  { ...form, raw: `!${form.raw}`, embed: true },
]);

test.each(links)("retains the components of $raw", (expected) => {
  expect(parseNoteLink(expected.raw)).toMatchObject(expected);
});

// NL-8/38: extraction uses the same components, including the embed marker.
test.each(links)("retains the same components when extracting $raw from prose", (expected) => {
  expect(extractBodyLinks(`Before ${expected.raw} after.`)).toEqual([expect.objectContaining(expected)]);
});

test.each([
  { raw: "[[Target]]", absent: ["anchor", "displayText"] },
  { raw: "[[Target|Label]]", absent: ["anchor"] },
  { raw: "[[Target#Heading]]", absent: ["displayText"] },
  { raw: "[Label](Target.md)", absent: ["anchor"] },
])("does not invent absent optional components for $raw", ({ raw, absent }) => {
  const parsed = parseNoteLink(raw);
  expect(parsed).toMatchObject({ raw });
  for (const component of absent) expect(parsed).not.toHaveProperty(component);
});

test("keeps an empty Markdown label distinct from an absent wiki display text", () => {
  expect(parseNoteLink("[](Target.md)")).toMatchObject({
    raw: "[](Target.md)", form: "markdown", target: "Target.md", displayText: "", embed: false,
  });
});

test("preserves source spelling and whitespace in Unicode wikilink components", () => {
  const raw = "![[Notes/Cafe\u0301#Re\u0301sume\u0301|  Re\u0301fe\u0301rence 📝  ]]";
  expect(parseNoteLink(raw)).toMatchObject({
    raw, form: "wikilink", target: "Notes/Cafe\u0301", anchor: "Re\u0301sume\u0301",
    displayText: "  Re\u0301fe\u0301rence 📝  ", embed: true,
  });
});

test("preserves Markdown source and URL-decodes the target", () => {
  const raw = "![Cafe\u0301 📝](../Notes/Cafe%CC%81%20%23draft.md#Heading)";
  expect(parseNoteLink(raw)).toMatchObject({
    raw, form: "markdown", target: "../Notes/Cafe\u0301 #draft.md", anchor: "Heading",
    displayText: "Cafe\u0301 📝", embed: true,
  });
});

test("keeps the anchor tail after the first hash separate from the wiki label", () => {
  const raw = "[[Target#Heading#Detail|Label#Tag]]";
  expect(parseNoteLink(raw)).toMatchObject({
    raw, form: "wikilink", target: "Target", anchor: "Heading#Detail", displayText: "Label#Tag", embed: false,
  });
});

test("a hash in wiki display text does not invent an anchor", () => {
  const raw = "[[Target|Label #tag]]";
  const parsed = parseNoteLink(raw);
  expect(parsed).toMatchObject({
    raw, form: "wikilink", target: "Target", displayText: "Label #tag", embed: false,
  });
  expect(parsed).not.toHaveProperty("anchor");
});

test.each([
  { raw: "[[Target|]]", target: "Target", displayText: "" },
  { raw: "[[Target#]]", target: "Target", anchor: "" },
  { raw: "[[Target#|]]", target: "Target", anchor: "", displayText: "" },
  { raw: "[](Target.md#)", target: "Target.md", anchor: "", displayText: "" },
])("keeps explicitly empty components in $raw", (expected) => {
  expect(parseNoteLink(expected.raw)).toMatchObject(expected);
});

// These are lexical components, not rendered labels or resolved anchors.
test.each([
  { raw: "[a\\[b\\]](N.md#Head\\!ing)", target: "N.md", displayText: "a\\[b\\]", anchor: "Head\\!ing" },
  { raw: "[a `]` b](N.md#Heading)", target: "N.md", displayText: "a `]` b", anchor: "Heading" },
  { raw: "[**Bold** &amp; Label](N.md#Head%20Text)", target: "N.md", displayText: "**Bold** &amp; Label", anchor: "Head%20Text" },
  { raw: "![nested [label]](<N.md#%5Eblock> 'title#part')", target: "N.md", displayText: "nested [label]", anchor: "%5Eblock" },
  { raw: "[label](N(foo(bar)).md#Head)", target: "N(foo(bar)).md", displayText: "label", anchor: "Head" },
  { raw: "[line\r\nbreak](N.md#Heading)", target: "N.md", displayText: "line\r\nbreak", anchor: "Heading" },
])("retains authored Markdown label and fragment spelling in $raw", (expected) => {
  expect(parseNoteLink(expected.raw)).toMatchObject(expected);
});

test("a hash in the optional Markdown title does not invent an anchor", () => {
  const parsed = parseNoteLink('[label](N.md "title#part")');
  expect(parsed).toMatchObject({ raw: '[label](N.md "title#part")', displayText: "label", target: "N.md" });
  expect(parsed).not.toHaveProperty("anchor");
});

test.each([
  "prefix [[Target]]", "[[Target]] suffix", "[[Target]]\n", "[[Target]][[Other]]",
  "prefix [Label](Target.md)", "[Label](Target.md) suffix", "[Label](Target.md)\n",
])("does not silently consume only part of the supplied source: %j", (raw) => {
  expect(parseNoteLink(raw)).toBeUndefined();
});

// NL-13/25: these components are retained without influencing note lookup.
test.each([
  { name: "wikilink", sources: ["[[Target]]", "[[Target|Other]]", "![[Target#Missing|Other]]", "[[Target#^missing]]"] },
  { name: "Markdown", sources: ["[Target](Target.md)", "[Other](Target.md)", "![Other](Target.md#Missing)", "[Other](Target.md#^missing)"] },
])("display text, anchors, and embed status do not change $name resolution", ({ sources }) => {
  const notes = [
    { path: "Notes/Target.md", stored: {}, noteType: "note" },
    { path: "Notes/Other.md", stored: {}, noteType: "note" },
  ];
  const model = { notes, documents: notes, assets: new Set() } as unknown as CollectionModel;
  for (const raw of sources) {
    expect(resolveNoteLink(parseNoteLink(raw)!, "Notes/Source.md", model)).toEqual({
      kind: "note", path: "Notes/Target.md",
    });
  }
});
