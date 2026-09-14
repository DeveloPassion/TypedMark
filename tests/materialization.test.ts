import { expect, test } from "bun:test";
import { materializeStarters } from "../src/materialization";
import type { FieldDefinition } from "../src/field-values";
import type { TemplateSchema } from "../src/templates";

const schema = { frontmatter: {
  status: { type: "text", default_value: "draft" },
  amount: { type: "integer", nullable: true, default_value: 5 },
} satisfies Record<string, FieldDefinition>, mandatory_tags: ["type/note"] };
const inputs = (data = {}, values = {}) => [{ noteType: "note", path: "Note.md", starter: { data, body: "First  \nsecond\n" }, values }];
const schemas = new Map([["note", schema]]);

test("materialization replaces template placeholders with defaults, not explicit caller nulls", () => {
  const [note] = materializeStarters(inputs({ status: null, amount: null }, { amount: null }), schemas, {});
  expect(note!.data).toEqual({ status: "draft", amount: null, tags: ["type/note"], note_type: "note" });
  expect(note!.body).toBe("First  \nsecond\n");
});

test("materialization appends mandatory tags after caller tags without erasing them", () => {
  const [note] = materializeStarters(inputs({ tags: ["template"] }, { tags: ["personal", "e\u0301"] }), schemas, { mandatory_tags: ["é", "managed"] });
  expect(note!.data.tags).toEqual(["personal", "e\u0301", "managed", "type/note"]);
  const [invalid] = materializeStarters(inputs({}, { tags: null }), schemas, { mandatory_tags: ["managed"] });
  expect(invalid!.data.tags).toBeNull();
});

test("materialization never silently changes a caller's declared note type", () => {
  expect(() => materializeStarters(inputs({}, { note_type: "other" }), schemas, {})).toThrow("MN-40");
});

test("materialization does not invent object mappings or constant values", () => {
  const types = new Map([["note", { frontmatter: { object: { type: "object" as const, nullable: true, fields: { nested: { type: "text" as const, default_value: "inside" } } },
    fixed: { type: "text" as const, nullable: true, const_value: "constant" } } }]]);
  const [note] = materializeStarters(inputs({ object: null, fixed: null }), types, {});
  expect(note!.data.object).toBeNull(); expect(note!.data.fixed).toBeNull();
});

test("declared Core generators use injected write inputs and collection timezone", () => {
  const types = new Map([["note", { frontmatter: {
    id: { type: "text" as const, generated: "uuid" }, created_at: { type: "datetime" as const },
    day: { type: "date" as const, generated: "now" }, time: { type: "time" as const, format: "hh:mm", generated: "now" },
  } }]]);
  const [note] = materializeStarters(inputs(), types, { timezone: "Europe/Brussels" }, {
    instant: () => "2026-07-01T22:30:00Z", uuid: () => "12345678-1234-4123-8123-123456789abc",
  });
  expect(note!.data).toMatchObject({ id: "12345678-1234-4123-8123-123456789abc", created_at: "2026-07-02T00:30:00+02:00", day: "2026-07-02", time: "00:30" });
  expect(note!.data).not.toHaveProperty("updated_at");
});

test("unique generation reserves concrete values from every scaffold before generating", () => {
  const duplicate = "12345678-1234-4123-8123-123456789abc", fresh = "12345678-1234-4123-8123-123456789abd";
  const types = new Map([["note", { frontmatter: { id: { type: "text" as const, generated: "uuid" } } }]]);
  const values = [duplicate, fresh];
  const result = materializeStarters([...inputs(), { ...inputs({}, { id: duplicate })[0]!, path: "Other.md" }], types, {}, {
    instant: () => "2026-01-01T00:00:00Z", uuid: () => values.shift()!,
  });
  expect(result.map((note) => note.data.id)).toEqual([fresh, duplicate]);
});

test("declared default objects retain concrete nested nulls and empty strings", () => {
  const types = new Map([["note", { frontmatter: { object: { type: "object" as const,
    default_value: { inner: null, empty: "" }, fields: {
      inner: { type: "text" as const, nullable: true, default_value: "child-default" },
      empty: { type: "text" as const, default_value: "nonempty" },
    } } } }]]);
  const [note] = materializeStarters(inputs({ object: null }), types, {});
  expect(note!.data.object).toEqual({ inner: null, empty: "" });
});

test("unused abstract contributions do not impose collection uniqueness on unrelated types", () => {
  const types = new Map<string, TemplateSchema>([
    ["base", { abstract: true, frontmatter: { day: { type: "date", unique: "collection" } } }],
    ["note", { frontmatter: { day: { type: "date", generated: "now" } } }],
  ]);
  const notes = materializeStarters([...inputs(), { ...inputs()[0]!, path: "Other.md" }], types, {}, {
    instant: () => "2026-01-01T00:00:00Z", uuid: () => "unused",
  });
  expect(notes.map((note) => note.data.day)).toEqual(["2026-01-01", "2026-01-01"]);
});
