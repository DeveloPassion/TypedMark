import { expect, test } from "bun:test";
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { cp, readdir, readFile, stat } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, relative, resolve } from "node:path";
import {
  compareValidationReports,
  getCapabilities,
  runConformanceVector,
} from "../src/adapter";
import type { ValidationReport } from "../src/types";

const specificationRoot = resolve(import.meta.dir, "../../TypedMarkSpecification");
const schemaDirectory = join(specificationRoot, "schema", "json-schema");
const goldenDirectory = join(specificationRoot, "schema", "fixtures", "golden");

test("advertises the exact contracts the adapter evaluates", () => {
  expect(getCapabilities()).toEqual({
    core: { "0.1": "0.1.0" },
    extensions: {
      "typedmark:automation": "0.1.0",
      "typedmark:queries": "0.1.0",
      "typedmark:reuse": "0.1.0",
      "typedmark:systems": "0.1.0",
      "typedmark:views": "0.1.0",
    },
  });
});

test("report comparison ignores messages but not machine fields or duplicates", () => {
  const expected: ValidationReport = {
    specification_version: "0.1.0",
    mode: "instantiated_collection",
    evaluation: "complete",
    required_extensions: {},
    evaluated_extensions: {},
    valid: false,
    results: [{
      code: "invalid_field_value",
      severity: "error",
      path: "Note.md",
      rule_id: "FDR-13",
      message: "expected wording",
      field: "when",
    }],
  };
  const localized = structuredClone(expected);
  localized.results[0]!.message = "localized wording";
  expect(compareValidationReports(expected, localized)).toEqual([]);

  const duplicate = structuredClone(localized);
  duplicate.results.push(structuredClone(duplicate.results[0]!));
  expect(compareValidationReports(expected, duplicate)).not.toEqual([]);
});

test("runs every checked-in golden vector without modifying its collection", async () => {
  const supportedExtensions = getCapabilities().extensions;
  const names = (await readdir(goldenDirectory, { withFileTypes: true }))
    .filter((entry) => entry.isDirectory())
    .map((entry) => entry.name)
    .sort();
  for (const name of names) {
    const vectorDirectory = join(goldenDirectory, name);
    const result = await runConformanceVector({
      vectorDirectory,
      schemaDirectory,
      supportedExtensions,
    });
    expect(result.differences, name).toEqual([]);
    expect(result.collectionChanged, name).toBe(false);
  }
});

test("runs vectors from isolated temporary copies", async () => {
  const source = join(goldenDirectory, "core-valid");
  const temporary = mkdtempSync(join(tmpdir(), "typedmark-vector-test-"));
  try {
    await cp(source, temporary, { recursive: true });
    const result = await runConformanceVector({
      vectorDirectory: temporary,
      schemaDirectory,
      supportedExtensions: {},
    });
    expect(result.differences).toEqual([]);

    const sourceFiles = await listFiles(source);
    const copiedFiles = await listFiles(temporary);
    expect(copiedFiles).toEqual(sourceFiles);
    for (const path of sourceFiles) {
      expect(readFileSync(join(temporary, path))).toEqual(readFileSync(join(source, path)));
    }
  } finally {
    rmSync(temporary, { recursive: true, force: true });
  }
});

async function listFiles(root: string): Promise<string[]> {
  const result: string[] = [];
  async function visit(directory: string): Promise<void> {
    for (const entry of await readdir(directory, { withFileTypes: true })) {
      const path = join(directory, entry.name);
      if (entry.isDirectory()) await visit(path);
      else if ((await stat(path)).isFile()) result.push(relative(root, path).replaceAll("\\", "/"));
    }
  }
  await visit(root);
  return result.sort();
}
