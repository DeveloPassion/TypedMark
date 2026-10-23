import { afterEach, expect, test } from "bun:test";
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { tmpdir } from "node:os";
import { applySuggestions, suggestTypes } from "../src/suggest-types";
import { parseMarkdown } from "../src/frontmatter";

const roots: string[] = [];
const schemaDirectory = resolve(import.meta.dir, "../../TypedMarkSpecification/schema/json-schema");
afterEach(() => {
  for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true });
});

const schemas: Record<string, string> = {
  project: `storage: {folder_pattern: Projects, note_name_pattern: "{title}"}
mandatory_tags: [type/project]
frontmatter:
  status: {type: text, allowed_values: [active, done], nullable: false, default_value: active}
  due: {type: date, nullable: true, default_value: null}`,
  meeting: `storage: {folder_pattern: Meetings, note_name_pattern: "{title}"}
frontmatter:
  meeting_date: {type: date, nullable: false}
  attendees: {type: list, items: {type: text}, default_value: []}`,
  person: `storage: {folder_pattern: People, note_name_pattern: "{title}"}
frontmatter:
  email: {type: text, nullable: true, default_value: null}`,
};

function collection(notes: Record<string, string>) {
  const root = mkdtempSync(join(tmpdir(), "typedmark-suggest-"));
  roots.push(root);
  const files: Record<string, string> = {
    "typedmark.md": "---\nspecification_version: 0.1.0\nname: suggest\ndescription: Suggestions.\n---\n",
    ...Object.fromEntries(
      Object.entries(schemas).map(([name, body]) => [
        `.typedmark/schemas/${name}.md`,
        `---\nspecification_version: 0.1.0\ndescription: ${name}.\n${body}\n---\n`,
      ]),
    ),
    ...notes,
  };
  for (const [path, source] of Object.entries(files)) {
    mkdirSync(dirname(join(root, path)), { recursive: true });
    writeFileSync(join(root, path), source);
  }
  return root;
}
const byPath = (root: string) => Object.fromEntries(suggestTypes(root, schemaDirectory).map((suggestion) => [suggestion.path, suggestion]));

test("a misspelled note_type in the right folder is a high-confidence suggestion", () => {
  const root = collection({ "Projects/Launch.md": "---\nnote_type: projct\nstatus: active\ntags: [type/project]\n---\n" });
  const suggestion = byPath(root)["Projects/Launch.md"];
  expect(suggestion).toMatchObject({ stored_type: "projct", confidence: "high" });
  expect(suggestion.candidates[0]!.type).toBe("project");
  expect(suggestion.candidates[0].reasons).toEqual(
    expect.arrayContaining([expect.stringContaining("1 edit(s)"), "path matches its storage", "shares fields status"]),
  );
});

test("fields and folder alone can identify an untyped note", () => {
  const root = collection({ "Meetings/Kickoff.md": "---\nmeeting_date: 2026-10-23\nattendees: [Ana]\n---\n\nNotes.\n" });
  expect(byPath(root)["Meetings/Kickoff.md"]).toMatchObject({ confidence: "high" });
  expect(byPath(root)["Meetings/Kickoff.md"].candidates[0]!.type).toBe("meeting");
});

test("weak or conflicting evidence stays low or medium confidence", () => {
  const root = collection({
    "Inbox/Thing.md": "---\nemail: a@example.com\n---\n",
    "Inbox/Nothing.md": "Just text.\n",
    "Meetings/Missing date.md": "---\nattendees: [Ana]\n---\n",
  });
  const suggestions = byPath(root);
  expect(suggestions["Inbox/Thing.md"].confidence).not.toBe("high");
  expect(suggestions["Inbox/Nothing.md"]).toMatchObject({ confidence: "low", candidates: [] });
  expect(suggestions["Meetings/Missing date.md"].candidates[0]).toMatchObject({
    type: "meeting",
    reasons: expect.arrayContaining(["lacks required meeting_date"]),
  });
});

test("managed notes are not reported", () => {
  const root = collection({ "People/Ana.md": "---\nnote_type: person\ntitle: Ana\n---\n" });
  expect(suggestTypes(root, schemaDirectory)).toEqual([]);
});

test("--write types only high-confidence notes that then validate, keeping the body", () => {
  const root = collection({
    "Projects/Launch.md": "---\nnote_type: projct\nstatus: active\ntags: [type/project]\n---\r\n\r\nBody kept.\r\n",
    "Meetings/Kickoff.md": "---\nmeeting_date: 2026-10-23\nattendees: [Ana]\n---\n",
    "Projects/Broken.md": "---\nnote_type: projct\nstatus: archived\ntags: [type/project]\n---\n",
    "Inbox/Thing.md": "---\nemail: a@example.com\n---\n",
  });
  const suggestions = suggestTypes(root, schemaDirectory);
  const applied = applySuggestions(root, schemaDirectory, suggestions);
  expect(applied.sort()).toEqual(["Meetings/Kickoff.md", "Projects/Launch.md"]);
  expect(readFileSync(join(root, "Projects/Launch.md"), "utf8")).toEndWith("---\n\r\nBody kept.\r\n");
  expect(parseMarkdown(readFileSync(join(root, "Projects/Launch.md"))).data.note_type).toBe("project");
  // An invalid status would make the typed note fail, so the original stays.
  expect(readFileSync(join(root, "Projects/Broken.md"), "utf8")).toContain("note_type: projct");
  expect(readFileSync(join(root, "Inbox/Thing.md"), "utf8")).not.toContain("note_type");
});

test("a note without frontmatter gets one when typed", () => {
  const root = collection({ "People/Ana.md": "# Ana\n" });
  const suggestions = suggestTypes(root, schemaDirectory);
  expect(suggestions[0]).toMatchObject({ path: "People/Ana.md" });
  expect(suggestions[0]!.candidates[0]!.type).toBe("person");
  // Path alone is not enough for high confidence, so nothing is written.
  expect(applySuggestions(root, schemaDirectory, suggestions)).toEqual([]);
  expect(applySuggestions(root, schemaDirectory, [{ ...suggestions[0]!, confidence: "high" }])).toEqual(["People/Ana.md"]);
  expect(readFileSync(join(root, "People/Ana.md"), "utf8")).toBe("---\nnote_type: person\n---\n# Ana\n");
});
