import { expect, test } from "bun:test";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
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
      "typedmark:template-tracking": "0.1.0",
      "typedmark:authoring": "0.1.0",
      "typedmark:automation": "0.1.0",
      "typedmark:expansion": "0.1.0",
      "typedmark:expressions": "0.1.0",
      "typedmark:reuse": "0.1.0",
      "typedmark:queries": "0.1.0",
      "typedmark:views": "0.1.0",
      "typedmark:systems": "0.1.0",
    },
    operations: { "typedmark:queries": "0.1.0" },
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

test.each([
  "core-valid", "core-invalid-field-value", "mandatory-tags-missing", "unsupported-required-extension",
  "unsupported-extension-version",
  "limited-required-extension", "supported-required-extension", "undeclared-reuse",
  "views-valid", "views-invalid",
  "explicit-type-property-set-valid", "reuse-composition-valid", "reuse-conditions-invalid",
  "optional-artifacts-valid", "derived-contracts-valid", "derived-contracts-invalid",
  "authoring-tracking-valid", "authoring-tracking-invalid",
  "core-association-valid", "core-association-invalid", "core-mapping-declarations-invalid",
  "core-fields-valid", "core-fields-invalid", "storage-valid", "storage-invalid",
  "storage-declarations-invalid", "storage-timezone-invalid",
])("runs %s without modifying its collection", async (name) => {
  const supportedExtensions = getCapabilities().extensions;
  const vectorDirectory = join(goldenDirectory, name);
  const result = await runConformanceVector({ vectorDirectory, schemaDirectory, supportedExtensions });
  expect(result.differences, name).toEqual([]);
  expect(result.collectionChanged, name).toBe(false);
  if (name === "limited-required-extension") expect(result.requestedExtensions).not.toHaveProperty("typedmark:systems");
});

test("a caller cannot manufacture an unsupported case by hiding an implemented capability", async () => {
  const vectorDirectory = mkdtempSync(join(tmpdir(), "typedmark-precondition-"));
  try {
    await cp(join(goldenDirectory, "limited-required-extension"), vectorDirectory, { recursive: true });
    writeFileSync(join(vectorDirectory, "vector.json"), '{"unsupported_extensions":["typedmark:systems"]}');
    await expect(runConformanceVector({ vectorDirectory, schemaDirectory, supportedExtensions: {} }))
      .rejects.toThrow("not_run_precondition");
  } finally {
    rmSync(vectorDirectory, { recursive: true, force: true });
  }
});

test.each(["missing-extension-dependency", "conflicting-extension-dependency"])("does not run expired negotiation preconditions for %s", async (name) => {
  await expect(runConformanceVector({ vectorDirectory: join(goldenDirectory, name), schemaDirectory })).rejects.toThrow("not_run_precondition");
});

test("caller scope can omit an irrelevant version during exact-version negotiation", async () => {
  const result = await runConformanceVector({
    vectorDirectory: join(goldenDirectory, "unsupported-extension-version"), schemaDirectory, supportedExtensions: {},
  });
  expect(result.differences).toEqual([]);
  expect(result.requestedExtensions).toEqual({});
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

test("executes the query pilot and records positive results and expected failures without writes", async () => {
  const result = await runConformanceVector({ vectorDirectory: join(goldenDirectory, "query-pilot-valid"), schemaDirectory });
  expect(result.differences).toEqual([]);
  expect(result.collectionChanged).toBe(false);
  expect(result.queryResults).toHaveLength(6);
  expect(result.queryResults.every((query) => query.status === "passed")).toBe(true);
}, 30_000);

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
