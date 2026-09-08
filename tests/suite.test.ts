import { expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { SchemaRegistry } from "../src/schema-registry";
import { runConformanceSuite } from "../src/suite";

const specificationRoot = resolve(import.meta.dir, "../../TypedMarkSpecification");
const schemaDirectory = join(specificationRoot, "schema", "json-schema");

test("records reproducible evidence for every golden vector", async () => {
  const evidence = await runConformanceSuite({
    goldenDirectory: join(specificationRoot, "schema", "fixtures", "golden"),
    schemaDirectory,
    specificationRevision: "spec-test-revision",
    adapterRevision: "adapter-test-revision",
    startedAt: "2026-09-08T08:00:00.000Z",
    finishedAt: "2026-09-08T08:01:00.000Z",
  });

  expect(evidence.summary).toEqual({ discovered: 6, executed: 4, passed: 4, failed: 0, skipped: 2, changed: 0 });
  expect(evidence.specification_revision).toBe("spec-test-revision");
  expect(evidence.adapter_revision).toBe("adapter-test-revision");
  expect(evidence.vectors.map((vector) => vector.name)).toContain("unsupported-required-extension");
  expect(evidence.vectors.filter((vector) => vector.status !== "not_run_unsupported").every((vector) => vector.differences.length === 0 && !vector.collection_changed)).toBe(true);
  expect(evidence.vectors.filter((vector) => vector.status === "not_run_unsupported").map((vector) => vector.name)).toEqual([
    "explicit-type-property-set-valid",
    "optional-artifacts-valid",
  ]);
});

test("checked-in evidence contains schema-valid reports and a passing summary", () => {
  const evidence = JSON.parse(readFileSync(resolve(import.meta.dir, "../evidence/0.1.0/conformance.json"), "utf8"));
  expect(evidence.summary).toEqual({ discovered: 6, executed: 4, passed: 4, failed: 0, skipped: 2, changed: 0 });
  const registry = new SchemaRegistry(schemaDirectory);
  for (const vector of evidence.vectors) {
    if (vector.actual_report) expect(registry.validate("validation-report.schema.json", vector.actual_report), vector.name).toEqual([]);
  }
});
