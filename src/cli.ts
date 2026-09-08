import { resolve } from "node:path";
import { getCapabilities, runConformanceVector } from "./adapter";
import { validateCollection } from "./validator";

const [command, target, ...rest] = Bun.argv.slice(2);

if (command === "capabilities") {
  console.log(JSON.stringify(getCapabilities(), null, 2));
} else if (command === "validate" && target) {
  const schemaDirectory = option(rest, "--schemas");
  if (!schemaDirectory) fail("validate requires --schemas <directory>");
  const scope = option(rest, "--scope") ?? "full";
  const report = validateCollection({
    collectionRoot: resolve(target),
    schemaDirectory: resolve(schemaDirectory),
    mode: (option(rest, "--mode") as "system_definition" | "instantiated_collection" | "both" | undefined) ?? "instantiated_collection",
    supportedExtensions: scope === "core" ? {} : getCapabilities().extensions,
  });
  console.log(JSON.stringify(report, null, 2));
  process.exitCode = report.valid ? 0 : 1;
} else if (command === "run-vector" && target) {
  const schemaDirectory = option(rest, "--schemas");
  if (!schemaDirectory) fail("run-vector requires --schemas <directory>");
  const result = await runConformanceVector({
    vectorDirectory: resolve(target),
    schemaDirectory: resolve(schemaDirectory),
    supportedExtensions: getCapabilities().extensions,
  });
  console.log(JSON.stringify(result, null, 2));
  process.exitCode = result.differences.length === 0 && !result.collectionChanged ? 0 : 1;
} else {
  fail("Usage: bun src/cli.ts capabilities | validate <collection> --schemas <directory> [--mode <mode>] [--scope core|full] | run-vector <vector> --schemas <directory>");
}

function option(args: string[], name: string): string | undefined {
  const index = args.indexOf(name);
  return index >= 0 ? args[index + 1] : undefined;
}

function fail(message: string): never {
  console.error(message);
  process.exit(2);
}
