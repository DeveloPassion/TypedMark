import { expect, test } from "bun:test";
import { inspectBodyLinks, parseNoteLink, type ExtractedNoteLink } from "../src/note-links";

function expectSource(body: string, link: ExtractedNoteLink, start: number, physical: string) {
  expect(link.source).toEqual({ start, end: start + physical.length, raw: physical });
  expect(body.slice(link.source.start, link.source.end)).toBe(physical);
}

// These bounded inputs expose repeated whole-input work. The generous ceiling
// is a regression guard, not a maximum supported link or note size.
test("parses a large escaped destination without repeatedly scanning the whole input", () => {
  const raw = "[label](" + "N\\!".repeat(200_000) + ".md)";
  const target = "N!".repeat(200_000) + ".md";
  const started = performance.now();
  const parsed = parseNoteLink(raw);
  const elapsed = performance.now() - started;

  expect(parsed).toEqual({ raw, form: "markdown", target, displayText: "label", embed: false });
  expect(elapsed).toBeLessThan(3_000);
}, 60_000);

test("finds a link after large escaped prose without repeatedly scanning the whole input", () => {
  const prefix = "é 🧭 " + "N\\! ".repeat(150_000);
  const raw = "[📝 label](N\\!%20note.md)";
  const body = prefix + raw + " after.";
  const started = performance.now();
  const inspected = inspectBodyLinks(body);
  const elapsed = performance.now() - started;

  expect(inspected.failures).toEqual([]);
  expect(inspected.links).toHaveLength(1);
  expect(inspected.links[0]).toMatchObject({
    raw, form: "markdown", target: "N! note.md", displayText: "📝 label", embed: false,
  });
  expectSource(body, inspected.links[0]!, prefix.length, raw);
  expect(elapsed).toBeLessThan(3_000);
}, 60_000);

test("retains a large escaped multiline label and its physical body span promptly", () => {
  const prefix = "é 🧭 Before\r\n\r\n> ";
  const label = "N\\! ".repeat(120_000);
  const physical = `[${label}\r\n> 📝 end](N.md)`;
  const raw = `[${label}\n📝 end](N.md)`;
  const body = prefix + physical;
  const started = performance.now();
  const inspected = inspectBodyLinks(body);
  const elapsed = performance.now() - started;

  expect(inspected.failures).toEqual([]);
  expect(inspected.links).toHaveLength(1);
  expect(inspected.links[0]).toMatchObject({
    raw, form: "markdown", target: "N.md", displayText: `${label}\n📝 end`, embed: false,
  });
  expectSource(body, inspected.links[0]!, prefix.length, physical);
  expect(elapsed).toBeLessThan(3_000);
}, 60_000);

test("finds a link after many code spans without repeatedly scanning the whole input", () => {
  const prefix = "`x` ".repeat(150_000);
  const raw = "[[Visible]]";
  const body = prefix + raw;
  const started = performance.now();
  const inspected = inspectBodyLinks(body);
  const elapsed = performance.now() - started;

  expect(inspected.failures).toEqual([]);
  expect(inspected.links).toHaveLength(1);
  expect(inspected.links[0]).toMatchObject({ raw, form: "wikilink", target: "Visible", embed: false });
  expectSource(body, inspected.links[0]!, prefix.length, raw);
  expect(elapsed).toBeLessThan(3_000);
}, 60_000);

test.each([
  { name: "LF", eol: "\n" },
  { name: "CRLF", eol: "\r\n" },
  { name: "CR", eol: "\r" },
])("preserves escapes, nested labels and Unicode across $name physical source", ({ eol }) => {
  const prefix = `é 漢 \uE000 🧭 Before${eol}${eol}> `;
  const image = "![📝 \\[alt\\]](Image%20note.md)";
  const firstLine = "é 漢 \uE000 🧩 \\*escaped\\* \\[\\[Hidden\\]\\] `[[Code]]` [nested label]";
  const physical = `[${firstLine}${eol}> ${image}](Outer\\!%20note.md)`;
  const raw = `[${firstLine}\n${image}](Outer\\!%20note.md)`;
  const body = prefix + physical + " after.";
  const inspected = inspectBodyLinks(body);

  expect(parseNoteLink(physical)).toEqual({
    raw: physical, form: "markdown", target: "Outer! note.md",
    displayText: `${firstLine}${eol}> ${image}`, embed: false,
  });
  expect(inspected.failures).toEqual([]);
  expect(inspected.links).toHaveLength(2);
  expect(inspected.links[0]).toMatchObject({
    raw, form: "markdown", target: "Outer! note.md", displayText: `${firstLine}\n${image}`, embed: false,
  });
  expect(inspected.links[1]).toMatchObject({
    raw: image, form: "markdown", target: "Image note.md", displayText: "📝 \\[alt\\]", embed: true,
  });
  expectSource(body, inspected.links[0]!, prefix.length, physical);
  expectSource(body, inspected.links[1]!, prefix.length + 1 + firstLine.length + eol.length + 2, image);
});

test("retains literal HTML, escaped decoys and code exclusions beside Unicode links", () => {
  const prefix = "é \uE000 🧭\r\n\r\n> <div data-note='[[Attribute]]'>\r\n> ";
  const decoys = "\\[[Escaped]] `[Code](Hidden.md)` ";
  const physical = "[<em>é 📝 \\[label\\]</em>\r\n> next](N\\!%20note.md)";
  const raw = "[<em>é 📝 \\[label\\]</em>\nnext](N\\!%20note.md)";
  const suffix = " <!-- [[Comment]] -->\r\n> </div>";
  const body = prefix + decoys + physical + suffix;
  const inspected = inspectBodyLinks(body);

  expect(inspected.failures).toEqual([]);
  expect(inspected.links).toHaveLength(3);
  expect(inspected.links[0]).toMatchObject({ raw: "[[Attribute]]", form: "wikilink", target: "Attribute", embed: false });
  expect(inspected.links[1]).toMatchObject({
    raw, form: "markdown", target: "N! note.md", displayText: "<em>é 📝 \\[label\\]</em>\nnext", embed: false,
  });
  expect(inspected.links[2]).toMatchObject({ raw: "[[Comment]]", form: "wikilink", target: "Comment", embed: false });
  expectSource(body, inspected.links[0]!, prefix.indexOf("[[Attribute]]"), "[[Attribute]]");
  expectSource(body, inspected.links[1]!, prefix.length + decoys.length, physical);
  expectSource(body, inspected.links[2]!, prefix.length + decoys.length + physical.length + " <!-- ".length, "[[Comment]]");
});
