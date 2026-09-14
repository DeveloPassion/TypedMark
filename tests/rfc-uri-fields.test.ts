import { afterEach, expect, test } from "bun:test";
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { stringify } from "yaml";
import { validateFieldDefinition } from "../src/field-definitions";
import { validateFieldValue, validateManagedFieldConstraints, validateTemplateValue, type FieldDefinition } from "../src/field-values";
import { queryCollection } from "../src/query";
import { readCollectionModel, validateCollection } from "../src/validator";

const uri: FieldDefinition = { type: "link", format: "uri" };

// FDR-140 adopts RFC 3986 generic syntax. These cases do not impose an
// individual scheme's DNS, transport, or UTF-8 decoding requirements.
// Fragment acceptance preserves current behavior pending FDR-140 clarification.
test.each([
  "a:", "A1+.-:", "urn:example:animal:ferret:nose", "mailto:user@example.test",
  "tel:+1-816-555-1212", "data:text/plain,a%20b", "x:/absolute/path", "x:rootless/path",
  "x:?", "x:#", "x:?#", "x://", "http:", "http://", "http:///path",
  "file:///C:/notes/A.md", "x:////path", "x:path?first/second?third#fragment/part?tail",
  "x:AZaz09-._~!$&'()*+,;=:@/part?AZaz09-._~!$&'()*+,;=:@/?#AZaz09-._~!$&'()*+,;=:@/?",
  "HTTPS://EXAMPLE.test:443/a/../b/%7e?name=%2f#%41",
  "x:%20%22%3C%3E%5B%5D%5C%5E%60%7B%7C%7D?text=%C3%A9#%F0%9F%93%9D",
  "x:%00%FF%80%ED%A0%80?octets=%FF%C0%AF#%fe",
])("accepts a scheme-qualified generic URI without browser normalization: %j", (value) => {
  expect(validateFieldValue(value, uri, "UTC")).toBeUndefined();
});

test.each([
  "", "path", "/path", "//example.test/path", "?query", "#fragment", ":path",
  "1x:path", "+x:path", "-x:path", ".x:path", "x_y:path", "é:path", "x%31:path",
  "x:path%", "x:path%0", "x:path%GG", "x:path%0g", "x:path%g0",
  "x:path?query=%", "x:path?query=%1", "x:path?query=%1Z",
  "x:path#fragment%", "x:path#fragment%a", "x:path#fragment%z1", "x:path#first#second",
])("rejects invalid schemes, relative references, and malformed URI components: %j", (value) => {
  expect(validateFieldValue(value, uri, "UTC")?.rule).toBe("FDR-140");
});

test.each([
  " ", "\t", "\n", "\r", "\u0000", "\u001f", "\u007f", "\u0085", "é", "e\u0301", "📝",
  "<", ">", '"', "\\", "^", "`", "{", "|", "}", "[", "]",
])("rejects raw character %j in path, query, and fragment", (character) => {
  for (const value of [`x:before${character}after`, `x:path?q=before${character}after`, `x:path#before${character}after`]) {
    expect(validateFieldValue(value, uri, "UTC")?.rule).toBe("FDR-140");
  }
});

test.each([" x:path", "x:path ", "\tx:path", "x:path\n", "x:path\r\n"])(
  "does not trim whitespace around an otherwise valid URI: %j", (value) => {
    expect(validateFieldValue(value, uri, "UTC")?.rule).toBe("FDR-140");
  },
);

test.each([
  "x://user:password!$&'()*+,;=~@example.test/path",
  "x://%75ser:%FF@example.test/path", "x://@/path", "x://user@/path",
  "x://AZaz09-._~!$&'()*+,;=%41/path", "x://%FF/path", "x://example_test/path",
  "https://999.999.999.999/path", "x://host:/path", "x://host:0/path",
  "https://host:65535/path", "https://host:65536/path", "https://host:999999999999999999999999/path",
  "x://:80/path", "x://host:00080/path",
  "x://[::]/path", "x://[::1]/path", "x://[2001:db8::1]:65536/path",
  "x://[1:2:3:4:5:6:7:8]/path", "x://[1::]/path", "x://[1:2:3:4:5:6:7::]/path",
  "x://[::ffff:192.0.2.1]/path", "x://[1:2:3:4:5:6:192.0.2.1]/path",
  "x://[v1.a]/path", "x://[VFf.a:!$&'()*+,;=]:80/path",
])("accepts RFC authority grammar without host or port policy: %j", (value) => {
  expect(validateFieldValue(value, uri, "UTC")).toBeUndefined();
});

test.each([
  "x://user@@host/path", "x://user%G0@host/path", "x://user[info]@host/path",
  "x://höst/path", "x://host%/path", "x://host%0/path", "x://host%GH/path", "x://host\\other/path",
  "x://host:-1/path", "x://host:+1/path", "x://host:0x10/path", "x://host:port/path",
  "x://host:%31/path", "x://host:١/path", "x://host:12:34/path",
  "x://::1/path", "x://[::1/path", "x://[::1]extra/path", "x://[]/path",
  "x://[1:2:3:4:5:6:7]/path", "x://[1:2:3:4:5:6:7:8:9]/path",
  "x://[1:2:3:4:5:6:7:8::]/path", "x://[1::2::3]/path", "x://[:::1]/path",
  "x://[12345::]/path", "x://[gggg::1]/path", "x://[192.0.2.1]/path",
  "x://[::ffff:256.0.2.1]/path", "x://[::ffff:192.00.2.1]/path", "x://[fe80::1%25eth0]/path",
  "x://[v.a]/path", "x://[vG.a]/path", "x://[v1.]/path", "x://[v1.a%20]/path",
])("rejects malformed URI authorities: %j", (value) => {
  expect(validateFieldValue(value, uri, "UTC")?.rule).toBe("FDR-140");
});

test.each([
  { name: "standalone", validate: validateFieldValue },
  { name: "managed note", validate: validateManagedFieldConstraints },
  { name: "template", validate: validateTemplateValue },
])("$name validation applies URI syntax to nested object and list values", ({ validate }) => {
  const definition: FieldDefinition = { type: "object", fields: { sources: { type: "list", items: uri } } };
  expect(validate({ sources: ["https://host:65536/%FF"] }, definition, "UTC")).toBeUndefined();
  expect(validate({ sources: ["urn:valid", "https://host/bad%GG"] }, definition, "UTC")?.rule).toBe("FDR-140");
});

test.each([
  { constraint: "default", definition: { ...uri, default_value: "https://host/bad%GG" }, rule: "FDR-4" },
  { constraint: "constant", definition: { ...uri, const_value: "https://host/bad%GG" }, rule: "FDR-211" },
  { constraint: "allowed value", definition: { ...uri, allowed_values: ["https://host/bad%GG"] }, rule: "FDR-198" },
] as Array<{ constraint: string; definition: FieldDefinition; rule: string }>)("checks URI syntax in a field's $constraint", ({ definition, rule }) => {
  expect(validateFieldDefinition(definition, "UTC")?.rule).toBe(rule);
});

const schemaDirectory = resolve(import.meta.dir, "../../TypedMarkSpecification/schema/json-schema");
const roots: string[] = [];
function collection(stored: Record<string, unknown>, fields: Record<string, FieldDefinition>) {
  const root = mkdtempSync(join(tmpdir(), "typedmark-rfc-uri-fields-"));
  roots.push(root);
  const artifacts = {
    "typedmark.md": { specification_version: "0.1.0", name: "uri-fields", description: "URI fields." },
    ".typedmark/schemas/note.md": {
      specification_version: "0.1.0", description: "Note.",
      storage: { folder_pattern: "", note_name_pattern: "A" }, frontmatter: fields,
    },
    "A.md": { note_type: "note", ...stored },
  };
  for (const [path, data] of Object.entries(artifacts)) {
    mkdirSync(dirname(join(root, path)), { recursive: true });
    writeFileSync(join(root, path), `---\n${stringify(data)}---\n`);
  }
  return root;
}
afterEach(() => { for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true }); });

test("managed URI failures report FDR-140 and block dependent queries without rewriting the note", () => {
  const root = collection({ source: "https://example.test/bad%G0" }, { source: uri });
  const before = readFileSync(join(root, "A.md"));
  const report = validateCollection({ collectionRoot: root, schemaDirectory });
  expect(report.valid).toBe(false);
  expect(report.results).toContainEqual(expect.objectContaining({
    code: "invalid_field_value", rule_id: "FDR-140", path: "A.md", field: "source",
  }));
  expect(() => queryCollection({
    collectionRoot: root, schemaDirectory, queryVersion: "0.1.0",
    query: { specification_version: "0.1.0", select: [{ kind: "field", field: "source", as: "source" }] },
  })).toThrow("CM-308");
  expect(readFileSync(join(root, "A.md"))).toEqual(before);
});

test("invalid URI defaults invalidate their declaring schema", () => {
  const root = collection({}, { source: { ...uri, default_value: "https://example.test/bad%G0" } });
  expect(validateCollection({ collectionRoot: root, schemaDirectory }).results).toContainEqual(expect.objectContaining({
    code: "invalid_note_type_schema", rule_id: "FDR-4", path: ".typedmark/schemas/note.md",
  }));
});

test("valid URI defaults and query projections retain authored spelling and escaped octets", () => {
  const source = "HTTPS://EXAMPLE.test:65536/a/../%7e?octets=%FF#%41";
  const root = collection({ source }, { source: uri, fallback: { ...uri, default_value: source } });
  const before = readFileSync(join(root, "A.md"));
  expect(validateCollection({ collectionRoot: root, schemaDirectory })).toMatchObject({ valid: true, results: [] });
  expect(readCollectionModel({ collectionRoot: root, schemaDirectory }).notes[0]?.values.fallback).toBe(source);
  expect(queryCollection({
    collectionRoot: root, schemaDirectory, queryVersion: "0.1.0",
    query: { specification_version: "0.1.0", select: [{ kind: "field", field: "source", as: "source" }] },
  }).rows).toEqual([{ source }]);
  expect(readFileSync(join(root, "A.md"))).toEqual(before);
});

test("query conversion checks URI syntax in values originating from text fields", () => {
  const root = collection({ source: "https://example.test/bad%G0" }, { source: { type: "text" } });
  expect(() => queryCollection({
    collectionRoot: root, schemaDirectory, queryVersion: "0.1.0",
    query: { specification_version: "0.1.0", select: [{
      kind: "mapped_field", as: "source", definition: uri,
      sources: [{ note_types: ["note"], field: "source", conversion: "conditional" }],
    }] },
  })).toThrow("CM-488");
});
