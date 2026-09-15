import Ajv2020, { type ErrorObject, type ValidateFunction } from "ajv/dist/2020";
import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { decodeUtf8 } from "./utf8";

export class SchemaRegistry {
  readonly #ajv: Ajv2020;
  readonly #validators = new Map<string, ValidateFunction>();
  readonly #schemaIds = new Map<string, string>();

  constructor(schemaDirectory: string) {
    this.#ajv = new Ajv2020({ allErrors: true, strict: false, validateFormats: false });
    const schemas = readdirSync(schemaDirectory)
      .filter((name) => name.endsWith(".schema.json"))
      .map((name) => {
        const path = join(schemaDirectory, name);
        return JSON.parse(decodeUtf8(readFileSync(path), path));
      });
    for (const schema of schemas) this.#ajv.addSchema(schema);
    for (const schema of schemas) {
      const name = schema.$id.split("/").at(-1);
      const validate = this.#ajv.getSchema(schema.$id);
      if (name && validate) {
        this.#validators.set(name, validate);
        this.#schemaIds.set(name, schema.$id);
      }
    }
  }

  validate(schemaName: string, value: unknown): ErrorObject[] {
    let validate = this.#validators.get(schemaName);
    if (!validate && schemaName.includes("#")) {
      const separator = schemaName.indexOf("#");
      const id = this.#schemaIds.get(schemaName.slice(0, separator));
      // getSchema resolves registered references locally, including fragments.
      // https://ajv.js.org/api.html (getSchema)
      if (id) validate = this.#ajv.getSchema(id + schemaName.slice(separator));
      if (validate) this.#validators.set(schemaName, validate);
    }
    if (!validate) throw new Error(`Unknown TypedMark schema: ${schemaName}`);
    return validate(shapeValue(value)) ? [] : [...(validate.errors ?? [])];
  }
}

/** AJV's JavaScript object test also accepts native YAML containers as maps.
 * Validate their shape without changing the original model or opaque values.
 * A symbol matches no JSON type, but remains accepted by an unconstrained {}.
 */
function shapeValue(value: unknown): unknown {
  const seen = new WeakMap<object, unknown>();
  const pending: Array<{ source: object; target: object }> = [];
  const project = (item: unknown): unknown => {
    if (item === null || typeof item !== "object") return item;
    if (seen.has(item)) return seen.get(item);
    const array = Array.isArray(item);
    const prototype = Object.getPrototypeOf(item);
    if (!array && prototype !== null && prototype !== Object.prototype) {
      const marker = Symbol("non-JSON YAML value");
      seen.set(item, marker);
      return marker;
    }
    // Retain ordinary-object prototypes for AJV's deep equality helpers.
    const target = array ? new Array(item.length) : Object.create(prototype);
    seen.set(item, target);
    pending.push({ source: item, target });
    return target;
  };
  const result = project(value);
  // Avoid a call-stack limit on deep opaque metadata.
  while (pending.length) {
    const { source, target } = pending.pop()!;
    for (const [key, child] of Object.entries(source)) {
      Object.defineProperty(target, key, {
        value: project(child), enumerable: true, writable: true, configurable: true,
      });
    }
  }
  return result;
}
