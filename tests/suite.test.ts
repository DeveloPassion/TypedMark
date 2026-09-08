import { expect, test } from "bun:test";
import { join, resolve } from "node:path";
import { runConformanceSuite } from "../src/suite";

const specificationRoot = resolve(import.meta.dir, "../../TypedMarkSpecification");

test("records reproducible evidence for every golden vector", async () => {
  const evidence = await runConformanceSuite({
    goldenDirectory: join(specificationRoot, "schema", "fixtures", "golden"),
    schemaDirectory: join(specificationRoot, "schema", "json-schema"),
    specificationRevision: "spec-test-revision",
    adapterRevision: "adapter-test-revision",
    startedAt: "2026-09-08T08:00:00.000Z",
    finishedAt: "2026-09-08T08:01:00.000Z",
  });

  expect(evidence.summary).toEqual({ total: 6, passed: 6, failed: 0, changed: 0 });
  expect(evidence.specification_revision).toBe("spec-test-revision");
  expect(evidence.adapter_revision).toBe("adapter-test-revision");
  expect(evidence.vectors.map((vector) => vector.name)).toContain("unsupported-required-extension");
  expect(evidence.vectors.every((vector) => vector.differences.length === 0 && !vector.collection_changed)).toBe(true);
});
