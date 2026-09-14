import { expect, test } from "bun:test";
import { extractBodyLinks } from "../src/note-links";

const lineEndings = [
  { name: "LF", eol: "\n" },
  { name: "CRLF", eol: "\r\n" },
  { name: "CR", eol: "\r" },
];

// Structural assertions keep these regressions compilable before the additive
// source field exists. Offsets are UTF-16 positions into the exact input body.
function expectSource(link: unknown, start: number, raw: string) {
  expect(link).toHaveProperty("source", { start, end: start + raw.length, raw });
}

test.each([
  { raw: "[[Cafe\u0301#Re\u0301sume\u0301|📝 Label]]", form: "wikilink", embed: false },
  { raw: "![[Cafe\u0301#Re\u0301sume\u0301|📝 Label]]", form: "wikilink", embed: true },
  { raw: "[📝 Label](Cafe%CC%81.md#Re%CC%81sume%CC%81)", form: "markdown", embed: false },
  { raw: "![📝 Label](Cafe%CC%81.md#Re%CC%81sume%CC%81)", form: "markdown", embed: true },
])("locates the complete $form source including embed=$embed and Unicode", ({ raw, form, embed }) => {
  const prefix = "🧭 Cafe\u0301 says: ";
  const body = prefix + raw + " after 🧩.";
  const links = extractBodyLinks(body);

  expect(links).toHaveLength(1);
  expect(links[0]).toMatchObject({
    raw, form, embed, displayText: "📝 Label",
    target: form === "wikilink" ? "Cafe\u0301" : "Cafe\u0301.md",
    anchor: form === "wikilink" ? "Re\u0301sume\u0301" : "Re%CC%81sume%CC%81",
  });
  expectSource(links[0], prefix.length, raw);
});

test.each(lineEndings)("preserves physical $name line endings in a flat multiline link", ({ eol }) => {
  const prefix = `Opening${eol}${eol}Before `;
  const raw = `[first${eol}second](Target.md#Heading)`;
  const links = extractBodyLinks(prefix + raw + " after.");

  expect(links).toHaveLength(1);
  expect(links[0]).toMatchObject({
    raw: "[first\nsecond](Target.md#Heading)", form: "markdown", target: "Target.md",
    displayText: "first\nsecond", anchor: "Heading", embed: false,
  });
  expectSource(links[0], prefix.length, raw);
});

const containers = [
  { container: "blockquote", opening: "> Before ", continuation: "> " },
  { container: "list in blockquote", opening: "> - Before ", continuation: ">   " },
  { container: "blockquote in list", opening: "- > Before ", continuation: "  > " },
  { container: "lazy blockquote continuation", opening: "> Before ", continuation: "" },
];

test.each(lineEndings.flatMap((ending) => containers.map((container) => ({ ...ending, ...container }))))(
  "includes internal prefixes in a $container link with $name line endings",
  ({ eol, opening, continuation }) => {
    const prefix = `Heading${eol}${eol}${opening}`;
    const raw = `[first${eol}${continuation}second](Target.md#Heading)`;
    const links = extractBodyLinks(prefix + raw + " after.");

    expect(links).toHaveLength(1);
    expect(links[0]).toMatchObject({
      raw: "[first\nsecond](Target.md#Heading)", form: "markdown", target: "Target.md",
      displayText: "first\nsecond", anchor: "Heading", embed: false,
    });
    expectSource(links[0], prefix.length, raw);
  },
);

test.each(lineEndings)("includes a multiline destination and title in the $name physical span", ({ eol }) => {
  const prefix = "> ";
  const raw = `[label](${eol}> Target.md#Heading${eol}> "A title")`;
  const links = extractBodyLinks(prefix + raw + " after.");

  expect(links).toHaveLength(1);
  expect(links[0]).toMatchObject({
    raw: '[label](\nTarget.md#Heading\n"A title")', form: "markdown", target: "Target.md",
    displayText: "label", anchor: "Heading", embed: false,
  });
  expectSource(links[0], prefix.length, raw);
});

test.each(lineEndings.flatMap((ending) => [
  { ...ending, form: "wikilink", raw: "[[Same]]", target: "Same" },
  { ...ending, form: "markdown", raw: "[Same](Same.md)", target: "Same.md" },
]))("locates repeated $form occurrences after excluded decoys with $name endings", ({ eol, raw, target }) => {
  const prefix = [
    `\`${raw}\``, "", "```md", raw, "```", "", "~~~md", raw, "~~~", "",
    `    ${raw}`, "", `\\${raw}`, "", "Before ",
  ].join(eol);
  const between = " and ";
  const htmlOpening = `${eol}${eol}<div>`;
  const body = prefix + raw + between + raw + htmlOpening + raw + "</div>";
  const links = extractBodyLinks(body);

  expect(links.map((link) => link.target)).toEqual([target, target, target]);
  expectSource(links[0], prefix.length, raw);
  expectSource(links[1], prefix.length + raw.length + between.length, raw);
  expectSource(links[2], prefix.length + 2 * raw.length + between.length + htmlOpening.length, raw);
});

test.each(lineEndings)("maps an HTML-contained multiline link through a blockquote with $name endings", ({ eol }) => {
  const prefix = `Before${eol}${eol}> <div>${eol}> `;
  const raw = `![first${eol}> second](<Target.md#Heading> 'title')`;
  const suffix = `${eol}> </div>${eol}${eol}After [[Last]]`;
  const links = extractBodyLinks(prefix + raw + suffix);

  expect(links.map((link) => link.target)).toEqual(["Target.md", "Last"]);
  expect(links[0]).toMatchObject({
    raw: "![first\nsecond](<Target.md#Heading> 'title')", form: "markdown", target: "Target.md",
    displayText: "first\nsecond", anchor: "Heading", embed: true,
  });
  expectSource(links[0], prefix.length, raw);
  expectSource(links[1], prefix.length + raw.length + suffix.length - "[[Last]]".length, "[[Last]]");
});

test.each(lineEndings)("retains offsets past marker metadata while excluding its links with $name endings", ({ eol }) => {
  const raw = "[[Same]]";
  const expansionStart = '<!-- typedmark:expansion {"id":"summary","mode":"manual","state":"materialized","source":{"kind":"note_field","note":"[[Same]]","field":"summary"},"render":{"item":"${value}"}} -->';
  const prefix = expansionStart + eol;
  const between = [
    "", "<!-- /typedmark:expansion -->", "",
    '<!-- typedmark:template-region {"id":"guidance"} -->', "",
  ].join(eol);
  const suffix = `${eol}<!-- /typedmark:template-region -->${eol}`;
  const links = extractBodyLinks(prefix + raw + between + raw + suffix);

  expect(links.map((link) => link.target)).toEqual(["Same", "Same"]);
  expectSource(links[0], prefix.length, raw);
  expectSource(links[1], prefix.length + raw.length + between.length, raw);
});

test("keeps overlapping parent and nested-image spans in source order", () => {
  const prefix = "Before ";
  const image = "![Alt](Image.md)";
  const outer = `[${image}](Page.md)`;
  const between = " after ";
  const last = "[[Last]]";
  const links = extractBodyLinks(prefix + outer + between + last);

  expect(links.map((link) => link.target)).toEqual(["Page.md", "Image.md", "Last"]);
  expectSource(links[0], prefix.length, outer);
  expectSource(links[1], prefix.length + 1, image);
  expectSource(links[2], prefix.length + outer.length + between.length, last);
});

test.each([
  { body: "[\\[\\[Hidden\\]\\]](Outer.md)", targets: ["Outer.md"] },
  { body: "[\\[Hidden\\](Hidden.md)](Outer.md)", targets: ["Outer.md"] },
  { body: "[\\[\\[Hidden\\]\\]][ref]\n\n[ref]: Outer.md", targets: [] },
])("escaped authored labels do not create phantom descendants: $body", ({ body, targets }) => {
  expect(extractBodyLinks(body).map((link) => link.target)).toEqual([...targets]);
});

test.each([
  "<!-- start\n\n[x]: [[Visible]]\n\nend -->",
  "<!-- start\n\n    [[Visible]]\n\nend -->",
  "<!-- start\n```\n[[Visible]]\nend -->",
])("HTML content does not acquire invented reference/code blocks: %j", (body) => {
  const links = extractBodyLinks(body);
  expect(links.map((link) => link.target)).toEqual(["Visible"]);
  expectSource(links[0], body.indexOf("[[Visible]]"), "[[Visible]]");
});

test.each([
  "[ref]: Elsewhere.md\r\n[[Visible]]\r\n---",
  ">\t[[Visible]]",
  "-\t[[Visible]]",
  "[[Visible]]\r",
])("source positions survive reference-prefix, tab, and EOF processing: %j", (body) => {
  const links = extractBodyLinks(body);
  expect(links.map((link) => link.target)).toEqual(["Visible"]);
  expectSource(links[0], body.indexOf("[[Visible]]"), "[[Visible]]");
});

test("block preprocessing does not coerce original note-link characters", () => {
  const raw = "[[A\0B#H\0I|D\0E]]", body = "> " + raw;
  const links = extractBodyLinks(body);
  expect(links[0]).toMatchObject({ raw, target: "A\0B", anchor: "H\0I", displayText: "D\0E" });
  expectSource(links[0], 2, raw);
});

test("a blank line ending an HTML block still permits a real indented code block", () => {
  expect(extractBodyLinks("<div>\n\n    [[Hidden]]\n\n</div>")).toEqual([]);
});

test.each(["## [[Visible]] ###", "> # [[Visible]] #", "- ## [[Visible]]", ">\t## [[Visible]]", "-\t# [[Visible]]", "#\t[[Visible]]"])(
  "captures ATX source without treating heading/container prefixes as link text: %j", (body) => {
    const links = extractBodyLinks(body);
    expect(links.map((link) => link.target)).toEqual(["Visible"]);
    expectSource(links[0], body.indexOf("[[Visible]]"), "[[Visible]]");
  },
);

test("maps partially consumed tabs without inventing physical spaces", () => {
  const body = "> <div>\r\n> [one\r\n>\ttwo](N.md)\r\n> </div>";
  const raw = "[one\r\n>\ttwo](N.md)";
  const links = extractBodyLinks(body);
  expect(links[0]).toMatchObject({ raw: "[one\n  two](N.md)", displayText: "one\n  two", target: "N.md" });
  expectSource(links[0], body.indexOf("[one"), raw);
});

test.each([
  "[ref]: Elsewhere.md\n=\n[[Visible]]",
  "[ref]: Elsewhere.md\n===\n[[Visible]]",
  "> [ref]: Elsewhere.md\n> =\n> [[Visible]]",
])("a removed reference prefix can be followed by more paragraph content: %j", (body) => {
  const links = extractBodyLinks(body);
  expect(links.map((link) => link.target)).toEqual(["Visible"]);
  expectSource(links[0], body.indexOf("[[Visible]]"), "[[Visible]]");
});

test("a reference followed by an empty setext candidate does not require any links", () => {
  expect(extractBodyLinks("[ref]: Elsewhere.md\n=")).toEqual([]);
});

test.each(["[[A]]", "[[A]] <!-- typedmark:ordinary -->"])("nested emphasis does not repeatedly lex unchanged subtrees: %s", (content) => {
  let body: string = content;
  for (let depth = 0; depth < 320; depth++) body = `*x ${body} x*`;
  const started = performance.now();
  const links = extractBodyLinks(body);
  expect(links.map((link) => link.target)).toEqual(["A"]);
  expectSource(links[0], body.indexOf("[[A]]"), "[[A]]");
  expect(performance.now() - started).toBeLessThan(1_000);
}, 20_000);
