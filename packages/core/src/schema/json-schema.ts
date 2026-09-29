import { RelaxUIError } from "../errors.js";
import type { JsonObject, JsonSchema, JsonValue } from "../types.js";
import {
  arrayElement, arrayLength, checksOf, defaultValue, descriptionOf, discriminatorOf, enumValues,
  innerType, isZodLike, kindOf, lazyGetter, literalValues, objectAllowsUnknownKeys,
  objectShape, recordTypes, tupleItems, unionOptions, type ZodLike,
} from "./zod-introspect.js";

/**
 * Zod -> JSON Schema (Draft 2020-12).
 *
 * The server needs a JSON Schema to put in `response_format.json_schema` or in
 * a tool's `parameters`; the application already wrote a Zod schema to get
 * types and runtime validation. Asking developers to maintain both by hand is
 * exactly the friction this SDK exists to remove.
 *
 * Recursive schemas — which every component tree is — are handled by assigning
 * a `$defs` entry the first time a schema object is re-entered and emitting a
 * `$ref` thereafter. That relies on `z.lazy()` returning the same schema
 * instance on each call, which it does.
 */

export interface ToJsonSchemaOptions {
  /** Schema name, used for `$defs` keys and `response_format.json_schema.name`. */
  name?: string;
  /**
   * Emit OpenAI strict-mode-compatible output: every object property listed in
   * `required` and `additionalProperties: false` everywhere. Servers that
   * implement strict decoding need this; servers that do not, ignore it.
   */
  strict?: boolean;
}

interface BuildContext {
  defs: Record<string, JsonSchema>;
  /** Schemas currently on the walk stack, mapped to their assigned `$defs` name. */
  seen: Map<ZodLike, string>;
  names: Set<string>;
  strict: boolean;
}

export function toJsonSchema(schema: unknown, options: ToJsonSchemaOptions = {}): JsonSchema {
  if (!isZodLike(schema)) {
    throw new RelaxUIError({
      code: "config_invalid",
      message: "toJsonSchema expects a Zod schema.",
    });
  }

  const ctx: BuildContext = {
    defs: {},
    seen: new Map(),
    names: new Set(),
    strict: options.strict ?? false,
  };

  const root = build(schema, ctx, options.name ?? "Root");
  const out: JsonSchema = { $schema: "https://json-schema.org/draft/2020-12/schema", ...root };
  if (Object.keys(ctx.defs).length > 0) out["$defs"] = ctx.defs as unknown as JsonValue;
  return out;
}

function uniqueName(ctx: BuildContext, base: string): string {
  let candidate = base.replace(/[^A-Za-z0-9_]/g, "_") || "Schema";
  let n = 1;
  while (ctx.names.has(candidate)) candidate = `${base}_${++n}`;
  ctx.names.add(candidate);
  return candidate;
}

function build(schema: ZodLike, ctx: BuildContext, hint: string): JsonSchema {
  const existing = ctx.seen.get(schema);
  if (existing) return { $ref: `#/$defs/${existing}` };

  const kind = kindOf(schema);
  const description = descriptionOf(schema);

  // Only container kinds can be recursive, so only they need a `$defs` slot.
  const recursable = kind === "object" || kind === "union" || kind === "lazy";
  let assignedName: string | undefined;
  if (recursable) {
    assignedName = uniqueName(ctx, hint);
    ctx.seen.set(schema, assignedName);
  }

  const body = buildBody(schema, kind, ctx, hint);
  if (description) body["description"] = description;

  if (assignedName) {
    ctx.seen.delete(schema);
    // Keep the `$defs` entry only if something actually referenced it.
    if (JSON.stringify(body).includes(`#/$defs/${assignedName}`)) {
      ctx.defs[assignedName] = body;
      ctx.names.add(assignedName);
      return { $ref: `#/$defs/${assignedName}` };
    }
    ctx.names.delete(assignedName);
  }

  return body;
}

function buildBody(schema: ZodLike, kind: string, ctx: BuildContext, hint: string): JsonSchema {
  switch (kind) {
    case "string":
      return applyStringChecks(schema, { type: "string" });
    case "number":
      return applyNumberChecks(schema, { type: "number" });
    case "bigint":
      return { type: "integer" };
    case "boolean":
      return { type: "boolean" };
    case "date":
      return { type: "string", format: "date-time" };
    case "null":
      return { type: "null" };
    case "any":
    case "unknown":
      return {};
    case "never":
      return { not: {} as unknown as JsonValue };

    case "literal": {
      const values = literalValues(schema);
      if (values.length === 1) return { const: values[0] as JsonValue };
      return { enum: values as JsonValue[] };
    }

    case "enum":
      return { enum: enumValues(schema) as JsonValue[] };

    case "array": {
      const element = arrayElement(schema);
      const items = element ? build(element, ctx, `${hint}Item`) : {};
      return applyArrayChecks(schema, { type: "array", items: items as unknown as JsonValue });
    }

    case "tuple": {
      const { items, rest } = tupleItems(schema);
      const out: JsonSchema = {
        type: "array",
        prefixItems: items.map((item, i) => build(item, ctx, `${hint}_${i}`)) as unknown as JsonValue,
        minItems: items.length,
      };
      if (rest) out["items"] = build(rest, ctx, `${hint}Rest`) as unknown as JsonValue;
      else out["maxItems"] = items.length;
      return out;
    }

    case "object": {
      const shape = objectShape(schema);
      const properties: Record<string, JsonSchema> = {};
      const required: string[] = [];

      for (const [key, child] of Object.entries(shape)) {
        properties[key] = build(child, ctx, pascal(key));
        if (ctx.strict || !isOptionalLike(child)) required.push(key);
      }

      const out: JsonSchema = {
        type: "object",
        properties: properties as unknown as JsonValue,
        required: required as unknown as JsonValue,
      };
      if (ctx.strict || !objectAllowsUnknownKeys(schema)) out["additionalProperties"] = false;
      return out;
    }

    case "record": {
      const { value } = recordTypes(schema);
      return {
        type: "object",
        additionalProperties: (value ? build(value, ctx, `${hint}Value`) : {}) as unknown as JsonValue,
      };
    }

    case "union": {
      const options = unionOptions(schema);
      const discriminator = discriminatorOf(schema);
      const branches = options.map((option, i) => build(option, ctx, `${hint}_${i}`));
      const out: JsonSchema = { anyOf: branches as unknown as JsonValue };
      // Not part of JSON Schema, but servers that implement guided decoding use
      // it, and servers that do not simply ignore unknown keywords.
      if (discriminator) out["discriminator"] = { propertyName: discriminator } as unknown as JsonValue;
      return out;
    }

    case "intersection": {
      const def = (schema as { _def?: { left?: ZodLike; right?: ZodLike } })._def;
      const left = def?.left ? build(def.left, ctx, `${hint}Left`) : {};
      const right = def?.right ? build(def.right, ctx, `${hint}Right`) : {};
      return { allOf: [left, right] as unknown as JsonValue };
    }

    case "lazy": {
      const inner = lazyGetter(schema);
      return inner ? build(inner, ctx, hint) : {};
    }

    case "optional":
    case "nullable":
    case "readonly":
    case "catch":
    case "branded":
    case "pipe": {
      const inner = innerType(schema);
      const built = inner ? build(inner, ctx, hint) : {};
      if (kind === "nullable") {
        return { anyOf: [built, { type: "null" }] as unknown as JsonValue };
      }
      return built;
    }

    case "default": {
      const inner = innerType(schema);
      const built = inner ? build(inner, ctx, hint) : {};
      const value = defaultValue(schema);
      // `default` is advisory: some servers surface it to the decoder as a hint.
      return { ...built, default: value as JsonValue };
    }

    default:
      throw new RelaxUIError({
        code: "config_invalid",
        message:
          `Zod kind "${kind}" has no JSON Schema representation in this SDK. ` +
          `Supply an explicit JSON Schema via defineStructuredSchema({ jsonSchema }).`,
        details: { kind },
      });
  }
}

/** Optional / default / nullable-optional wrappers mean "may be absent". */
function isOptionalLike(schema: ZodLike): boolean {
  const kind = kindOf(schema);
  if (kind === "optional" || kind === "default" || kind === "catch") return true;
  if (kind === "readonly" || kind === "branded" || kind === "pipe" || kind === "nullable") {
    const inner = innerType(schema);
    return inner ? isOptionalLike(inner) : false;
  }
  return false;
}

function applyStringChecks(schema: ZodLike, base: JsonSchema): JsonSchema {
  const out: JsonObject = { ...base };
  for (const check of checksOf(schema)) {
    switch (check.kind) {
      case "min": if (typeof check.value === "number") out["minLength"] = check.value; break;
      case "max": if (typeof check.value === "number") out["maxLength"] = check.value; break;
      case "length": if (typeof check.value === "number") { out["minLength"] = check.value; out["maxLength"] = check.value; } break;
      case "regex": if (typeof check.value === "string") out["pattern"] = check.value; break;
      case "email": out["format"] = "email"; break;
      case "url": out["format"] = "uri"; break;
      case "uuid": out["format"] = "uuid"; break;
      case "datetime": out["format"] = "date-time"; break;
      default: break;
    }
  }
  return out;
}

function applyNumberChecks(schema: ZodLike, base: JsonSchema): JsonSchema {
  const out: JsonObject = { ...base };
  for (const check of checksOf(schema)) {
    switch (check.kind) {
      case "int": out["type"] = "integer"; break;
      case "min": if (typeof check.value === "number") out[check.inclusive === false ? "exclusiveMinimum" : "minimum"] = check.value; break;
      case "max": if (typeof check.value === "number") out[check.inclusive === false ? "exclusiveMaximum" : "maximum"] = check.value; break;
      case "multipleOf": if (typeof check.value === "number") out["multipleOf"] = check.value; break;
      default: break;
    }
  }
  return out;
}

function applyArrayChecks(schema: ZodLike, base: JsonSchema): JsonSchema {
  const out: JsonObject = { ...base };
  const { min, max } = arrayLength(schema);
  if (min !== undefined) out["minItems"] = min;
  if (max !== undefined) out["maxItems"] = max;
  return out;
}

function pascal(key: string): string {
  return key.replace(/(^|[_-])([a-z])/g, (_m, _s, c: string) => c.toUpperCase());
}
