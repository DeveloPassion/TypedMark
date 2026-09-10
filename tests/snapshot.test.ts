import { afterEach, expect, test } from "bun:test";
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
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
