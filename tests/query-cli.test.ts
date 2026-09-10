import { expect, test } from "bun:test";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";

test("the query CLI executes an explicit contract without changing the collection", () => {
  const temporary = mkdtempSync(join(tmpdir(), "typedmark-query-cli-"));
  try {
    const spec = resolve(import.meta.dir, "../../TypedMarkSpecification");
    const root = join(spec, "schema/fixtures/golden/query-pilot-valid/collection");
    const descriptor = join(temporary, "query.json");
    writeFileSync(descriptor, JSON.stringify({ specification_version: "0.1.0", note_types: ["task"], select: [{ kind: "path", as: "path" }], limit: 1 }));
    const before = readFileSync(join(root, "typedmark.md"));
    const command = [process.execPath, resolve(import.meta.dir, "../src/cli.ts"), "query", root,
      "--query", descriptor, "--schemas", join(spec, "schema/json-schema")];
    const result = Bun.spawnSync([...command, "--query-version", "0.1.0"], { stdout: "pipe", stderr: "pipe" });
    expect(result.exitCode, result.stderr.toString()).toBe(0);
    expect(JSON.parse(result.stdout.toString()).rows).toEqual([{ path: "Tasks/First.md" }]);
    expect(readFileSync(join(root, "typedmark.md"))).toEqual(before);
    const missing = Bun.spawnSync(command, { stdout: "pipe", stderr: "pipe" });
    expect(missing.exitCode).toBe(2);
    expect(missing.stdout.toString()).toBe("");
    expect(missing.stderr.toString()).toContain("--query-version");
  } finally { rmSync(temporary, { recursive: true, force: true }); }
});
