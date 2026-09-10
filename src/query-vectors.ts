import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { queryCollection, QueryError, type QueryResult } from "./query";
import type { SchemaRegistry } from "./schema-registry";
import type { ExtensionMap } from "./types";

export interface QueryCaseResult {
  name: string;
  status: "passed" | "failed";
  differences: string[];
  actual_result?: QueryResult;
  error_rule?: string;
}
interface QueryCase {
  name: string;
  query_version: string;
  query: { select: Array<{ as: string }> };
  expected_result?: Omit<QueryResult, "provenance">;
  expected_error?: string;
}

export function runQueryCases(vectorDirectory: string, collectionRoot: string, schemaDirectory: string, enabled: ExtensionMap, registry: SchemaRegistry): QueryCaseResult[] {
  const path = join(vectorDirectory, "query-cases.json");
  if (!existsSync(path)) return [];
  if (enabled["typedmark:queries"] !== "0.1.0") throw new Error("Query cases require the enabled typedmark:queries contract");
  const input: unknown = JSON.parse(readFileSync(path, "utf8"));
  const errors = registry.validate("conformance-query.schema.json", input);
  if (errors.length) throw new Error(`Invalid query cases: ${errors.map((error) => error.message).join("; ")}`);
  const cases = input as QueryCase[];
  if (new Set(cases.map((entry) => entry.name)).size !== cases.length) throw new Error("Duplicate query case names");
  return cases.map((entry) => {
    const result: QueryCaseResult = { name: entry.name, status: "passed", differences: [] };
    try {
      const actual = queryCollection({ collectionRoot, schemaDirectory, queryVersion: entry.query_version, query: entry.query });
      result.actual_result = actual;
      const { provenance: _provenance, ...normalized } = actual;
      if (entry.expected_error || JSON.stringify(canonical(normalized)) !== JSON.stringify(canonical(entry.expected_result))) {
        result.differences.push("Query result differs from the expected normalized result");
      }
      const aliases = entry.query.select.map((column) => column.as);
      if (actual.rows.some((row) => JSON.stringify(Object.keys(row)) !== JSON.stringify(aliases))) result.differences.push("Projection alias order differs from select order");
    } catch (error) {
      if (error instanceof QueryError) {
        result.error_rule = error.rule_id;
        if (entry.expected_error !== error.rule_id) result.differences.push(`Unexpected query failure: ${error.message}`);
      } else result.differences.push(`Operational failure: ${error instanceof Error ? error.message : String(error)}`);
    }
    if (result.differences.length) result.status = "failed";
    return result;
  });
}

function canonical(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(canonical);
  if (value !== null && typeof value === "object") return Object.fromEntries(Object.entries(value).sort(([a], [b]) => a < b ? -1 : a > b ? 1 : 0).map(([key, child]) => [key, canonical(child)]));
  return value;
}
