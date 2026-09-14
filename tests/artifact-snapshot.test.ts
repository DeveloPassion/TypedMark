import { afterEach, expect, test } from "bun:test";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { readStableCollection } from "../src/snapshot";

const roots: string[] = [];
const createRoot = () => {
  const root = mkdtempSync(join(tmpdir(), "typedmark-artifact-snapshot-"));
  roots.push(root);
  writeFileSync(join(root, "typedmark.md"), "---\nmetadata_directory: méta\nexclude_paths: ['**']\n---\n");
  mkdirSync(join(root, "me\u0301ta"));
  return root;
};
afterEach(() => { for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true }); });

test("artifact snapshots retain empty NFC-resolved metadata directories", () => {
  const root = createRoot();
  mkdirSync(join(root, "me\u0301ta/templates"));
  readStableCollection(root, (snapshot) => {
    expect(existsSync(join(snapshot, "typedmark.md"))).toBe(true);
    expect(existsSync(join(snapshot, "me\u0301ta/templates"))).toBe(true);
  }, { artifactsOnly: true });
});

test("artifact snapshots exclude current notes and assets without relying on excludes", () => {
  const root = createRoot();
  writeFileSync(join(root, "typedmark.md"), "---\nmetadata_directory: méta\nexclude_paths: []\n---\n");
  writeFileSync(join(root, "Note.md"), Buffer.from([0xff]));
  writeFileSync(join(root, "asset.bin"), "asset");
  readStableCollection(root, (snapshot) => {
    expect(existsSync(join(snapshot, "Note.md"))).toBe(false);
    expect(existsSync(join(snapshot, "asset.bin"))).toBe(false);
  }, { artifactsOnly: true });
});

test("changing ignored notes does not invalidate an artifact snapshot", () => {
  const root = createRoot();
  writeFileSync(join(root, "typedmark.md"), "---\nmetadata_directory: méta\nexclude_paths: []\n---\n");
  writeFileSync(join(root, "Note.md"), "before");
  expect(readStableCollection(root, () => {
    writeFileSync(join(root, "Note.md"), "after");
    return "same artifacts";
  }, { artifactsOnly: true })).toBe("same artifacts");
});

test("changing metadata files or empty directories invalidates an artifact snapshot", () => {
  const root = createRoot();
  writeFileSync(join(root, "me\u0301ta/schema.md"), "before");
  expect(() => readStableCollection(root, () => {
    writeFileSync(join(root, "me\u0301ta/schema.md"), "after");
  }, { artifactsOnly: true })).toThrow("changed");
  expect(() => readStableCollection(root, () => {
    mkdirSync(join(root, "me\u0301ta/empty"));
  }, { artifactsOnly: true })).toThrow("changed");
});

test.each([
  { artifactsOnly: false, nested: false },
  { artifactsOnly: true, nested: false },
  { artifactsOnly: false, nested: true },
  { artifactsOnly: true, nested: true },
])("explicit files remain reachable through excluded or nested ancestors: %j", ({ artifactsOnly, nested }) => {
  const root = createRoot();
  writeFileSync(join(root, "typedmark.md"), `---\nmetadata_directory: méta\nexclude_paths: ${nested ? "[]" : "[legal/**]"}\n---\n`);
  mkdirSync(join(root, "legal"));
  writeFileSync(join(root, "legal/LICENSE"), "Selected license");
  writeFileSync(join(root, "legal/private.md"), "Unselected content");
  if (nested) writeFileSync(join(root, "legal/typedmark.md"), "Nested root");
  readStableCollection(root, (snapshot) => {
    expect(readFileSync(join(snapshot, "legal/LICENSE"), "utf8")).toBe("Selected license");
    expect(existsSync(join(snapshot, "legal/private.md"))).toBe(false);
    expect(existsSync(join(snapshot, "legal/typedmark.md"))).toBe(false);
  }, { artifactsOnly, includePaths: ["legal/LICENSE"] });
});

test("linked selected-path ancestors are recorded and can be rejected", () => {
  const root = createRoot(), outside = createRoot();
  writeFileSync(join(outside, "LICENSE"), "Outside source");
  symlinkSync(outside, join(root, "legal"), "junction");
  const options = { artifactsOnly: true, includePaths: ["legal/LICENSE"] };
  expect(readStableCollection(root, (snapshot, info) => {
    expect(existsSync(join(snapshot, "legal"))).toBe(false);
    return [...info.blockedPaths];
  }, options)).toEqual(["legal"]);
  expect(() => readStableCollection(root, () => null, { ...options, rejectMetadataLinks: true })).toThrow("symbolic link");
});

test("explicit empty licensing directories are retained in artifact scope", () => {
  const root = createRoot();
  mkdirSync(join(root, "legal/NOTICES"), { recursive: true });
  expect(readStableCollection(root, (snapshot) => existsSync(join(snapshot, "legal/NOTICES")), {
    artifactsOnly: true, includePaths: ["legal/NOTICES"],
  })).toBe(true);
});
