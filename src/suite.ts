import { readFile, readdir } from "node:fs/promises";
import { join } from "node:path";
import { getCapabilities, runConformanceVector } from "./adapter";
import { parseMarkdown } from "./frontmatter";
import { SchemaRegistry } from "./schema-registry";
import { readVectorContext, selectVectorCapabilities } from "./vector-context";
import type { AdapterCapabilities, ExtensionMap, ValidationReport } from "./types";

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
    status: "passed" | "failed" | "not_run_unsupported" | "not_run_precondition";
    collection_changed: boolean;
    differences: string[];
    unsupported_extensions?: string[];
    precondition_extensions?: string[];
    skip_reason?: string;
    requested_extensions?: ExtensionMap;
    actual_report?: ValidationReport;
  }>;
}

export async function runConformanceSuite(input: RunSuiteInput): Promise<ConformanceEvidence> {
  const capabilities = getCapabilities();
  const registry = new SchemaRegistry(input.schemaDirectory);
  const names = (await readdir(input.goldenDirectory, { withFileTypes: true }))
    .filter((entry) => entry.isDirectory())
    .map((entry) => entry.name)
    .sort();
  const vectors = [];
  for (const name of names) {
    const vectorDirectory = join(input.goldenDirectory, name);
    const config = parseMarkdown(await readFile(join(vectorDirectory, "collection", "typedmark.md"), "utf8")).data;
    const selection = selectVectorCapabilities((config.extensions ?? {}) as ExtensionMap, capabilities.extensions, readVectorContext(vectorDirectory, registry));
    if (selection.skip) {
      vectors.push({
        name,
        status: selection.skip.status,
        collection_changed: false,
        differences: [],
        ...(selection.skip.status === "not_run_unsupported"
          ? { unsupported_extensions: selection.skip.extensions }
          : { precondition_extensions: selection.skip.extensions }),
        skip_reason: selection.skip.reason,
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
      requested_extensions: result.requestedExtensions,
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
      executed: vectors.filter((vector) => vector.status === "passed" || vector.status === "failed").length,
      passed: vectors.filter((vector) => vector.status === "passed").length,
      failed: vectors.filter((vector) => vector.status === "failed").length,
      skipped: vectors.filter((vector) => vector.status.startsWith("not_run_")).length,
      changed: vectors.filter((vector) => vector.collection_changed).length,
    },
    vectors,
  };
}
