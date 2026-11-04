import { afterEach, describe, expect, test } from "bun:test";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { tmpdir } from "node:os";
import { stringify } from "yaml";
import { storageAccepts } from "../src/automation-rules";
import { applyEdit, planEdit } from "../src/edits";
import { planRetype } from "../src/retype";
import { checkStoragePath, resolveStoragePath } from "../src/storage";
import { validateCollection } from "../src/validator";

const roots: string[] = [];
const schemaDirectory = resolve(import.meta.dir, "../../TypedMarkSpecification/schema/json-schema");
function write(root: string, path: string, data: unknown, body = "") {
  mkdirSync(dirname(join(root, path)), { recursive: true });
  writeFileSync(join(root, path), `---\n${stringify(data)}---\n${body}`);
}
function collection(schemas: Record<string, object>, notes: Record<string, object>) {
  const root = mkdtempSync(join(tmpdir(), "typedmark-note-folder-"));
  roots.push(root);
  write(root, "typedmark.md", { specification_version: "0.1.0", name: "note-folders", description: "Note folders." });
  for (const [name, schema] of Object.entries(schemas))
    write(root, `.typedmark/schemas/${name}.md`, { specification_version: "0.1.0", description: "Type.", ...schema });
  for (const [path, stored] of Object.entries(notes)) write(root, path, stored);
  return root;
}
afterEach(() => {
  for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true });
});

const optional = { folder_pattern: "Projects", note_name_suffix: { pattern: " (Project)" }, note_folder: "optional" as const };
const required = { folder_pattern: "Areas", note_folder: "required" as const };

test("an optional note folder may be present or absent, and takes the name part (NTS-198, NTS-199)", () => {
  expect(checkStoragePath(optional, "Projects/Launch/Launch (Project).md", {}, {}, "UTC")).toEqual({ path: "Projects/Launch/Launch (Project).md" });
  expect(checkStoragePath(optional, "Projects/Launch (Project).md", {}, {}, "UTC")).toEqual({ path: "Projects/Launch (Project).md" });
  expect(checkStoragePath(optional, "Projects/Launch (Project)/Launch (Project).md", {}, {}, "UTC")).toEqual({
    path: "Projects/<free name> (Project).md",
  });
  expect(checkStoragePath(optional, "Projects/Other/Launch (Project).md", {}, {}, "UTC")).toEqual({ path: "Projects/<free name> (Project).md" });
});

test("a required note folder is expected exactly when only the folder is off (NTS-198)", () => {
  expect(checkStoragePath(required, "Areas/Health/Health.md", {}, {}, "UTC")).toEqual({ path: "Areas/Health/Health.md" });
  expect(checkStoragePath(required, "Areas/Health.md", {}, {}, "UTC")).toEqual({ path: "Areas/Health/Health.md" });
  expect(checkStoragePath(required, "Elsewhere/Health.md", {}, {}, "UTC")).toEqual({ path: "Areas/<free name>/<free name>.md" });
  const named = { folder_pattern: "", note_name_pattern: "Home", note_folder: "required" as const };
  expect(checkStoragePath(named, "Home.md", {}, {}, "UTC")).toEqual({ path: "Home/Home.md" });
});

test("a note folder name must not begin with a dot (NTS-134)", () => {
  const prefixed = { folder_pattern: "", note_name_prefix: { pattern: "x" }, note_folder: "required" as const };
  expect(resolveStoragePath(prefixed, {}, {}, "UTC", ".hidden")).toEqual({ failure: expect.objectContaining({ rule: "NTS-134" }) });
});

test("writers omit an optional note folder unless asked (NTS-190)", () => {
  expect(resolveStoragePath(optional, {}, {}, "UTC", "Launch")).toEqual({ path: "Projects/Launch (Project).md" });
  expect(resolveStoragePath(optional, {}, {}, "UTC", "Launch", undefined, { prefix: false, suffix: false, folder: true })).toEqual({
    path: "Projects/Launch/Launch (Project).md",
  });
  expect(resolveStoragePath(required, {}, {}, "UTC", "Health")).toEqual({ path: "Areas/Health/Health.md" });
});

test("validation reports a misplaced note folder under path with a move fix (NTS-146)", () => {
  const root = collection({ area: { storage: required } }, { "Areas/Health/Health.md": { note_type: "area" }, "Areas/Money.md": { note_type: "area" } });
  const paths = validateCollection({ collectionRoot: root, schemaDirectory }).results.filter((result) => result.code === "path");
  expect(paths.map((result) => [result.path, result.rule_id, (result as { fix?: { path?: string } }).fix?.path])).toEqual([
    ["Areas/Money.md", "NTS-146", "Areas/Money/Money.md"],
  ]);
});

test("renaming and archiving keep an optional note folder (NTS-191, ER-12)", () => {
  const storage = { ...optional, archive: { folder_pattern: "Archive", note_name_suffix: { pattern: " (Project)" }, note_folder: "optional" as const } };
  const root = collection(
    { project: { storage, frontmatter: { done: { type: "checkbox" } } } },
    { "Projects/Launch/Launch (Project).md": { note_type: "project" }, "Projects/Rollout (Project).md": { note_type: "project" } },
  );
  expect(planEdit(root, schemaDirectory, { path: "Projects/Launch/Launch (Project).md", set: { archived: true } }).moves).toEqual([
    { from: "Projects/Launch/Launch (Project).md", to: "Archive/Launch/Launch (Project).md" },
  ]);
  expect(planEdit(root, schemaDirectory, { path: "Projects/Rollout (Project).md", set: { archived: true } }).moves).toEqual([
    { from: "Projects/Rollout (Project).md", to: "Archive/Rollout (Project).md" },
  ]);
});

test("re-typing keeps a note folder the target makes optional (NTS-191)", () => {
  const root = collection({ area: { storage: required }, project: { storage: optional } }, { "Areas/Health/Health.md": { note_type: "area" } });
  expect(planRetype(root, schemaDirectory, "Areas/Health/Health.md", "project").targetPath).toBe("Projects/Health/Health (Project).md");
});

test("automation targeting accepts either placement of an optional note folder", () => {
  expect(storageAccepts("Projects/Launch/Launch (Project).md", optional)).toBe(true);
  expect(storageAccepts("Projects/Launch (Project).md", optional)).toBe(true);
  expect(storageAccepts("Areas/Health.md", required)).toBe(false);
  expect(storageAccepts("Areas/Health/Health.md", required)).toBe(true);
});

describe("note-folder moves (ER-16 to ER-18)", () => {
  const archived = { ...optional, archive: { folder_pattern: "Archive", note_name_suffix: { pattern: " (Project)" } } };
  function folderCollection(storage: object = optional) {
    const root = collection({ project: { storage } }, { "Projects/Launch/Launch (Project).md": { note_type: "project" } });
    writeFileSync(join(root, "Projects/Launch/Kickoff.md"), "See [the board](Board.canvas) and [[Home]].\n");
    writeFileSync(join(root, "Projects/Launch/Board.canvas"), '{"nodes":[]}');
    mkdirSync(join(root, "Projects/Launch/img"));
    writeFileSync(join(root, "Projects/Launch/img/logo.png"), Buffer.from([0, 255, 1, 254]));
    writeFileSync(join(root, "Home.md"), "[[Launch (Project)]], [kickoff](Projects/Launch/Kickoff.md), ![logo](Projects/Launch/img/logo.png)\n");
    return root;
  }

  test("a rename between note folders carries the folder and keeps every link resolving", () => {
    const root = folderCollection();
    const plan = planEdit(root, schemaDirectory, { path: "Projects/Launch/Launch (Project).md", renameTo: "Projects/Go-live/Go-live (Project).md" });
    expect(plan.unresolved).toEqual([]);
    expect(plan.moves).toEqual([
      { from: "Projects/Launch/Launch (Project).md", to: "Projects/Go-live/Go-live (Project).md" },
      { from: "Projects/Launch/Kickoff.md", to: "Projects/Go-live/Kickoff.md" },
    ]);
    expect(plan.carried).toEqual([
      { from: "Projects/Launch/Board.canvas", to: "Projects/Go-live/Board.canvas" },
      { from: "Projects/Launch/img/logo.png", to: "Projects/Go-live/img/logo.png" },
    ]);
    expect(plan.leftBehind).toEqual([]);
    applyEdit(root, plan);
    expect(readFileSync(join(root, "Home.md"), "utf8")).toBe(
      "[[Go-live (Project)]], [kickoff](Projects/Go-live/Kickoff.md), ![logo](Projects/Go-live/img/logo.png)\n",
    );
    expect(readFileSync(join(root, "Projects/Go-live/Kickoff.md"), "utf8")).toBe("See [the board](Board.canvas) and [[Home]].\n");
    expect([...readFileSync(join(root, "Projects/Go-live/img/logo.png"))]).toEqual([0, 255, 1, 254]);
    expect(existsSync(join(root, "Projects/Launch"))).toBe(false);
  });

  test("a caller can move only the note, and the rest is listed (ER-16, ER-18)", () => {
    const root = folderCollection();
    const plan = planEdit(root, schemaDirectory, {
      path: "Projects/Launch/Launch (Project).md",
      renameTo: "Projects/Go-live/Go-live (Project).md",
      onlyNote: true,
    });
    expect(plan.moves).toEqual([{ from: "Projects/Launch/Launch (Project).md", to: "Projects/Go-live/Go-live (Project).md" }]);
    expect(plan.carried).toEqual([]);
    expect(plan.leftBehind).toEqual(["Projects/Launch/Board.canvas", "Projects/Launch/Kickoff.md", "Projects/Launch/img/logo.png"]);
  });

  test("leaving the note folder for a flat path lists the files left behind (ER-18)", () => {
    const root = folderCollection(archived);
    const plan = planEdit(root, schemaDirectory, { path: "Projects/Launch/Launch (Project).md", set: { archived: true } });
    expect(plan.moves).toEqual([{ from: "Projects/Launch/Launch (Project).md", to: "Archive/Launch (Project).md" }]);
    expect(plan.leftBehind).toEqual(["Projects/Launch/Board.canvas", "Projects/Launch/Kickoff.md", "Projects/Launch/img/logo.png"]);
  });

  test("a taken target inside the new folder refuses the whole move (ER-14, ER-17)", () => {
    const root = folderCollection();
    mkdirSync(join(root, "Projects/Go-live"));
    writeFileSync(join(root, "Projects/Go-live/Board.canvas"), "{}");
    const plan = planEdit(root, schemaDirectory, { path: "Projects/Launch/Launch (Project).md", renameTo: "Projects/Go-live/Go-live (Project).md" });
    expect(plan.unresolved.map((issue) => issue.rule)).toContain("ER-14");
    expect(plan.files).toEqual([]);
    expect(plan.carried).toEqual([]);
  });
});
