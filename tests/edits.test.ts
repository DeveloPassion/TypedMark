import { afterEach, expect, test } from "bun:test";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { applyEdit, editFrontmatter, planEdit } from "../src/edits";
import { validateCollection } from "../src/validator";

const schemaDirectory = resolve(import.meta.dir, "../../TypedMarkSpecification/schema/json-schema");
const roots: string[] = [];
afterEach(() => {
  for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true });
});

test("an edit changes only the keys it assigns, adding keys in declared order (ER-1 to ER-3, ER-5)", () => {
  const note = [
    "---",
    "note_type: task",
    "# Agreed with the client",
    "due: '2026-11-02'",
    "status: active # moved by hand",
    "tags: [a, b]",
    "",
    "notes: |",
    "  line one",
    "",
    "  line two",
    "---",
    "Body [[Link]] stays.",
    "",
  ].join("\n");
  const order = ["note_type", "due", "status", "date_completed", "tags", "notes", "priority"];
  expect(editFrontmatter(note, { status: "done", date_completed: "2026-10-28" }, order)).toBe(
    note.replace("status: active # moved by hand\n", "status: done # moved by hand\ndate_completed: 2026-10-28\n"),
  );
  // A key declared after every present key ends the frontmatter.
  expect(editFrontmatter(note, { priority: "high" }, order)).toBe(note.replace("  line two\n---", "  line two\npriority: high\n---"));
});

test("removing a key takes its comment lines and nothing else; CRLF and BOM survive (ER-4, ER-5)", () => {
  const note = "﻿---\r\nnote_type: task\r\n# Agreed with the client\r\ndue: '2026-11-02'\r\n\r\nstatus: active\r\n---\r\nBody\r\n";
  expect(editFrontmatter(note, { due: undefined })).toBe("﻿---\r\nnote_type: task\r\n\r\nstatus: active\r\n---\r\nBody\r\n");
  expect(editFrontmatter(note, { status: "done" })).toBe(note.replace("status: active", "status: done"));
  expect(() => editFrontmatter("No frontmatter", { status: "done" })).toThrow("ER-5");
});

function write(root: string, path: string, content: string) {
  mkdirSync(dirname(join(root, path)), { recursive: true });
  writeFileSync(join(root, path), content);
}
function collection() {
  const root = mkdtempSync(join(tmpdir(), "typedmark-edits-"));
  roots.push(root);
  write(root, "typedmark.md", "---\nspecification_version: 0.1.0\nname: edits\ndescription: Renames and re-filing.\n---\n");
  write(
    root,
    ".typedmark/schemas/project.md",
    '---\nspecification_version: 0.1.0\ndescription: Project.\nstorage: {folder_pattern: Projects, note_name_pattern: "{title}"}\n---\n',
  );
  write(
    root,
    ".typedmark/schemas/decision.md",
    '---\nspecification_version: 0.1.0\ndescription: Decision log beside its project.\nstorage:\n  folder_pattern: "{project:folder}/{project:name}"\n  note_name_pattern: Decisions\nrelationships:\n  belongs_to: {allowed_note_types: {project: {}}}\n  related_to: {allowed_note_types: {}}\nfrontmatter:\n  project: {type: link, format: note_link, targets: [project], relationship_kind: belongs_to, nullable: false}\n---\n',
  );
  write(
    root,
    ".typedmark/schemas/task.md",
    "---\nspecification_version: 0.1.0\ndescription: Task.\nstorage: {folder_pattern: Tasks}\nfrontmatter:\n  project: {type: link, format: note_link, nullable: true}\n---\n",
  );
  write(root, "Projects/Launch.md", "---\nnote_type: project\ntitle: Launch\n---\n## Scope\n\nSee [decisions](Launch/Decisions.md).\n");
  write(root, "Projects/Launch/Decisions.md", '---\nnote_type: decision\ntitle: Decisions\nproject: "[[Launch]]"\n---\n');
  write(
    root,
    "Tasks/Write.md",
    '---\nnote_type: task\n# The project it serves\nproject: "[[Launch]]"\n---\nPart of [[Launch#Scope|the scope]], ![[Launch]], [plan](../Projects/Launch.md), [[Missing]] and [[Tasks/Other]].\n',
  );
  write(root, "Tasks/Other.md", "---\nnote_type: task\n---\nSee [[Go-live]].\n");
  write(root, "Notes/Go-live.md", "# A free note named Go-live\n");
  return root;
}

test("an edit re-files its note and the notes stored through it, rewriting every link (ER-7 to ER-13)", () => {
  const root = collection();
  const plan = planEdit(root, schemaDirectory, { path: "Projects/Launch.md", set: { title: "Go-live" } });
  expect(plan.unresolved).toEqual([]);
  expect(plan.moves).toEqual([
    { from: "Projects/Launch.md", to: "Projects/Go-live.md" },
    { from: "Projects/Launch/Decisions.md", to: "Projects/Go-live/Decisions.md" },
  ]);
  const files = Object.fromEntries(plan.files.map((file) => [file.path, file.content]));
  expect(files["Projects/Go-live.md"]).toBe("---\nnote_type: project\ntitle: Go-live\n---\n## Scope\n\nSee [decisions](Go-live/Decisions.md).\n");
  // [[Go-live]] would be ambiguous with Notes/Go-live.md, so names become paths (ER-9).
  expect(files["Projects/Go-live/Decisions.md"]).toBe('---\nnote_type: decision\ntitle: Decisions\nproject: "[[Projects/Go-live]]"\n---\n');
  expect(files["Tasks/Write.md"]).toBe(
    '---\nnote_type: task\n# The project it serves\nproject: "[[Projects/Go-live]]"\n---\nPart of [[Projects/Go-live#Scope|the scope]], ![[Projects/Go-live]], [plan](../Projects/Go-live.md), [[Missing]] and [[Tasks/Other]].\n',
  );
  // A link that reached the free note would become ambiguous, so it is kept on its target (ER-10).
  expect(files["Tasks/Other.md"]).toBe("---\nnote_type: task\n---\nSee [[Notes/Go-live]].\n");
  applyEdit(root, plan);
  expect(existsSync(join(root, "Projects/Launch.md"))).toBe(false);
  expect(existsSync(join(root, "Projects/Launch"))).toBe(false);
  expect(readFileSync(join(root, "Projects/Go-live/Decisions.md"), "utf8")).toContain("[[Projects/Go-live]]");
  expect(validateCollection({ collectionRoot: root, schemaDirectory }).results.filter((result) => result.severity === "error")).toEqual([]);
});

test("a name stays a name when it still resolves, and taken targets write nothing (ER-9, ER-14)", () => {
  const root = collection();
  rmSync(join(root, "Notes/Go-live.md"));
  writeFileSync(join(root, "Tasks/Other.md"), "---\nnote_type: task\n---\n");
  const plan = planEdit(root, schemaDirectory, { path: "Projects/Launch.md", set: { title: "Go-live" } });
  expect(plan.unresolved).toEqual([]);
  expect(plan.files.find((file) => file.path === "Tasks/Write.md")?.content).toContain(
    "[[Go-live#Scope|the scope]], ![[Go-live]], [plan](../Projects/Go-live.md)",
  );
  const taken = planEdit(root, schemaDirectory, { path: "Tasks/Write.md", renameTo: "Tasks/Other.md" });
  expect(taken.unresolved).toMatchObject([{ rule: "ER-14" }]);
  expect(taken.files).toEqual([]);
  expect(() => applyEdit(root, taken)).toThrow("ER-14");
});
