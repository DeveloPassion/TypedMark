import { afterEach, expect, test } from "bun:test";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { stringify } from "yaml";
import { parseMarkdown } from "../src/frontmatter";
import { instantiateSystem } from "../src/system";

const schemaDirectory = resolve(import.meta.dir, "../../TypedMarkSpecification/schema/json-schema");
const roots: string[] = [];
const sources: { root: string; contents: Record<string, string> }[] = [];

afterEach(() => {
  try {
    for (const source of sources.splice(0)) expect(snapshot(source.root)).toEqual(source.contents);
  } finally {
    for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true });
  }
});

test("RHT-65/SCE-157: omitted scaffold override selects the schema's explicit template", async () => {
  const fixture = systemFixture({
    config: { metadata_directory: ".metadata" },
    schema: { template: { file: "starters/chosen.md" } },
    templates: {
      "starters/chosen.md": "The explicit schema starter.\n",
      "note.md": "The conventional starter.\n",
    },
  });

  const note = await instantiateNote(fixture);

  expect(note.body.trim()).toBe("The explicit schema starter.");
});

test("RHT-65: omitted explicit references select the existing conventional template", async () => {
  const fixture = systemFixture({
    templates: { "note.md": markdown({ description: "Conventional value" }, "Conventional body.\n") },
  });

  const note = await instantiateNote(fixture);

  expect(note.body.trim()).toBe("Conventional body.");
  expect(note.data.description).toBe("Conventional value");
});

test("an explicit scaffold template overrides the schema and conventional templates", async () => {
  const fixture = systemFixture({
    schema: { template: { file: "schema.md" } },
    scaffold: { from_template: "scaffold.md" },
    templates: {
      "schema.md": "Schema body.\n",
      "note.md": "Conventional body.\n",
      "scaffold.md": "Scaffold body.\n",
    },
  });

  const note = await instantiateNote(fixture);

  expect(note.body.trim()).toBe("Scaffold body.");
});

test("RHT-73: a missing explicit schema template rejects import without publishing a target", async () => {
  const fixture = systemFixture({
    schema: { template: { file: "missing.md" } },
    templates: { "note.md": "An available conventional fallback.\n" },
  });

  await expect(instantiateSystem(fixture.input)).rejects.toThrow("missing.md");

  expect(existsSync(fixture.target)).toBe(false);
});

test("RHT-73: a missing explicit scaffold template rejects import without publishing a target", async () => {
  const fixture = systemFixture({
    scaffold: { from_template: "missing.md" },
    templates: { "note.md": "An available conventional fallback.\n" },
  });

  await expect(instantiateSystem(fixture.input)).rejects.toThrow("missing.md");

  expect(existsSync(fixture.target)).toBe(false);
});

test("RHT-72: absent conventional templates derive empty required H2 sections in declared order", async () => {
  const fixture = systemFixture({
    schema: {
      headings: { required_h2: ["Context", "Decision"], optional_h2: ["References"], require_order: true },
    },
  });

  const note = await instantiateNote(fixture);

  expect(note.body.trim()).toBe("## Context\n\n## Decision");
  expect(existsSync(join(fixture.target, ".typedmark", "templates", "note.md"))).toBe(false);
});

test("RHT-65: derived starters retain null placeholders for declared nullable fields", async () => {
  const fixture = systemFixture({
    schema: {
      frontmatter: {
        summary: { type: "text", nullable: true },
        effort: { type: "number", nullable: true },
      },
    },
  });

  const note = await instantiateNote(fixture);

  expect(note.data.summary).toBeNull();
  expect(note.data.effort).toBeNull();
  expect(note.data.note_type).toBe("note");
  expect(note.data.title).toBe("Welcome");
  expect(note.body.trim()).toBe("");
});

test("RHT-89: derived starters supply collection and type mandatory tags in policy order", async () => {
  const fixture = systemFixture({
    config: { mandatory_tags: ["managed", "shared"] },
    schema: { mandatory_tags: ["shared", "type/note"] },
  });

  const note = await instantiateNote(fixture);

  expect(note.data.tags).toEqual(["managed", "shared", "type/note"]);
});

test("RHT-69: a body-only template retains derived declared fields", async () => {
  const fixture = systemFixture({
    schema: { frontmatter: { summary: { type: "text", nullable: true } } },
    templates: { "note.md": "Body-only starter prose.\n" },
  });

  const note = await instantiateNote(fixture);

  expect(note.data.summary).toBeNull();
  expect(note.body.trim()).toBe("Body-only starter prose.");
});

test("RHT-69/SCE-19: partial templates preserve omitted fields and concrete values while callers fill placeholders", async () => {
  const fixture = systemFixture({
    schema: {
      frontmatter: {
        summary: { type: "text", nullable: true },
        status: { type: "text", nullable: false },
        owner: { type: "text", nullable: false },
      },
    },
    scaffold: { values: { title: "Welcome", owner: "Caller owner" } },
    templates: { "note.md": markdown({ status: "draft", owner: null }, "Partial starter body.\n") },
  });

  const note = await instantiateNote(fixture);

  expect(note.data.status).toBe("draft");
  expect(note.data.owner).toBe("Caller owner");
  expect(note.data.summary).toBeNull();
  expect(note.body.trim()).toBe("Partial starter body.");
});

test("import preserves attribution body bytes and explicitly excluded conventional licensing files", async () => {
  const body = "# Attribution\r\nFirst  \r\nsecond\r\n";
  const fixture = systemFixture({ config: { exclude_paths: ["LICENSE.md"] }, body, files: { "LICENSE.md": "License text\r\n" } });
  await instantiateSystem(fixture.input);
  expect(readFileSync(join(fixture.target, "typedmark.md"), "utf8").endsWith(body)).toBe(true);
  expect(readFileSync(join(fixture.target, "LICENSE.md"), "utf8")).toBe("License text\r\n");
});

test("derived bodies materialize a required H1 from the final Core title", async () => {
  const fixture = systemFixture({ schema: { headings: { require_h1_title: true, required_h2: ["Context"] } } });
  const note = await instantiateNote(fixture);
  expect(note.body).toBe("# Welcome\n\n## Context\n");
});

test("an empty conventional licensing directory remains importable and preserved", async () => {
  const fixture = systemFixture();
  mkdirSync(join(fixture.input.sourceRoot, "LICENSES"));
  await instantiateSystem(fixture.input);
  expect(existsSync(join(fixture.target, "LICENSES"))).toBe(true);
});

test("suppressed required-value failures cannot publish an unresolved scaffold", async () => {
  const fixture = systemFixture({ config: { validation_defaults: { missing_required_field: "off" } },
    schema: { frontmatter: { status: { type: "text", nullable: false } } },
    scaffold: { values: { title: "Welcome", status: null } } });
  await expect(instantiateSystem(fixture.input)).rejects.toThrow("missing_required_field");
  expect(existsSync(fixture.target)).toBe(false);
});

test("scaffold creation cannot overwrite a preserved metadata artifact", async () => {
  const fixture = systemFixture({ schema: { storage: { folder_pattern: ".typedmark/schemas", note_name_pattern: "note" } },
    scaffold: { path: ".typedmark/schemas/note.md" } });
  await expect(instantiateSystem(fixture.input)).rejects.toThrow("NTS-152");
  expect(existsSync(fixture.target)).toBe(false);
});

test.each([false, true])("a target inside the source is rejected, including a junction alias: %s", async (alias) => {
  const fixture = systemFixture();
  let parent = fixture.input.sourceRoot;
  if (alias) {
    parent = join(dirname(fixture.target), "alias");
    symlinkSync(fixture.input.sourceRoot, parent, "junction");
  }
  const targetRoot = join(parent, "nested");
  await expect(instantiateSystem({ ...fixture.input, targetRoot })).rejects.toThrow("source");
  expect(existsSync(targetRoot)).toBe(false);
});

function systemFixture(options: {
  config?: Record<string, unknown>;
  schema?: Record<string, unknown>;
  scaffold?: Record<string, unknown>;
  templates?: Record<string, string>;
  files?: Record<string, string>;
  body?: string;
} = {}) {
  const root = mkdtempSync(join(tmpdir(), "typedmark-template-starters-"));
  roots.push(root);
  const source = join(root, "system");
  const target = join(root, "instance");
  const metadataDirectory = String(options.config?.metadata_directory ?? ".typedmark");
  mkdirSync(join(source, metadataDirectory, "schemas"), { recursive: true });
  mkdirSync(join(source, metadataDirectory, "templates"), { recursive: true });
  writeFileSync(join(source, "typedmark.md"), markdown({
    specification_version: "0.1.0",
    extensions: { "typedmark:systems": "0.1.0" },
    name: "@example/template-starters",
    description: "A self-contained starter-template regression system.",
    version: "0.1.0",
    scaffold: {
      folders: ["Notes"],
      notes: [{ path: "Notes/Welcome.md", note_type: "note", values: { title: "Welcome" }, ...options.scaffold }],
    },
    ...options.config,
  }, options.body));
  writeFileSync(join(source, metadataDirectory, "schemas", "note.md"), markdown({
    specification_version: "0.1.0",
    note_type: "note",
    description: "A starter note.",
    storage: { folder_pattern: "Notes", note_name_pattern: "{title}" },
    ...options.schema,
  }));
  for (const [path, content] of Object.entries(options.templates ?? {})) {
    const destination = join(source, metadataDirectory, "templates", path);
    mkdirSync(dirname(destination), { recursive: true });
    writeFileSync(destination, content);
  }
  for (const [path, content] of Object.entries(options.files ?? {})) {
    const destination = join(source, path);
    mkdirSync(dirname(destination), { recursive: true }); writeFileSync(destination, content);
  }
  sources.push({ root: source, contents: snapshot(source) });
  return {
    target,
    input: { sourceRoot: source, targetRoot: target, collectionName: "working-notes", schemaDirectory },
  };
}

async function instantiateNote(fixture: ReturnType<typeof systemFixture>) {
  const result = await instantiateSystem(fixture.input);
  expect(result.report).toMatchObject({ evaluation: "complete", valid: true });
  return parseMarkdown(readFileSync(join(fixture.target, "Notes", "Welcome.md")));
}

function markdown(data: Record<string, unknown>, body = ""): string {
  return `---\n${stringify(data)}---\n${body}`;
}

function snapshot(root: string): Record<string, string> {
  const files: Record<string, string> = {};
  function visit(relativePath: string) {
    for (const entry of readdirSync(join(root, relativePath), { withFileTypes: true })) {
      const path = relativePath ? `${relativePath}/${entry.name}` : entry.name;
      if (entry.isDirectory()) visit(path);
      else files[path] = readFileSync(join(root, path)).toString("base64");
    }
  }
  visit("");
  return files;
}
