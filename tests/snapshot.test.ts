import { afterEach, expect, test } from "bun:test";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { readStableCollection } from "../src/snapshot";
const roots: string[] = [];
afterEach(() => { for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true }); });

test("rejects a collection changing while its model is read", () => {
  const root = mkdtempSync(join(tmpdir(), "typedmark-snapshot-")); roots.push(root);
  writeFileSync(join(root, "Note.md"), "before");
  expect(() => readStableCollection(root, () => {
    writeFileSync(join(root, "Note.md"), "after"); return "mixed model";
  })).toThrow("changed");
});

test("ignores changes in excluded files and nested collections", () => {
  const root = mkdtempSync(join(tmpdir(), "typedmark-snapshot-")); roots.push(root);
  writeFileSync(join(root, "typedmark.md"), "---\nexclude_paths: [cache/**]\n---\n");
  mkdirSync(join(root, "cache")); mkdirSync(join(root, "nested"));
  writeFileSync(join(root, "nested", "typedmark.md"), "malformed nested root");
  expect(readStableCollection(root, () => {
    writeFileSync(join(root, "cache", "changing"), "cache");
    writeFileSync(join(root, "nested", "changing"), "child"); return "same collection";
  })).toBe("same collection");
});

test("model reads use captured bytes even if source content changes and is restored", () => {
  const root = mkdtempSync(join(tmpdir(), "typedmark-snapshot-")); roots.push(root);
  writeFileSync(join(root, "Note.md"), "original");
  const model = readStableCollection(root, (snapshotRoot) => {
    writeFileSync(join(root, "Note.md"), "temporary change");
    const value = readFileSync(join(snapshotRoot, "Note.md"), "utf8");
    writeFileSync(join(root, "Note.md"), "original");
    return value;
  });
  expect(model).toBe("original");
});

test("default exclusions ignore Git content and its changes", () => {
  const root = mkdtempSync(join(tmpdir(), "typedmark-snapshot-")); roots.push(root);
  writeFileSync(join(root, "typedmark.md"), "---\nname: defaults\n---\n");
  mkdirSync(join(root, ".git")); writeFileSync(join(root, ".git", "private.md"), "before");
  expect(readStableCollection(root, (snapshot) => {
    expect(existsSync(join(snapshot, ".git", "private.md"))).toBe(false);
    writeFileSync(join(root, ".git", "private.md"), "after"); return "stable";
  })).toBe("stable");
});

test("explicit empty exclusions keep Git content while metadata stays protected", () => {
  const root = mkdtempSync(join(tmpdir(), "typedmark-snapshot-")); roots.push(root);
  writeFileSync(join(root, "typedmark.md"), "---\nexclude_paths: []\n---\n");
  mkdirSync(join(root, ".git")); writeFileSync(join(root, ".git", "private.md"), "data");
  expect(readStableCollection(root, (snapshot) => existsSync(join(snapshot, ".git", "private.md")))).toBe(true);
  writeFileSync(join(root, "typedmark.md"), "---\nmetadata_directory: .git\nexclude_paths: ['**']\n---\n");
  expect(readStableCollection(root, (snapshot) => existsSync(join(snapshot, ".git", "private.md")) && existsSync(join(snapshot, "typedmark.md")))).toBe(true);
});

test("a directory-only exclusion does not hide changes to unmatched child files", () => {
  const root = mkdtempSync(join(tmpdir(), "typedmark-snapshot-")); roots.push(root);
  writeFileSync(join(root, "typedmark.md"), "---\nexclude_paths: [cache]\n---\n");
  mkdirSync(join(root, "cache")); writeFileSync(join(root, "cache", "A.md"), "before");
  expect(() => readStableCollection(root, () => { writeFileSync(join(root, "cache", "A.md"), "after"); })).toThrow("changed");
});

test("metadata protection compares NFC paths even when all content is excluded", () => {
  const root = mkdtempSync(join(tmpdir(), "typedmark-snapshot-")); roots.push(root);
  writeFileSync(join(root, "typedmark.md"), "---\nmetadata_directory: é\nexclude_paths: ['**']\n---\n");
  mkdirSync(join(root, "e\u0301")); writeFileSync(join(root, "e\u0301", "schema.md"), "metadata");
  expect(readStableCollection(root, (snapshot) => existsSync(join(snapshot, "e\u0301", "schema.md")))).toBe(true);
});
