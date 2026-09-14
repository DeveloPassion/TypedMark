import { expect, test } from "bun:test";
import { extractBodyLinks, parseNoteLink, type ParsedNoteLink } from "../src/note-links";

function parsedLinks(body: string): ParsedNoteLink[] {
  return extractBodyLinks(body).map(({ source, ...link }) => {
    expect(source.raw).toBe(body.slice(source.start, source.end));
    // These original HTML cases contain single-line links without containers.
    expect(source.raw).toBe(link.raw);
    return link;
  });
}

// NL-8/9/34: entering an HTML block must not change a link's source or components.
const examples: Array<{ name: string; link: ParsedNoteLink }> = [
  {
    name: "literal less-than signs in every wiki component",
    link: { raw: "[[A<B#Heading<C|Label<D]]", form: "wikilink", target: "A<B", anchor: "Heading<C", displayText: "Label<D", embed: false },
  },
  {
    name: "an angle-bracketed Markdown destination",
    link: { raw: "[Label](<N.md#Heading>)", form: "markdown", target: "N.md", anchor: "Heading", displayText: "Label", embed: false },
  },
  {
    name: "a literal less-than sign in a Markdown label",
    link: { raw: "[A < B](N.md#Heading)", form: "markdown", target: "N.md", anchor: "Heading", displayText: "A < B", embed: false },
  },
  {
    name: "inline HTML in a Markdown label",
    link: { raw: "[<em>Label</em>](N.md#Heading)", form: "markdown", target: "N.md", anchor: "Heading", displayText: "<em>Label</em>", embed: false },
  },
  {
    name: "authored literal entity text in wiki components",
    link: { raw: "[[A&lt;B#Heading&lt;C|Label&lt;D]]", form: "wikilink", target: "A&lt;B", anchor: "Heading&lt;C", displayText: "Label&lt;D", embed: false },
  },
  {
    name: "authored literal entity text in a Markdown label and anchor",
    link: { raw: "[Label&lt;D](N.md#Heading&lt;C)", form: "markdown", target: "N.md", anchor: "Heading&lt;C", displayText: "Label&lt;D", embed: false },
  },
  {
    name: "less-than signs beside literal entities in wiki components",
    link: { raw: "[[A<B&lt;C#H<I&lt;J|D<E&lt;F]]", form: "wikilink", target: "A<B&lt;C", anchor: "H<I&lt;J", displayText: "D<E&lt;F", embed: false },
  },
  {
    name: "less-than signs beside literal entities in a Markdown label",
    link: { raw: "[A < B &lt; C](N.md#Heading)", form: "markdown", target: "N.md", anchor: "Heading", displayText: "A < B &lt; C", embed: false },
  },
];

test.each(examples)("preserves $name when extracting from HTML", ({ link }) => {
  expect(parseNoteLink(link.raw)).toEqual(link);
  expect(parsedLinks(`<div>\n${link.raw}\n</div>`)).toEqual([link]);
});

test("preserves source order and embed flags across prose and HTML", () => {
  const expected: ParsedNoteLink[] = [
    { raw: "[[Before]]", form: "wikilink", target: "Before", embed: false },
    { raw: "![[A<B#^block<C|Label<D]]", form: "wikilink", target: "A<B", anchor: "^block<C", displayText: "Label<D", embed: true },
    { raw: "![Alt < text](<N.md#Heading>)", form: "markdown", target: "N.md", anchor: "Heading", displayText: "Alt < text", embed: true },
    { raw: "[[A&lt;B]]", form: "wikilink", target: "A&lt;B", embed: false },
    { raw: "[After](After.md)", form: "markdown", target: "After.md", displayText: "After", embed: false },
  ];
  const body = [
    expected[0]!.raw, "", "<div>", expected[1]!.raw, expected[2]!.raw, expected[3]!.raw,
    "</div>", "", expected[4]!.raw,
  ].join("\n");
  expect(parsedLinks(body)).toEqual(expected);
});

test("preserves links inside an ordinary HTML comment", () => {
  expect(parsedLinks("<!-- See [[A<B#Heading<C|Label<D]]. -->")).toEqual([{
    raw: "[[A<B#Heading<C|Label<D]]", form: "wikilink", target: "A<B",
    anchor: "Heading<C", displayText: "Label<D", embed: false,
  }]);
});

// NL-35/37: source restoration must retain the supported code boundaries.
test("does not extract inline code spans while examining HTML content", () => {
  const body = "<div>\n`[[Hidden<Wiki]] [Hidden](<Hidden.md#Heading>)`\n[[Visible]]\n</div>";
  expect(parsedLinks(body)).toEqual([{
    raw: "[[Visible]]", form: "wikilink", target: "Visible", embed: false,
  }]);
});

test.each(["```", "~~~"])("does not inspect HTML inside a %s fenced code block", (fence) => {
  const body = `${fence}html\n<div>\n[[Hidden<Wiki]] ![Hidden](<Hidden.md#Heading>)\n</div>\n${fence}`;
  expect(extractBodyLinks(body)).toEqual([]);
});

test("does not inspect HTML inside indented code", () => {
  const body = "    <div>\n    [[Hidden<Wiki]] ![Hidden](<Hidden.md#Heading>)\n    </div>";
  expect(extractBodyLinks(body)).toEqual([]);
});

test("retains wiki escaping while examining HTML content", () => {
  const body = "<div>\n\\[[Hidden<Wiki]] [[Visible]]\n</div>";
  expect(parsedLinks(body)).toEqual([{
    raw: "[[Visible]]", form: "wikilink", target: "Visible", embed: false,
  }]);
});

// RHT-105/106: the descriptor is metadata; its materialized body stays ordinary Markdown.
test("ignores expansion descriptor links while extracting materialized content", () => {
  const body = [
    '<!-- typedmark:expansion {"id":"summary","mode":"manual","state":"materialized","source":{"kind":"note_field","note":"[[Hidden<Source]]","field":"summary"},"render":{"item":"${value}"}} -->',
    "[[Visible]]", "<!-- /typedmark:expansion -->",
  ].join("\n");
  expect(parsedLinks(body)).toEqual([{
    raw: "[[Visible]]", form: "wikilink", target: "Visible", embed: false,
  }]);
});

// RHT-194/195: template-region markers do not make their static body opaque.
test("extracts template-region content between its marker lines", () => {
  const body = [
    '<!-- typedmark:template-region {"id":"guidance"} -->',
    "[[Visible]]", "<!-- /typedmark:template-region -->",
  ].join("\n");
  expect(parsedLinks(body)).toEqual([{
    raw: "[[Visible]]", form: "wikilink", target: "Visible", embed: false,
  }]);
});

test("large HTML prose does not rescan its full suffix for every tag", () => {
  const body = "<div>\n" + "<span>x</span> ".repeat(40_000) + "\n[[N]]\n</div>";
  const started = performance.now();
  expect(parsedLinks(body)).toEqual([{ raw: "[[N]]", form: "wikilink", target: "N", embed: false }]);
  // The original 300 KB guard missed residual quadratic HTML masking at 600 KB.
  expect(performance.now() - started).toBeLessThan(3_000);
}, 20_000);
