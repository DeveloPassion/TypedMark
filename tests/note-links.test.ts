import { expect, test } from "bun:test";
import { extractBodyLinks, parseNoteLink, resolveNoteLink } from "../src/note-links";
import type { CollectionModel } from "../src/validator";

test("parses wikilinks, encoded Markdown destinations, anchors, and embeds", () => {
  expect(parseNoteLink("[[area-id#Heading|Label]]")).toMatchObject({ form: "wikilink", target: "area-id", embed: false });
  expect(parseNoteLink("[label](../Areas/My%20Area.md#Heading)")).toMatchObject({ form: "markdown", target: "../Areas/My Area.md" });
  expect(parseNoteLink("![[Area]]")?.embed).toBe(true);
  expect(parseNoteLink("[external](https://example.com)")).toBeUndefined();
});

test("extracts links from prose and embeds while excluding code and escaped wikilinks", () => {
  const links = extractBodyLinks("[[A]] ![[B]] [C](C.md)\n\n`[[Inline]]`\n\n```md\n[[Fence]]\n```\n\n    [[Indented]]\n\n\\[[Escaped]]\n");
  expect(links.map((link) => link.target)).toEqual(["A", "B", "C.md"]);
});

test("resolves IDs before basenames and aliases, and rejects escaping paths", () => {
  const notes = [
    { path: "Areas/Named.md", stored: { id: "stable" }, noteType: "area" },
    { path: "Projects/stable.md", stored: { aliases: ["Named"] }, noteType: "project" },
  ];
  const model = { notes, documents: notes, assets: new Set() } as unknown as CollectionModel;
  expect(resolveNoteLink(parseNoteLink("[[stable]]")!, "Projects/Source.md", model)).toEqual({ kind: "note", path: "Areas/Named.md" });
  expect(resolveNoteLink(parseNoteLink("[[Named]]")!, "Projects/Source.md", model)).toEqual({ kind: "note", path: "Areas/Named.md" });
  expect(() => resolveNoteLink(parseNoteLink("[x](../../Outside.md)")!, "Projects/Source.md", model)).toThrow("NL-16");
});

test("resolves assets before appending .md and never uses host case folding", () => {
  const model = { notes: [], documents: [{ path: "Notes/Diagram.md" }], assets: new Set(["Notes/Diagram"]) } as unknown as CollectionModel;
  expect(resolveNoteLink(parseNoteLink("[x](Diagram)")!, "Notes/Source.md", model)).toEqual({ kind: "asset", path: "Notes/Diagram" });
  expect(resolveNoteLink(parseNoteLink("[x](diagram.md)")!, "Notes/Source.md", model)).toEqual({ kind: "unresolved" });
});
