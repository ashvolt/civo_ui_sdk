import type { SchemaDialect } from "../provider/profile.js";
import type { JsonSchema, JsonValue } from "../types.js";

/**
 * Derives the schema actually sent to an endpoint's constrained decoder.
 *
 * The application's schema stays the single source of truth and the only
 * validator. This produces a *projection* of its JSON Schema with the keywords
 * a particular server cannot compile left out, because the alternative —
 * sending them — is a server that answers 200 and enforces nothing.
 *
 * It is structure-aware on purpose. `pattern` is a keyword in a schema object
 * and an ordinary property name inside `properties`; a naive key filter would
 * delete an application's `pattern` field from its own document shape.
 */

/** Keywords whose value is a map from *names* to schemas, not a schema. */
const NAME_MAPS = new Set(["properties", "patternProperties", "$defs", "definitions", "dependentSchemas"]);

/** Keywords whose value is data to be copied verbatim, never descended into. */
const DATA_KEYWORDS = new Set(["const", "enum", "default", "examples", "required"]);

export interface AdaptedSchema {
  schema: JsonSchema;
  /** Keywords that were present and removed, deduplicated and sorted. */
  dropped: string[];
}

/**
 * Returns `schema` without the keywords `dialect` cannot honour.
 *
 * The input is never mutated, and when nothing needs removing the very same
 * object is returned so callers can cheaply tell that no adaptation happened.
 */
export function adaptJsonSchema(schema: JsonSchema, dialect?: SchemaDialect): AdaptedSchema {
  const unsupported = new Set(dialect?.unsupportedKeywords ?? []);
  if (unsupported.size === 0) return { schema, dropped: [] };

  const dropped = new Set<string>();
  const adapted = adaptSchemaNode(schema, unsupported, dropped) as JsonSchema;
  if (dropped.size === 0) return { schema, dropped: [] };
  return { schema: adapted, dropped: [...dropped].sort() };
}

function adaptSchemaNode(node: JsonValue, unsupported: Set<string>, dropped: Set<string>): JsonValue {
  // `items: [a, b]`, `anyOf: [...]` and friends: each element is a schema.
  if (Array.isArray(node)) return node.map((entry) => adaptSchemaNode(entry, unsupported, dropped));
  // Boolean schemas (`additionalProperties: false`) and stray scalars.
  if (node === null || typeof node !== "object") return node;

  const out: { [key: string]: JsonValue } = {};
  for (const [keyword, value] of Object.entries(node)) {
    if (unsupported.has(keyword)) {
      dropped.add(keyword);
      continue;
    }
    if (DATA_KEYWORDS.has(keyword)) {
      out[keyword] = value;
    } else if (NAME_MAPS.has(keyword) && value !== null && typeof value === "object" && !Array.isArray(value)) {
      const map: { [key: string]: JsonValue } = {};
      for (const [name, child] of Object.entries(value)) {
        map[name] = adaptSchemaNode(child, unsupported, dropped);
      }
      out[keyword] = map;
    } else {
      out[keyword] = adaptSchemaNode(value, unsupported, dropped);
    }
  }
  return out;
}
