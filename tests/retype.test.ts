import { afterEach, expect, test } from "bun:test";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { tmpdir } from "node:os";
import { parse } from "yaml";
import { applyRetype, planRetype } from "../src/retype";
import { parseMarkdown } from "../src/frontmatter";
import { locateBodyBlocks } from "../src/markdown-headings";
import { validateCollection } from "../src/validator";

const roots: string[] = [];
const schemaDirectory = resolve(import.meta.dir, "../../TypedMarkSpecification/schema/json-schema");
afterEach(() => {
  for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true });
});

const schemas: Record<string, string> = {
  task: `storage: {folder_pattern: Work, note_name_pattern: "{title}"}
frontmatter:
  priority: {type: integer, nullable: true, default_value: null}
  status: {type: text, allowed_values: [open, done], nullable: false, default_value: open}
  estimate: {type: text, nullable: true, default_value: null}
headings: {required_h2: [Checklist], optional_h2: [Notes], allow_other_h2: false}`,
  note: `storage: {folder_pattern: Work, note_name_pattern: "{title}"}
mandatory_tags: [kind/note]
frontmatter:
  estimate: {type: integer, nullable: true, default_value: null}
headings: {required_h2: [Summary], optional_h2: [Notes], allow_other_h2: false}`,
  project: `storage: {folder_pattern: Projects, note_name_pattern: "{title}"}
frontmatter:
  owner: {type: text, nullable: false}`,
};

function collection(notes: Record<string, string>) {
  const root = mkdtempSync(join(tmpdir(), "typedmark-retype-"));
  roots.push(root);
  const files: Record<string, string> = {
    "typedmark.md": "---\nspecification_version: 0.1.0\nname: retype\ndescription: Re-typing.\n---\n",
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

const task = `---
note_type: task
id: task-1
title: Launch
priority: 2
status: done
estimate: "3"
tags: [work]
---

Intro line.

## Checklist

- [x] draft \`code\` and [[Other]]

## Notes

Keep this.
`;
const other = "---\nnote_type: note\ntitle: Other\ntags: [kind/note]\n---\n\n## Summary\n";
const read = (root: string, path: string) => parseMarkdown(readFileSync(join(root, path), "utf8"));
const block = (body: string) => locateBodyBlocks(body).find((candidate) => candidate.kind === "code" && candidate.info === "typedmark-preserved");

test("re-typing carries compatible values and preserves the rest (RT-2..RT-8, RT-13..RT-16)", () => {
  const root = collection({ "Work/Launch.md": task, "Work/Other.md": other });
  const plan = planRetype(root, schemaDirectory, "Work/Launch.md", "note");
  expect(plan.unresolved).toEqual([]);
  expect(plan).toMatchObject({
    from: "task",
    to: "note",
    targetPath: "Work/Launch.md",
    carried: expect.arrayContaining(["id", "title", "tags"]),
    preservedFields: ["priority", "status", "estimate"],
    preservedSections: ["Checklist"],
    addedTags: ["kind/note"],
    addedHeadings: ["Summary"],
  });
  applyRetype(root, plan);
  const { data, body } = read(root, "Work/Launch.md");
  expect(data).toEqual({ note_type: "note", id: "task-1", title: "Launch", tags: ["work", "kind/note"] });
  expect(body).toContain("Intro line.");
  expect(body).toContain("## Notes\n\nKeep this.");
  expect(body).toContain("## Summary");
  const preserved = block(body)!;
  expect(parse(preserved.literal!)).toEqual([
    {
      from: "task",
      fields: { priority: 2, status: "done", estimate: "3" },
      sections: [{ heading: "Checklist", markdown: "- [x] draft `code` and [[Other]]" }],
    },
  ]);
  expect(validateCollection({ collectionRoot: root, schemaDirectory }).results).toEqual([]);
});

test("re-typing back restores the preserved entry, so the round trip is semantically lossless (RT-19)", () => {
  const root = collection({ "Work/Launch.md": task, "Work/Other.md": other });
  applyRetype(root, planRetype(root, schemaDirectory, "Work/Launch.md", "note"));
  const back = planRetype(root, schemaDirectory, "Work/Launch.md", "task");
  expect(back.unresolved).toEqual([]);
  expect(back).toMatchObject({ restoredFields: ["priority", "status", "estimate"], restoredSections: ["Checklist"] });
  applyRetype(root, back);
  const original = parseMarkdown(task);
  const { data, body } = read(root, "Work/Launch.md");
  expect(data).toEqual({ ...original.data, tags: ["work", "kind/note"] });
  expect(body).toContain("## Checklist\n\n- [x] draft `code` and [[Other]]");
  expect(body).toContain("## Notes\n\nKeep this.");
  // The note-only Summary heading is forbidden for tasks, so it is preserved, not dropped.
  expect(parse(block(body)!.literal!)).toEqual([{ from: "note", sections: [{ heading: "Summary", markdown: "" }] }]);
  expect(validateCollection({ collectionRoot: root, schemaDirectory }).results).toEqual([]);
});

test("a later re-typing appends to the existing block rather than adding a second one (RT-18)", () => {
  const root = collection({ "Work/Launch.md": task, "Work/Other.md": other });
  applyRetype(root, planRetype(root, schemaDirectory, "Work/Launch.md", "note"));
  writeFileSync(
    join(root, ".typedmark/schemas/memo.md"),
    '---\nspecification_version: 0.1.0\ndescription: memo.\nstorage: {folder_pattern: Work, note_name_pattern: "{title}"}\n---\n',
  );
  const plan = planRetype(root, schemaDirectory, "Work/Launch.md", "memo");
  applyRetype(root, plan);
  const { body } = read(root, "Work/Launch.md");
  expect(locateBodyBlocks(body).filter((candidate) => candidate.info === "typedmark-preserved")).toHaveLength(1);
  expect((parse(block(body)!.literal!) as Array<{ from: string }>).map((entry) => entry.from)).toEqual(["task"]);
});

test("unsatisfied requirements are reported and nothing is written (RT-10, RT-11)", () => {
  const root = collection({ "Work/Launch.md": task, "Work/Other.md": other });
  writeFileSync(
    join(root, ".typedmark/schemas/contact.md"),
    '---\nspecification_version: 0.1.0\ndescription: contact.\nstorage: {folder_pattern: Work, note_name_pattern: "{title}"}\nfrontmatter:\n  owner: {type: text, nullable: false}\n---\n',
  );
  const plan = planRetype(root, schemaDirectory, "Work/Launch.md", "contact");
  expect(plan.content).toBeUndefined();
  expect(plan.unresolved).toContainEqual(expect.objectContaining({ message: expect.stringContaining("owner") }));
  expect(() => applyRetype(root, plan)).toThrow();
  expect(read(root, "Work/Launch.md").data.note_type).toBe("task");
  expect(planRetype(root, schemaDirectory, "Work/Launch.md", "contact", { values: { owner: "Ana" } }).unresolved).toEqual([]);
});

test("a folder move keeps the basename and is refused when another note links by path (RT-9)", () => {
  const root = collection({ "Work/Launch.md": task, "Work/Other.md": other });
  const plan = planRetype(root, schemaDirectory, "Work/Launch.md", "project", { values: { owner: "Ana" } });
  expect(plan).toMatchObject({ targetPath: "Projects/Launch.md", unresolved: [] });
  applyRetype(root, plan);
  expect(existsSync(join(root, "Work/Launch.md"))).toBe(false);
  expect(read(root, "Projects/Launch.md").data).toMatchObject({ note_type: "project", owner: "Ana" });

  const linked = collection({ "Work/Launch.md": task, "Work/Other.md": other.replace("## Summary\n", "## Summary\n\nSee [[Work/Launch]].\n") });
  const refused = planRetype(linked, schemaDirectory, "Work/Launch.md", "project", { values: { owner: "Ana" } });
  expect(refused.unresolved).toContainEqual(expect.objectContaining({ rule: "RT-9" }));
  expect(refused.content).toBeUndefined();
});

test("explicit field maps rename carried fields (RT-2)", () => {
  const root = collection({ "Work/Launch.md": task, "Work/Other.md": other });
  writeFileSync(
    join(root, ".typedmark/schemas/memo.md"),
    '---\nspecification_version: 0.1.0\ndescription: memo.\nstorage: {folder_pattern: Work, note_name_pattern: "{title}"}\nfrontmatter:\n  rank: {type: number, nullable: true, default_value: null}\n---\n',
  );
  const plan = planRetype(root, schemaDirectory, "Work/Launch.md", "memo", { map: { priority: "rank" } });
  expect(plan.carried).toContain("priority -> rank");
  applyRetype(root, plan);
  expect(read(root, "Work/Launch.md").data.rank).toBe(2);
});

test("the preservation fence outgrows backtick runs in preserved content (RT-17)", () => {
  const fenced = task.replace("- [x] draft `code` and [[Other]]", "````js\nconst x = 1;\n````");
  const root = collection({ "Work/Launch.md": fenced, "Work/Other.md": other });
  applyRetype(root, planRetype(root, schemaDirectory, "Work/Launch.md", "note"));
  const { body } = read(root, "Work/Launch.md");
  expect(body).toContain("`````typedmark-preserved");
  expect(parse(block(body)!.literal!)[0].sections[0].markdown).toBe("````js\nconst x = 1;\n````");
});

test("refuses unknown notes, abstract or missing targets, and no-op re-typing (RT-1)", () => {
  const root = collection({ "Work/Launch.md": task, "Work/Other.md": other });
  expect(planRetype(root, schemaDirectory, "Work/Missing.md", "note").unresolved).toMatchObject([{ rule: "RT-1" }]);
  expect(planRetype(root, schemaDirectory, "Work/Launch.md", "nothing").unresolved).toMatchObject([{ rule: "RT-1" }]);
  expect(planRetype(root, schemaDirectory, "Work/Launch.md", "task").unresolved).toMatchObject([{ rule: "RT-1" }]);
});
