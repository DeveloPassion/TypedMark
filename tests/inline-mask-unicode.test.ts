import { expect, test } from "bun:test";
import { inspectBodyLinks, parseNoteLink, type ExtractedNoteLink } from "../src/note-links";

// CommonMark 0.31.2 retains the backslash before these non-ASCII characters.
// Neither character changes the adjacent link/image or inline-code boundary.
const astralCharacters = [
  { name: "astral symbol", character: "🧭" },
  { name: "astral punctuation", character: "𐄀" },
];

function expectLinks(body: string, links: ExtractedNoteLink[]) {
  const inspected = inspectBodyLinks(body);
  expect(inspected).toEqual({ links, failures: [] });
  for (const link of inspected.links) {
    expect(body.slice(link.source.start, link.source.end)).toBe(link.source.raw);
  }
}

test.each(astralCharacters)("a backslash before an $name preserves a preceding link and image", ({ character }) => {
  const prefix = "**_**";
  for (const embed of [false, true]) {
    const raw = `${embed ? "!" : ""}[label](N.md)`;
    const parsed = { raw, form: "markdown" as const, target: "N.md", displayText: "label", embed };
    const expected = [{ ...parsed, source: { start: prefix.length, end: prefix.length + raw.length, raw } }];

    expect(parseNoteLink(raw)).toEqual(parsed);
    expectLinks(prefix + raw + character, expected);
    expectLinks(prefix + raw + "\\" + character, expected);
  }
});

test.each(astralCharacters)("a backslash before an $name cannot expose a link inside inline code", ({ character }) => {
  const prefix = "**_**`[hidden](Hidden.md)`\\" + character + " ";
  const raw = "[last](Last.md)";
  const body = prefix + raw;

  expectLinks(body, [{
    raw, form: "markdown", target: "Last.md", displayText: "last", embed: false,
    source: { start: prefix.length, end: body.length, raw },
  }]);
});

test("a backslash before an astral symbol preserves a nested image's embed marker and full span", () => {
  const prefix = "📝 ";
  const image = "![alt](Image.md)";
  const displayText = `**_**${image}\\🧭`;
  const raw = `[${displayText}](Outer.md)`;
  const parsed = { raw, form: "markdown" as const, target: "Outer.md", displayText, embed: false };
  const imageStart = prefix.length + 1 + "**_**".length;

  expect(parseNoteLink(raw)).toEqual(parsed);
  expectLinks(prefix + raw, [
    { ...parsed, source: { start: prefix.length, end: prefix.length + raw.length, raw } },
    {
      raw: image, form: "markdown", target: "Image.md", displayText: "alt", embed: true,
      source: { start: imageStart, end: imageStart + image.length, raw: image },
    },
  ]);
});

test.each(["[hidden](Hidden.md)", "![hidden](Hidden.md)", "[[Hidden]]"])(
  "a backslash inside code does not escape its closing backtick around %s", (hidden) => {
    const body = "_`_" + hidden + "\\`\\🧭";
    expectLinks(body, []);
  },
);

test.each(["[[Visible]]", "![[Visible]]"])("unmatched backtick runs do not exclude %s", (raw) => {
  const body = "``" + raw + "`";
  expectLinks(body, [{
    raw, form: "wikilink", target: "Visible", embed: raw.startsWith("!"),
    source: { start: 2, end: 2 + raw.length, raw },
  }]);
  expectLinks("``" + raw + "``", []);
});
