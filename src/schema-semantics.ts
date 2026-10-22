import { validateFieldDefinition } from "./field-definitions";
import type { FieldDefinition, ValueFailure } from "./field-values";
import { matchesNoteType } from "./reuse";
import { aliasValueFailure, noteFieldDefinitions } from "./collection-model";
import { validateStorageDefinition } from "./storage";

type Data = Record<string, any>;
export function validateReusableBlocks(schema: Data, schemas: Map<string, Data>, config: Data): ValueFailure[] {
  const failures: ValueFailure[] = [];
  const fail = (rule: string, message: string) => failures.push({ rule, message });
  const checkTargets = (definition: FieldDefinition) => {
    for (const type of definition.targets ?? []) if (!schemas.has(type)) fail("FDR-158", `Unknown field target ${type}`);
    if (definition.items) checkTargets(definition.items);
    for (const child of Object.values(definition.fields ?? {})) checkTargets(child);
  };
  for (const [field, definition] of Object.entries(schema.frontmatter ?? {}) as Array<[string, FieldDefinition]>) {
    const failure = validateFieldDefinition(definition, config.timezone ?? "UTC", config.vocabularies);
    if (failure) failures.push({ ...failure, message: `${field}: ${failure.message}` });
    const aliasFailure = field === "aliases" && Object.hasOwn(definition, "default_value") ? aliasValueFailure(definition.default_value) : undefined;
    if (aliasFailure) fail("FDR-4", `Invalid aliases default: ${aliasFailure.message}`);
    checkTargets(definition);
  }
  const declarations = (kind: string): Data => schema.relationships?.[kind]?.allowed_note_types ?? {};
  for (const kind of ["belongs_to", "related_to"]) for (const [target, count] of Object.entries(declarations(kind))) {
    if (!schemas.has(target)) fail("RHT-15", `Unknown relationship target ${target}`);
    if ((count.min ?? 0) > (count.max ?? Infinity)) fail("RHT-26", `Relationship minimum exceeds maximum for ${target}`);
  }
  for (const [name, target] of schemas) if (!target.abstract
    && Object.keys(declarations("belongs_to")).some((type) => matchesNoteType(schemas, name, type))
    && Object.keys(declarations("related_to")).some((type) => matchesNoteType(schemas, name, type))) fail("RHT-21", `${name} is declared under both relationship kinds`);
  if (!schema.abstract) {
    // Field targets must be declared under their kind (FDR-164), and each
    // (kind, concrete target) has one field so writers know where to link (RHT-292).
    const concrete = (types: string[]) => [...schemas].filter(([name, target]) => !target.abstract && types.some((type) => matchesNoteType(schemas, name, type))).map(([name]) => name);
    const claimed = new Map<string, string>();
    for (const [field, definition] of Object.entries(noteFieldDefinitions(schema)) as Array<[string, FieldDefinition]>) {
      const kind = definition.relationship_kind;
      if (!kind) continue;
      const link = definition.type === "list" ? definition.items : definition;
      const declared = concrete(Object.keys(declarations(kind)));
      const admitted = link?.targets ? concrete(link.targets) : declared;
      const undeclared = admitted.filter((type) => !declared.includes(type));
      if (undeclared.length) fail("FDR-164", `${field} targets ${undeclared.join(", ")} not declared under ${kind}`);
      for (const type of admitted) {
        const owner = claimed.get(`${kind}:${type}`);
        if (owner) fail("RHT-292", `${owner} and ${field} both admit ${kind} target ${type}`);
        else claimed.set(`${kind}:${type}`, field);
      }
    }
  }
  const required = (schema.headings?.required_h2 ?? []).map((heading: string) => heading.normalize("NFC"));
  const optional = (schema.headings?.optional_h2 ?? []).map((heading: string) => heading.normalize("NFC"));
  if (new Set(required).size !== required.length || new Set(optional).size !== optional.length) fail("RHT-285", "Heading entries are not unique under string equality");
  if (required.some((heading: string) => optional.includes(heading))) fail("RHT-286", "Required and optional headings overlap");
  if (schema.storage) failures.push(...validateStorageDefinition(schema.storage, schema.abstract ? undefined : noteFieldDefinitions(schema)));
  return failures;
}
