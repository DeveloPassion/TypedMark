import Ajv2020, { type ErrorObject, type ValidateFunction } from "ajv/dist/2020";
import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";

export class SchemaRegistry {
  readonly #ajv: Ajv2020;
  readonly #validators = new Map<string, ValidateFunction>();

  constructor(schemaDirectory: string) {
    this.#ajv = new Ajv2020({ allErrors: true, strict: false, validateFormats: false });
    const schemas = readdirSync(schemaDirectory)
      .filter((name) => name.endsWith(".schema.json"))
      .map((name) => JSON.parse(readFileSync(join(schemaDirectory, name), "utf8")));
    for (const schema of schemas) this.#ajv.addSchema(schema);
    for (const schema of schemas) {
      const name = schema.$id.split("/").at(-1);
      const validate = this.#ajv.getSchema(schema.$id);
      if (name && validate) this.#validators.set(name, validate);
    }
  }

  validate(schemaName: string, value: unknown): ErrorObject[] {
    const validate = this.#validators.get(schemaName);
    if (!validate) throw new Error(`Unknown TypedMark schema: ${schemaName}`);
    return validate(value) ? [] : [...(validate.errors ?? [])];
  }
}
