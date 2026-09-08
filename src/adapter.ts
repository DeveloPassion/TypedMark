import { cp, mkdtemp, readFile, readdir, rm, stat } from "node:fs/promises";
import { createHash } from "node:crypto";
import { tmpdir } from "node:os";
import { join, relative } from "node:path";
import { SchemaRegistry } from "./schema-registry";
import { STANDARD_EXTENSIONS, validateCollection } from "./validator";
import type { AdapterCapabilities, ExtensionMap, ValidationReport } from "./types";

export interface RunVectorInput {
  vectorDirectory: string;
  schemaDirectory: string;
  supportedExtensions?: ExtensionMap;
}

export interface VectorRunResult {
  actual: ValidationReport;
  expected: ValidationReport;
  differences: string[];
  collectionChanged: boolean;
}

export function getCapabilities(): AdapterCapabilities {
  return {
    core: { "0.1": "0.1.0" },
    extensions: { ...STANDARD_EXTENSIONS },
  };
}

export function compareValidationReports(expected: ValidationReport, actual: ValidationReport): string[] {
  const expectedStable = stableReport(expected);
  const actualStable = stableReport(actual);
  return JSON.stringify(expectedStable) === JSON.stringify(actualStable)
    ? []
    : [`Expected ${JSON.stringify(expectedStable)}, received ${JSON.stringify(actualStable)}`];
}

export async function runConformanceVector(input: RunVectorInput): Promise<VectorRunResult> {
  const temporaryRoot = await mkdtemp(join(tmpdir(), "typedmark-vector-"));
  const collectionRoot = join(temporaryRoot, "collection");
  try {
    await cp(join(input.vectorDirectory, "collection"), collectionRoot, { recursive: true });
    const before = await snapshot(collectionRoot);
    const expected = JSON.parse(await readFile(join(input.vectorDirectory, "expected-validation-report.json"), "utf8")) as ValidationReport;
    const actual = validateCollection({
      collectionRoot,
      schemaDirectory: input.schemaDirectory,
      referenceEdition: expected.specification_version,
      mode: expected.mode,
      supportedExtensions: input.supportedExtensions ?? getCapabilities().extensions,
    });
    const after = await snapshot(collectionRoot);
    const reportErrors = new SchemaRegistry(input.schemaDirectory).validate("validation-report.schema.json", actual);
    const differences = reportErrors.length > 0
      ? [`Actual report violates validation-report.schema.json: ${reportErrors.map((error) => `${error.instancePath} ${error.message}`).join("; ")}`]
      : compareValidationReports(expected, actual);
    return { actual, expected, differences, collectionChanged: JSON.stringify(before) !== JSON.stringify(after) };
  } finally {
    await rm(temporaryRoot, { recursive: true, force: true });
  }
}

async function snapshot(root: string): Promise<Array<{ path: string; size: number; sha256: string }>> {
  const files: Array<{ path: string; size: number; sha256: string }> = [];
  async function visit(directory: string): Promise<void> {
    for (const entry of await readdir(directory, { withFileTypes: true })) {
      const path = join(directory, entry.name);
      if (entry.isDirectory()) await visit(path);
      else if (entry.isFile()) {
        const content = await readFile(path);
        files.push({
          path: relative(root, path).replaceAll("\\", "/"),
          size: (await stat(path)).size,
          sha256: createHash("sha256").update(content).digest("hex"),
        });
      }
    }
  }
  await visit(root);
  return files.sort((left, right) => left.path < right.path ? -1 : left.path > right.path ? 1 : 0);
}

function stableReport(report: ValidationReport): unknown {
  return {
    specification_version: report.specification_version,
    mode: report.mode,
    evaluation: report.evaluation,
    required_extensions: orderedObject(report.required_extensions),
    evaluated_extensions: orderedObject(report.evaluated_extensions),
    valid: report.valid,
    results: report.results.map(({ message: _message, ...result }) => orderedObject(result)),
  };
}

function orderedObject(value: Record<string, unknown>): Record<string, unknown> {
  return Object.fromEntries(Object.entries(value).sort(([left], [right]) => left < right ? -1 : left > right ? 1 : 0));
}
