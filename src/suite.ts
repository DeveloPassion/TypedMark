import { readdir } from "node:fs/promises";
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
  summary: { total: number; passed: number; failed: number; changed: number };
  vectors: Array<{
    name: string;
    passed: boolean;
    collection_changed: boolean;
    differences: string[];
    actual_report: ValidationReport;
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
    const result = await runConformanceVector({
      vectorDirectory: join(input.goldenDirectory, name),
      schemaDirectory: input.schemaDirectory,
      supportedExtensions: capabilities.extensions,
    });
    vectors.push({
      name,
      passed: result.differences.length === 0 && !result.collectionChanged,
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
      total: vectors.length,
      passed: vectors.filter((vector) => vector.passed).length,
      failed: vectors.filter((vector) => !vector.passed).length,
      changed: vectors.filter((vector) => vector.collection_changed).length,
    },
    vectors,
  };
}
