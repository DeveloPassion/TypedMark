import { join, resolve } from "node:path";
import { runConformanceSuite } from "../src/suite";

const args = Bun.argv.slice(2);
const specificationRoot = resolve(option(args, "--spec") ?? "../TypedMarkSpecification");
const startedAt = new Date().toISOString();
const evidence = await runConformanceSuite({
  goldenDirectory: join(specificationRoot, "schema", "fixtures", "golden"),
  schemaDirectory: join(specificationRoot, "schema", "json-schema"),
  specificationRevision: revision(specificationRoot),
  adapterRevision: revision(resolve(import.meta.dir, "..")),
  startedAt,
});

console.log(JSON.stringify(evidence, null, 2));
if (evidence.summary.failed > 0 || evidence.summary.changed > 0) process.exitCode = 1;

function option(values: string[], name: string): string | undefined {
  const index = values.indexOf(name);
  return index >= 0 ? values[index + 1] : undefined;
}

function revision(directory: string): string {
  const result = Bun.spawnSync(["git", "-C", directory, "rev-parse", "HEAD"], { stdout: "pipe", stderr: "pipe" });
  if (result.exitCode !== 0) throw new Error(result.stderr.toString().trim());
  return result.stdout.toString().trim();
}
