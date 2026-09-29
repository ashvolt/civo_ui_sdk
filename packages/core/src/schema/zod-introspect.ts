/* eslint-disable @typescript-eslint/no-explicit-any */
/**
 * A thin normalisation layer over Zod's internals.
 *
 * Zod 3 and Zod 4 store their metadata in different places (`_def.typeName`
 * versus `_zod.def.type`) and expose several fields as a value in one major and
 * a function in the other. Consumers of this SDK should not have to care, and
 * nor should the rest of `packages/core`, so every reach into Zod's private
 * surface is confined to this file.
 *
 * If a future Zod moves the furniture again, this is the only file to fix.
 */

export type ZodKind =
  | "string" | "number" | "bigint" | "boolean" | "date" | "symbol"
  | "undefined" | "null" | "any" | "unknown" | "never" | "void"
  | "array" | "object" | "union" | "intersection" | "tuple" | "record"
  | "map" | "set" | "function" | "lazy" | "literal" | "enum" | "promise"
  | "optional" | "nullable" | "default" | "catch" | "pipe" | "readonly"
  | "branded" | "nan" | "unsupported";

const V3_TYPE_NAMES: Record<string, ZodKind> = {
  ZodString: "string", ZodNumber: "number", ZodBigInt: "bigint", ZodBoolean: "boolean",
  ZodDate: "date", ZodSymbol: "symbol", ZodUndefined: "undefined", ZodNull: "null",
  ZodAny: "any", ZodUnknown: "unknown", ZodNever: "never", ZodVoid: "void", ZodNaN: "nan",
  ZodArray: "array", ZodObject: "object", ZodUnion: "union",
  ZodDiscriminatedUnion: "union", ZodIntersection: "intersection", ZodTuple: "tuple",
  ZodRecord: "record", ZodMap: "map", ZodSet: "set", ZodFunction: "function",
  ZodLazy: "lazy", ZodLiteral: "literal", ZodEnum: "enum", ZodNativeEnum: "enum",
  ZodPromise: "promise", ZodOptional: "optional", ZodNullable: "nullable",
  ZodDefault: "default", ZodCatch: "catch", ZodEffects: "pipe", ZodPipeline: "pipe",
  ZodBranded: "branded", ZodReadonly: "readonly",
};

/** Anything with Zod's shape. Kept structural so we never import zod itself. */
export interface ZodLike {
  description?: string;
  safeParse?: (data: unknown) => unknown;
  _def?: any;
  _zod?: { def?: any };
}

export function isZodLike(value: unknown): value is ZodLike {
  if (typeof value !== "object" || value === null) return false;
  const v = value as ZodLike;
  return Boolean(v._def || v._zod?.def);
}

function rawDef(schema: ZodLike): any {
  return (schema as any)?._zod?.def ?? (schema as any)?._def;
}

/** True when the schema came from Zod 3 (its def carries a `typeName`). */
export function isV3(schema: ZodLike): boolean {
  return typeof rawDef(schema)?.typeName === "string";
}

export function kindOf(schema: ZodLike): ZodKind {
  const def = rawDef(schema);
  if (!def) return "unsupported";
  if (typeof def.typeName === "string") return V3_TYPE_NAMES[def.typeName] ?? "unsupported";
  if (typeof def.type === "string") {
    const t = def.type as ZodKind;
    // Zod 4 keeps discriminated unions under `union` already; normalise the rest.
    return t;
  }
  return "unsupported";
}

export function descriptionOf(schema: ZodLike): string | undefined {
  const direct = schema.description;
  if (typeof direct === "string" && direct.length > 0) return direct;
  const fromDef = rawDef(schema)?.description;
  return typeof fromDef === "string" && fromDef.length > 0 ? fromDef : undefined;
}

export function objectShape(schema: ZodLike): Record<string, ZodLike> {
  const def = rawDef(schema);
  const shape = typeof def?.shape === "function" ? def.shape() : def?.shape;
  return (shape ?? {}) as Record<string, ZodLike>;
}

/** `"strip" | "strict" | "passthrough"` in v3; v4 exposes a `catchall`. */
export function objectAllowsUnknownKeys(schema: ZodLike): boolean {
  const def = rawDef(schema);
  if (typeof def?.unknownKeys === "string") return def.unknownKeys === "passthrough";
  return def?.catchall !== undefined && kindOf(def.catchall as ZodLike) !== "never";
}

export function arrayElement(schema: ZodLike): ZodLike | undefined {
  const def = rawDef(schema);
  // v4 stores the element under `element`; v3 under `type` (which in v4 is the kind string).
  return (def?.element ?? (isV3(schema) ? def?.type : undefined)) as ZodLike | undefined;
}

/**
 * Array length bounds. Zod 3 keeps these on the array's own def rather than in
 * `checks` (where every other constraint lives); Zod 4 moved them into `checks`.
 */
export function arrayLength(schema: ZodLike): { min?: number; max?: number } {
  const def = rawDef(schema);
  const out: { min?: number; max?: number } = {};
  if (typeof def?.minLength?.value === "number") out.min = def.minLength.value;
  if (typeof def?.maxLength?.value === "number") out.max = def.maxLength.value;
  if (typeof def?.exactLength?.value === "number") {
    out.min = def.exactLength.value;
    out.max = def.exactLength.value;
  }
  for (const check of checksOf(schema)) {
    if (check.kind === "min" && typeof check.value === "number") out.min = check.value;
    if (check.kind === "max" && typeof check.value === "number") out.max = check.value;
  }
  return out;
}

export function unionOptions(schema: ZodLike): ZodLike[] {
  const def = rawDef(schema);
  const options = def?.options;
  if (Array.isArray(options)) return options as ZodLike[];
  // v4 discriminated unions may expose a Map keyed by discriminator value.
  if (options && typeof options.values === "function") return [...options.values()] as ZodLike[];
  return [];
}

export function discriminatorOf(schema: ZodLike): string | undefined {
  const def = rawDef(schema);
  return typeof def?.discriminator === "string" ? def.discriminator : undefined;
}

/** Literals are single-valued in v3 and a value *set* in v4. */
export function literalValues(schema: ZodLike): unknown[] {
  const def = rawDef(schema);
  if (Array.isArray(def?.values)) return def.values as unknown[];
  if ("value" in (def ?? {})) return [def.value];
  return [];
}

export function enumValues(schema: ZodLike): (string | number)[] {
  const def = rawDef(schema);
  if (Array.isArray(def?.values)) return def.values as (string | number)[];
  if (def?.values instanceof Set) return [...def.values] as (string | number)[];
  if (def?.entries && typeof def.entries === "object") return Object.values(def.entries) as (string | number)[];
  return [];
}

export function innerType(schema: ZodLike): ZodLike | undefined {
  const def = rawDef(schema);
  return (def?.innerType ?? def?.schema ?? def?.in ?? def?.out ?? def?.type) as ZodLike | undefined;
}

export function defaultValue(schema: ZodLike): unknown {
  const def = rawDef(schema);
  const dv = def?.defaultValue;
  return typeof dv === "function" ? dv() : dv;
}

export function recordTypes(schema: ZodLike): { key?: ZodLike; value?: ZodLike } {
  const def = rawDef(schema);
  return { key: def?.keyType as ZodLike | undefined, value: def?.valueType as ZodLike | undefined };
}

export function tupleItems(schema: ZodLike): { items: ZodLike[]; rest?: ZodLike } {
  const def = rawDef(schema);
  return {
    items: (def?.items ?? []) as ZodLike[],
    rest: (def?.rest ?? undefined) as ZodLike | undefined,
  };
}

export function lazyGetter(schema: ZodLike): ZodLike | undefined {
  const def = rawDef(schema);
  return typeof def?.getter === "function" ? (def.getter() as ZodLike) : undefined;
}

export interface NormalisedCheck {
  kind: string;
  value?: number | string;
  inclusive?: boolean;
}

/** Best-effort extraction of string/number constraints for JSON Schema output. */
export function checksOf(schema: ZodLike): NormalisedCheck[] {
  const def = rawDef(schema);
  const checks = def?.checks;
  if (!Array.isArray(checks)) return [];
  const out: NormalisedCheck[] = [];
  for (const check of checks) {
    if (check && typeof check.kind === "string") {
      // Zod 3 shape.
      out.push({ kind: check.kind, value: check.value ?? check.regex?.source, inclusive: check.inclusive });
      continue;
    }
    // Zod 4 shape: the check carries its own def.
    const cd = check?._zod?.def;
    if (cd && typeof cd.check === "string") {
      const kind =
        cd.check === "greater_than" ? (cd.inclusive ? "min" : "min") :
        cd.check === "less_than" ? "max" :
        cd.check === "min_length" ? "min" :
        cd.check === "max_length" ? "max" :
        cd.check === "string_format" ? String(cd.format ?? "format") :
        cd.check;
      out.push({ kind, value: cd.value ?? cd.minimum ?? cd.maximum ?? cd.pattern?.source, inclusive: cd.inclusive });
    }
  }
  return out;
}
