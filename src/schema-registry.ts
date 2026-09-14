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
    return validate(value) ? [] : [...(validate.errors ?? [])];
  }
}
