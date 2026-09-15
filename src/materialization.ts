import { randomUUID } from "node:crypto";
import { basename } from "node:path";
import { Temporal } from "@js-temporal/polyfill";
import { noteFieldDefinitions } from "./collection-model";
import { equalFieldValues, isMapping, isTemplatePlaceholder, validateFieldValue, type FieldDefinition } from "./field-values";
import { mandatoryTags, type TemplateContext, type TemplateSchema } from "./templates";
import { YamlValue } from "./yaml-values";

export interface StarterInput {
  noteType: string;
  path: string;
  starter: { data: Record<string, unknown>; body: string };
  values?: Record<string, unknown>;
  yaml?: { starter?: YamlValue; values?: YamlValue; definitions: ReadonlyMap<string, YamlValue> };
}
export interface MaterializationRuntime { instant(): string; uuid(): string }
export class MaterializationError extends Error {
  constructor(readonly rule: string, message: string) { super(`${rule}: ${message}`); }
}

/** Materialize one import batch. Read-only validators never call this module. */
export function materializeStarters(inputs: readonly StarterInput[], schemas: ReadonlyMap<string, TemplateSchema>, config: TemplateContext, runtime: MaterializationRuntime = {
  instant: () => Temporal.Now.instant().toString(), uuid: randomUUID,
}): Array<{ noteType: string; path: string; data: Record<string, unknown>; body: string; yaml?: YamlValue }> {
  const timezone = config.timezone ?? "UTC";
  const global = new Set([JSON.stringify(["id", "text"])]), local = new Set<string>();
  for (const [type, schema] of schemas) {
    if (schema.abstract) continue;
    for (const [field, definition] of Object.entries(noteFieldDefinitions(schema))) {
      if (definition.unique === "collection") global.add(JSON.stringify([field, definition.type]));
      else if (definition.unique) local.add(JSON.stringify([type, field, definition.type]));
    }
  }
  const scope = (type: string, field: string, definition: FieldDefinition) => global.has(JSON.stringify([field, definition.type]))
    ? JSON.stringify([null, field, definition.type]) : local.has(JSON.stringify([type, field, definition.type])) ? JSON.stringify([type, field, definition.type]) : undefined;
  const occupied = new Map<string, unknown[]>();
  const jobs: Array<{ type: string; field: string; definition: FieldDefinition; set(value: unknown): void }> = [];
  const result = inputs.map((input) => {
    const schema = schemas.get(input.noteType);
    if (!schema || schema.abstract) throw new MaterializationError("SCE-17", `Unknown or abstract scaffold type ${input.noteType}`);
    const supplied = input.values ?? {}, fields = noteFieldDefinitions(schema);
    if (Object.hasOwn(supplied, "note_type") && supplied.note_type !== input.noteType) throw new MaterializationError("MN-40", "Supplied note_type differs from the scaffold target");
    const data: Record<string, unknown> = Object.create(null);
    type BuildValue = () => YamlValue;
    const yaml = input.yaml && new Map<string, BuildValue>();
    const assign = (field: string, value: unknown, source?: BuildValue) => {
      data[field] = value;
      yaml?.set(field, source ?? (() => YamlValue.literal(value)));
    };
    const fill = (value: unknown, definition: FieldDefinition, explicit: boolean, present: boolean, field: string, set: (value: unknown, source?: BuildValue) => void, source?: YamlValue, definitionSource?: YamlValue, authoredDefault = true): void => {
      const placeholder = !explicit && isTemplatePlaceholder(value, definition);
      if (definition.generated && ((!present || placeholder) || (definition.generated === "now_on_write" && value !== null))) {
        jobs.push({ type: input.noteType, field, definition, set }); return;
      }
      if (!present || placeholder) {
        if (Object.hasOwn(definition, "default_value")) {
          value = structuredClone(definition.default_value);
          source = definitionSource?.field("default_value")?.fork();
          if (definitionSource && authoredDefault && !source) throw new Error(`Missing YAML default source for ${field}`);
          // Values inside a declared default are concrete, not template holes.
          explicit = true;
        }
        else if (field === "title") { value = basename(input.path, ".md"); source = undefined; }
        else if (field === "id" && definition.nullable) return;
        else if (!present) { value = null; source = undefined; }
      }
      if (definition.type === "object" && isMapping(value)) {
        const object = value as Record<string, unknown>, next: Record<string, unknown> = Object.create(null);
        const children = yaml && new Map<string, BuildValue>();
        for (const name of new Set([...Object.keys(object), ...Object.keys(definition.fields ?? {})])) {
          const child = definition.fields?.[name];
          const assignChild = (filled: unknown, build?: BuildValue) => {
            next[name] = filled;
            children?.set(name, build ?? (() => YamlValue.literal(filled)));
          };
          const childSource = source?.field(name);
          if (!child) {
            next[name] = structuredClone(object[name]);
            // Unknown object members are opaque. Keep their original YAML
            // pairs, including key types that a JS object cannot represent.
            if (!source) assignChild(next[name]);
          }
          else fill(object[name], child, explicit && Object.hasOwn(object, name), Object.hasOwn(object, name), `${field}.${name}`, assignChild, childSource, definitionSource?.field("fields")?.field(name));
        }
        set(next, children && (() => {
          const fields = new Map([...children].map(([key, build]) => [key, build()]));
          return source ? YamlValue.withFields(fields, source) : YamlValue.mapping(fields);
        }));
        return;
      } else if (definition.type === "list" && definition.items && Array.isArray(value)) {
        const next: unknown[] = [];
        const children: BuildValue[] | undefined = yaml && [];
        value.forEach((item, index) => fill(item, definition.items!, explicit, true, `${field}.${index}`, (filled, build) => {
          next[index] = filled;
          if (children) children[index] = build ?? (() => YamlValue.literal(filled));
        }, source?.at(index), definitionSource?.field("items")));
        set(next, children && (() => YamlValue.sequence(children.map(build => build()), source)));
        return;
      } else value = structuredClone(value);
      set(value, source && (() => source!));
    };
    for (const field of new Set([...Object.keys(schema.frontmatter ?? {}), ...Object.keys(input.starter.data), ...Object.keys(supplied)])) {
      const explicit = Object.hasOwn(supplied, field), source = explicit ? supplied : input.starter.data;
      const definition = Object.hasOwn(fields, field) ? fields[field] : undefined;
      const origin = (explicit ? input.yaml?.values : input.yaml?.starter)?.field(field);
      if (!definition) assign(field, structuredClone(source[field]), origin && (() => origin));
      else fill(source[field], definition, explicit, Object.hasOwn(source, field), field, (value, build) => assign(field, value, build), origin, input.yaml?.definitions.get(field), Object.hasOwn(schema.frontmatter?.[field] ?? {}, "default_value"));
    }
    assign("note_type", input.noteType, data.note_type === input.noteType ? yaml?.get("note_type") : undefined);
    const tags = mandatoryTags(schema, config);
    if (tags.length && !Object.hasOwn(data, "tags")) data.tags = [];
    if (Array.isArray(data.tags)) {
      const original = yaml?.get("tags")?.();
      const tagNodes = yaml && data.tags.map((tag, index) => original?.at(index) ?? YamlValue.literal(tag));
      const seen = new Set(data.tags.filter((tag) => typeof tag === "string").map((tag) => tag.normalize("NFC")));
      for (const tag of tags) if (!seen.has(tag.normalize("NFC"))) { data.tags.push(tag); tagNodes?.push(YamlValue.literal(tag)); seen.add(tag.normalize("NFC")); }
      if (tagNodes) yaml!.set("tags", () => YamlValue.sequence(tagNodes, original));
    }
    return { noteType: input.noteType, path: input.path, data, body: input.starter.body, yaml, base: input.yaml?.starter ?? input.yaml?.values };
  });
  // Reserve all concrete inputs/defaults before any generator runs, including
  // values from later scaffold entries and collection-wide declarations.
  for (const note of result) for (const [field, value] of Object.entries(note.data)) {
    const definition = noteFieldDefinitions(schemas.get(note.noteType)!)[field];
    if (!definition || value === null || value === undefined || validateFieldValue(value, definition, timezone, config.vocabularies)) continue;
    const key = scope(note.noteType, field, definition);
    if (key) occupied.set(key, [...occupied.get(key) ?? [], value]);
  }
  for (const job of jobs) {
    const key = scope(job.type, job.field, job.definition);
    for (let attempt = 0; ; attempt++) {
      if (attempt === 100) throw new MaterializationError("FDR-75", `Generator could not produce a unique ${job.field}`);
      const value = generate(job.definition, timezone, runtime);
      const failure = validateFieldValue(value, job.definition, timezone, config.vocabularies);
      if (failure) throw new MaterializationError("FDR-65", `Generated ${job.field} ${failure.message}`);
      if (key && occupied.get(key)?.some((previous) => equalFieldValues(previous, value, job.definition, timezone))) continue;
      if (key) occupied.set(key, [...occupied.get(key) ?? [], value]);
      job.set(value); break;
    }
  }
  // Generators may update nested values after the initial fill. Build the YAML
  // graph only now, so it contains final values rather than old placeholders.
  return result.map(({ yaml, base, ...note }) => yaml
    ? { ...note, yaml: YamlValue.mapping(new Map([...yaml].map(([key, build]) => [key, build()])), base) }
    : note);
}

function generate(definition: FieldDefinition, timezone: string, runtime: MaterializationRuntime): string {
  // https://nodejs.org/docs/latest-v22.x/api/crypto.html#cryptorandomuuidoptions
  if (definition.generated === "uuid") return runtime.uuid();
  if (definition.generated !== "now" && definition.generated !== "now_on_write") throw new MaterializationError("FDR-74", "This import does not implement the declared optional generator");
  // https://tc39.es/proposal-temporal/docs/zoneddatetime.html#toString
  const date = Temporal.Instant.from(runtime.instant()).toZonedDateTimeISO(timezone);
  if (definition.type === "date") return date.toPlainDate().toString();
  if (definition.type === "time") return date.toPlainTime().toString({ smallestUnit: definition.format === "hh:mm" ? "minute" : definition.format === "hh:mm:ss" ? "second" : "millisecond", roundingMode: "trunc" });
  return date.toString({ calendarName: "never", timeZoneName: "never" });
}
