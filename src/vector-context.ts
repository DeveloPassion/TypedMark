import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import type { SchemaRegistry } from "./schema-registry";
import type { ExtensionMap } from "./types";

export interface VectorContext {
  disabled_extensions?: string[];
  unsupported_extensions?: string[];
}

export interface VectorSelection {
  supportedExtensions: ExtensionMap;
  skip?: {
    status: "not_run_unsupported" | "not_run_precondition";
    extensions: string[];
    reason: string;
  };
}

export function readVectorContext(directory: string, registry: SchemaRegistry): VectorContext {
  const path = join(directory, "vector.json");
  if (!existsSync(path)) return {};
  const context: unknown = JSON.parse(readFileSync(path, "utf8"));
  const errors = registry.validate("conformance-vector.schema.json", context);
  if (errors.length > 0) throw new Error(`${path}: invalid negotiation context: ${errors.map((error) => error.message).join("; ")}`);
  return context as VectorContext;
}

export function selectVectorCapabilities(required: ExtensionMap, available: ExtensionMap, context: VectorContext): VectorSelection {
  const disabled = context.disabled_extensions ?? [];
  const unsupported = context.unsupported_extensions ?? [];
  for (const extension of [...disabled, ...unsupported]) {
    if (!Object.hasOwn(required, extension)) throw new Error(`vector.json: ${extension} is not declared by the collection`);
    if (disabled.includes(extension) && unsupported.includes(extension)) {
      throw new Error(`vector.json: ${extension} cannot be both disabled and unsupported`);
    }
  }
  const supportedExtensions = Object.fromEntries(Object.entries(available).filter(([extension]) => !disabled.includes(extension)));
  const unmet = [
    ...disabled.filter((extension) => available[extension] !== required[extension]),
    ...unsupported.filter((extension) => available[extension] === required[extension]),
  ].sort();
  if (unmet.length > 0) return {
    supportedExtensions,
    skip: { status: "not_run_precondition", extensions: unmet, reason: "Adapter capabilities do not satisfy the explicit negotiation preconditions" },
  };
  const missing = Object.keys(required).filter((extension) =>
    available[extension] !== required[extension] && !unsupported.includes(extension)).sort();
  if (missing.length > 0) return {
    supportedExtensions,
    skip: { status: "not_run_unsupported", extensions: missing, reason: "A required extension is unavailable outside an explicit negotiation case" },
  };
  return { supportedExtensions };
}
