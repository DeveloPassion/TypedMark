import { resolve } from "node:path";
import { readFileSync } from "node:fs";
import { getCapabilities, runConformanceVector } from "./adapter";
import { checkMigrationReadiness, instantiateSystem } from "./system";
import { validateCollection } from "./validator";
import { queryCollection, QueryError } from "./query";

const [command, target, ...rest] = Bun.argv.slice(2);

if (command === "capabilities") {
  console.log(JSON.stringify(getCapabilities(), null, 2));
} else if (command === "query" && target) {
  const schemaDirectory = option(rest, "--schemas");
  const queryPath = option(rest, "--query");
  const queryVersion = option(rest, "--query-version");
  if (!schemaDirectory || !queryPath || !queryVersion) fail("query requires --query <descriptor.json> --query-version <exact-version> --schemas <directory>");
  try {
    const result = queryCollection({ collectionRoot: resolve(target), schemaDirectory: resolve(schemaDirectory), queryVersion, query: JSON.parse(readFileSync(queryPath, "utf8")) });
    console.log(JSON.stringify(result, null, 2));
  } catch (error) {
    if (!(error instanceof QueryError)) throw error;
    console.error(JSON.stringify({ rule_id: error.rule_id, message: error.message }));
    process.exitCode = 1;
  }
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
} else if (command === "instantiate" && target) {
  const destination = rest[0];
  const schemaDirectory = option(rest, "--schemas");
  const name = option(rest, "--name");
  if (!destination || !schemaDirectory || !name) fail("instantiate requires <system> <target> --name <collection-name> --schemas <directory>");
  const result = await instantiateSystem({
    sourceRoot: resolve(target),
    targetRoot: resolve(destination),
    collectionName: name,
    description: option(rest, "--description"),
    schemaDirectory: resolve(schemaDirectory),
  });
  console.log(JSON.stringify({ source: result.source, created_paths: result.createdPaths, report: result.report }, null, 2));
} else if (command === "migration-readiness" && target) {
  const schemaDirectory = option(rest, "--schemas");
  const fromVersion = option(rest, "--from");
  if (!schemaDirectory || !fromVersion) fail("migration-readiness requires <system> --from <version> --schemas <directory>");
  const readiness = checkMigrationReadiness({ systemRoot: resolve(target), fromVersion, schemaDirectory: resolve(schemaDirectory) });
  console.log(JSON.stringify(readiness, null, 2));
  process.exitCode = readiness.status === "ready" ? 0 : 1;
} else {
  fail("Usage: bun src/cli.ts capabilities | query <collection> --query <descriptor.json> --query-version <exact-version> --schemas <directory> | validate <collection> --schemas <directory> [--mode <mode>] [--scope core|full] | run-vector <vector> --schemas <directory> | instantiate <system> <target> --name <name> --schemas <directory> | migration-readiness <system> --from <version> --schemas <directory>");
}

function option(args: string[], name: string): string | undefined {
  const index = args.indexOf(name);
  return index >= 0 ? args[index + 1] : undefined;
}

function fail(message: string): never {
  console.error(message);
  process.exit(2);
}
