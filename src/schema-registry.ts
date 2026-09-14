import Ajv2020, { type ErrorObject, type ValidateFunction } from "ajv/dist/2020";
import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";

export class SchemaRegistry {
  readonly #ajv: Ajv2020;
  readonly #validators = new Map<string, ValidateFunction>();
  readonly #schemaIds = new Map<string, string>();

  constructor(schemaDirectory: string) {
    this.#ajv = new Ajv2020({ allErrors: true, strict: false, validateFormats: false });
    const schemas = readdirSync(schemaDirectory)
      .filter((name) => name.endsWith(".schema.json"))
      .map((name) => JSON.parse(readFileSync(join(schemaDirectory, name), "utf8")));
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
function shapeValue(value: unknown, seen = new WeakMap<object, unknown>()): unknown {
  if (value === null || typeof value !== "object") return value;
  if (seen.has(value)) return seen.get(value);
  const array = Array.isArray(value);
  const prototype = Object.getPrototypeOf(value);
  if (!array && prototype !== null && prototype !== Object.prototype) {
    // Preserve identity without making different native values false duplicates.
    const marker = Symbol("non-JSON YAML value");
    seen.set(value, marker);
    return marker;
  }
  // Ordinary objects retain their prototype for AJV's deep equality helpers.
  const projected = array ? new Array(value.length) : Object.create(prototype);
  seen.set(value, projected);
  for (const [key, child] of Object.entries(value)) {
    // Assignment could interpret an authored __proto__ key as a prototype write.
    Object.defineProperty(projected, key, {
      value: shapeValue(child, seen), enumerable: true, writable: true, configurable: true,
    });
  }
  return projected;
}
