import { cp, mkdtemp, readFile, readdir, rm, stat } from "node:fs/promises";
import { createHash } from "node:crypto";
import { tmpdir } from "node:os";
import { join, relative } from "node:path";
import { SchemaRegistry } from "./schema-registry";
import { compareUnicodeCodePoints } from "./order";
import { STANDARD_EXTENSIONS, validateCollection } from "./validator";
import { FrontmatterError, parseMarkdown } from "./frontmatter";
import { readVectorContext, selectVectorCapabilities } from "./vector-context";
import { runQueryCases, type QueryCaseResult } from "./query-vectors";
import { QUERY_VERSION } from "./query";
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
  requestedExtensions: ExtensionMap;
  queryResults: QueryCaseResult[];
}

export function getCapabilities(): AdapterCapabilities {
  return {
    core: { "0.1": "0.1.0" },
    extensions: { ...STANDARD_EXTENSIONS },
    operations: { "typedmark:queries": QUERY_VERSION },
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
    const registry = new SchemaRegistry(input.schemaDirectory);
    const expectedErrors = registry.validate("validation-report.schema.json", expected);
    if (expectedErrors.length > 0) throw new Error("Expected report violates validation-report.schema.json");
    let config: Record<string, unknown> = {};
    try { config = parseMarkdown(await readFile(join(collectionRoot, "typedmark.md"))).data; }
    catch (error) { if (!(error instanceof FrontmatterError)) throw error; }
    const required = (config.extensions ?? {}) as ExtensionMap;
    const selection = selectVectorCapabilities(required, getCapabilities().extensions, readVectorContext(input.vectorDirectory, registry));
    if (selection.skip) throw new Error(`${selection.skip.status}: ${selection.skip.reason}: ${selection.skip.extensions.join(", ")}`);
    if (input.supportedExtensions) {
      for (const [extension, version] of Object.entries(selection.supportedExtensions)) {
        if (input.supportedExtensions[extension] === version) continue;
        if (required[extension] === version) throw new Error(`Declare the deliberate exclusion of ${extension} in vector.json`);
        delete selection.supportedExtensions[extension];
      }
    }
    const actual = validateCollection({
      collectionRoot,
      schemaDirectory: input.schemaDirectory,
      referenceEdition: expected.specification_version,
      mode: expected.mode,
      supportedExtensions: selection.supportedExtensions,
    });
    const queryResults = runQueryCases(input.vectorDirectory, collectionRoot, input.schemaDirectory, getCapabilities().operations, registry);
    const after = await snapshot(collectionRoot);
    const reportErrors = registry.validate("validation-report.schema.json", actual);
    const differences = reportErrors.length > 0
      ? [`Actual report violates validation-report.schema.json: ${reportErrors.map((error) => `${error.instancePath} ${error.message}`).join("; ")}`]
      : compareValidationReports(expected, actual);
    for (const query of queryResults) for (const difference of query.differences) differences.push(`${query.name}: ${difference}`);
    return { actual, expected, differences, collectionChanged: JSON.stringify(before) !== JSON.stringify(after), requestedExtensions: selection.supportedExtensions, queryResults };
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
  return files.sort((left, right) => compareUnicodeCodePoints(left.path, right.path));
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
  return Object.fromEntries(Object.entries(value).sort(([left], [right]) => compareUnicodeCodePoints(left, right)));
}
