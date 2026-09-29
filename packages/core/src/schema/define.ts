import { RelaxUIError } from "../errors.js";
import type { JsonSchema } from "../types.js";
import { toJsonSchema } from "./json-schema.js";
import type { SchemaLike } from "./partial.js";

/**
 * A schema bundled with everything the SDK needs to put it on the wire.
 *
 * Callers normally get one from {@link defineStructuredSchema}. The escape
 * hatch matters: our Zod -> JSON Schema converter covers the constructs a
 * generative UI actually uses, but an application with an exotic schema should
 * be able to hand us the JSON Schema it already has rather than being stuck.
 */
export interface StructuredSchema<T> {
  name: string;
  description?: string;
  schema: SchemaLike<T>;
  jsonSchema: JsonSchema;
}

export interface DefineStructuredSchemaOptions<T> {
  name: string;
  description?: string;
  schema: SchemaLike<T>;
  /** Overrides the derived JSON Schema entirely. */
  jsonSchema?: JsonSchema;
  /** Emit OpenAI strict-mode-shaped JSON Schema. Default: true. */
  strict?: boolean;
}

const NAME_PATTERN = /^[A-Za-z][A-Za-z0-9_-]{0,63}$/;

export function defineStructuredSchema<T>(
  options: DefineStructuredSchemaOptions<T>,
): StructuredSchema<T> {
  if (!NAME_PATTERN.test(options.name)) {
    throw new RelaxUIError({
      code: "config_invalid",
      message:
        `Schema name "${options.name}" is invalid. Use 1-64 characters, starting with a ` +
        `letter, from [A-Za-z0-9_-] — OpenAI-compatible servers reject anything else.`,
    });
  }

  const jsonSchema =
    options.jsonSchema ??
    toJsonSchema(options.schema, { name: options.name, strict: options.strict ?? true });

  const result: StructuredSchema<T> = {
    name: options.name,
    schema: options.schema,
    jsonSchema,
  };
  if (options.description !== undefined) result.description = options.description;
  return result;
}
