import { noteFieldDefinitions, type CollectionModel } from "./collection-model";
import { readStableCollection } from "./snapshot";
import { DEFAULT_SEVERITIES, readCollectionModel } from "./validator";

type Data = Record<string, any>;
export const EFFECTIVE_SCHEMA_VERSION = "0.1.0";

export class EffectiveSchemaError extends Error {}

/**
 * The read-only `typedmark:effective-schema` document of one concrete type (ES-1):
 * effective values only (ES-3), fields with the layer that last declared them (ES-5, ES-6).
 */
export function exportEffectiveSchema(model: CollectionModel, type: string): Data {
  const schema = model.schemas.get(type);
  if (!schema || schema.abstract || model.schemaIssues?.has(type)) throw new EffectiveSchemaError(`${type} is not a valid concrete note type`);
  const origins = model.fieldOrigins?.get(type) ?? {};
  const fields = Object.fromEntries(
    Object.entries(noteFieldDefinitions(schema)).map(([name, definition]) => [name, { definition, origin: origins[name] ?? { kind: "core" } }]),
  );
  // Nearest parent first (ES-4).
  const ancestors: string[] = [];
  for (let parent = schema.extends; parent && !ancestors.includes(parent); parent = model.schemas.get(parent)?.extends) ancestors.push(parent);
  // Collection policy, then the type's, first occurrence kept (CM-231, ES-7).
  const mandatory: string[] = [];
  for (const tag of [...(model.config.mandatory_tags ?? []), ...(schema.mandatory_tags ?? [])])
    if (!mandatory.some((kept) => kept.normalize("NFC") === tag.normalize("NFC"))) mandatory.push(tag);
  const optional = Object.fromEntries(
    ["icon", "template", "inputs", "count", "guidance", "conditions"].filter((key) => schema[key] !== undefined).map((key) => [key, schema[key]]),
  );
  return {
    contract: "typedmark:effective-schema",
    version: EFFECTIVE_SCHEMA_VERSION,
    specification_version: String(schema.specification_version),
    note_type: type,
    label: schema.label ?? type,
    description: schema.description,
    ...(ancestors.length ? { ancestors } : {}),
    fields,
    storage: schema.storage,
    headings: schema.headings,
    relationships: schema.relationships,
    mandatory_tags: mandatory,
    unknown_field: schema.unknown_field ?? model.config.validation_defaults?.unknown_field ?? DEFAULT_SEVERITIES.unknown_field ?? "error",
    ...optional,
  };
}

/** Read one collection snapshot and export one type's document. */
export function exportCollectionEffectiveSchema(input: { collectionRoot: string; schemaDirectory: string }, type: string): Data {
  const model = readStableCollection(input.collectionRoot, (snapshotRoot, info) =>
    readCollectionModel({ ...input, collectionRoot: snapshotRoot }, { blockedPaths: info.blockedPaths }),
  );
  return exportEffectiveSchema(model, type);
}
