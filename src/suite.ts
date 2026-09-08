import { readFile, readdir } from "node:fs/promises";
import { join } from "node:path";
import { getCapabilities, runConformanceVector } from "./adapter";
import type { AdapterCapabilities, ValidationReport } from "./types";

export interface RunSuiteInput {
  goldenDirectory: string;
  schemaDirectory: string;
  specificationRevision: string;
  adapterRevision: string;
  startedAt: string;
  finishedAt?: string;
}

export interface ConformanceEvidence {
  specification_revision: string;
  adapter_revision: string;
  started_at: string;
  finished_at: string;
  capabilities: AdapterCapabilities;
  summary: { discovered: number; executed: number; passed: number; failed: number; skipped: number; changed: number };
  vectors: Array<{
    name: string;
    status: "passed" | "failed" | "not_run_unsupported";
    collection_changed: boolean;
    differences: string[];
    unsupported_extensions?: string[];
    actual_report?: ValidationReport;
  }>;
}

export async function runConformanceSuite(input: RunSuiteInput): Promise<ConformanceEvidence> {
  const capabilities = getCapabilities();
  const names = (await readdir(input.goldenDirectory, { withFileTypes: true }))
    .filter((entry) => entry.isDirectory())
    .map((entry) => entry.name)
    .sort();
  const vectors = [];
  for (const name of names) {
    const expected = JSON.parse(await readFile(join(input.goldenDirectory, name, "expected-validation-report.json"), "utf8")) as ValidationReport;
    const unsupportedExtensions = Object.entries(expected.required_extensions)
      .filter(([extension, version]) => capabilities.extensions[extension] !== version)
      .map(([extension]) => extension)
      .sort();
    if (expected.evaluation === "complete" && unsupportedExtensions.length > 0) {
      vectors.push({
        name,
        status: "not_run_unsupported" as const,
        collection_changed: false,
        differences: [],
        unsupported_extensions: unsupportedExtensions,
      });
      continue;
    }
    const result = await runConformanceVector({
      vectorDirectory: join(input.goldenDirectory, name),
      schemaDirectory: input.schemaDirectory,
      supportedExtensions: capabilities.extensions,
    });
    vectors.push({
      name,
      status: result.differences.length === 0 && !result.collectionChanged ? "passed" as const : "failed" as const,
      collection_changed: result.collectionChanged,
      differences: result.differences,
      actual_report: result.actual,
    });
  }
  return {
    specification_revision: input.specificationRevision,
    adapter_revision: input.adapterRevision,
    started_at: input.startedAt,
    finished_at: input.finishedAt ?? new Date().toISOString(),
    capabilities,
    summary: {
      discovered: vectors.length,
      executed: vectors.filter((vector) => vector.status !== "not_run_unsupported").length,
      passed: vectors.filter((vector) => vector.status === "passed").length,
      failed: vectors.filter((vector) => vector.status === "failed").length,
      skipped: vectors.filter((vector) => vector.status === "not_run_unsupported").length,
      changed: vectors.filter((vector) => vector.collection_changed).length,
    },
    vectors,
  };
}
