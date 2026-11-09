import { RelaxUIError, type UINode } from "relax-ui-protocol";
import type { z } from "zod";
import { buildUISchemas, DEFAULT_LIMITS, type ComponentSpec, type ComponentSpecMap, type UILimits } from "./schemas.js";

/**
 * A component contract: the vocabulary a model may assemble a document from,
 * with the semantic role each component's root must carry.
 *
 * The server hands `specs` and `limits` to `createUIRegistry` to derive the
 * JSON Schema it decodes the model against; the browser validates with
 * `documentSchema`. Both come from `buildUISchemas` over the same
 * declaration (FR-211).
 */
export interface Contract<M extends ComponentSpecMap = ComponentSpecMap> {
  readonly specs: M;
  readonly names: readonly (keyof M & string)[];
  readonly limits: Readonly<UILimits>;
  readonly nodeSchema: z.ZodType<UINode>;
  readonly documentSchema: z.ZodType<{ root: UINode }>;
  spec(type: string): ComponentSpec | undefined;
  /** The ARIA role a theme must give `type`'s root element. */
  role(type: string): string | undefined;
  /**
   * A new contract with components added or overridden (FR-212). Never removes
   * one: a theme may rely on any name already present (C2). Does not change
   * this contract.
   */
  extend<A extends ComponentSpecMap>(additions: A, limits?: Partial<UILimits>): Contract<Omit<M, keyof A> & A>;
}

const NAME = /^[A-Z][A-Za-z0-9]{0,31}$/;
const ROLE = /^[a-z]+$/;
const ACTION_KEY = /^on[A-Z]|^(action|formaction|handler|onclick|script)$/i;

/**
 * Builds a contract, refusing anything Principle IV or the data model forbids:
 * a malformed name (C1), a missing role (C5), an action prop (C4, FR-213).
 */
export function defineContract<M extends ComponentSpecMap>(specs: M, limits: Partial<UILimits> = {}): Contract<M> {
  for (const [name, spec] of Object.entries(specs)) {
    if (!NAME.test(name)) {
      refuse(`component name "${name}" must start with a capital letter and be at most 32 letters or digits`);
    }
    if (spec === undefined || spec === null || typeof spec !== "object") {
      refuse(`component "${name}" has no definition; a contract cannot remove a component`);
    }
    if (typeof spec.role !== "string" || !ROLE.test(spec.role)) {
      refuse(`component "${name}" must state the ARIA role its root takes (e.g. "list", "note")`);
    }
    assertNoActions(name, spec.props);
  }

  const resolved: UILimits = {
    maxNodes: limits.maxNodes ?? DEFAULT_LIMITS.maxNodes,
    maxDepth: limits.maxDepth ?? DEFAULT_LIMITS.maxDepth,
  };
  const frozen = Object.freeze({ ...specs }) as M;
  const { nodeSchema, documentSchema } = buildUISchemas(frozen, resolved);
  const names = Object.freeze(Object.keys(frozen)) as readonly (keyof M & string)[];

  return Object.freeze({
    specs: frozen,
    names,
    limits: Object.freeze(resolved),
    nodeSchema,
    documentSchema,
    spec: (type: string) => (Object.hasOwn(frozen, type) ? (frozen[type] as ComponentSpec) : undefined),
    role: (type: string) => (Object.hasOwn(frozen, type) ? (frozen[type] as ComponentSpec).role : undefined),
    extend<A extends ComponentSpecMap>(additions: A, next: Partial<UILimits> = {}) {
      for (const [name, spec] of Object.entries(additions)) {
        if (spec === undefined && Object.hasOwn(frozen, name)) {
          refuse(`"${name}" cannot be removed by extend(); override its schema instead`);
        }
      }
      return defineContract({ ...frozen, ...additions } as Omit<M, keyof A> & A, { ...resolved, ...next });
    },
  });
}

/**
 * Walks a props schema and refuses an action: a function-typed prop, or a key
 * that names an event handler. Iterative, through Zod's wrapper types.
 */
function assertNoActions(component: string, schema: unknown): void {
  const stack: { schema: unknown; path: string }[] = [{ schema, path: "props" }];
  const seen = new Set<unknown>();
  while (stack.length > 0) {
    const { schema: s, path } = stack.pop()!;
    if (!s || typeof s !== "object" || seen.has(s)) continue;
    seen.add(s);
    const def = (s as { _def?: Record<string, unknown> })._def;
    if (!def) continue;
    switch (def.typeName) {
      case "ZodFunction":
        refuse(`${component}.${path} is a function; a contract component may not execute an action`);
        break;
      case "ZodObject": {
        const shape = (def.shape as () => Record<string, unknown>)();
        for (const [key, value] of Object.entries(shape)) {
          if (ACTION_KEY.test(key)) {
            refuse(`${component}.${path}.${key} names an action; a contract component may not execute one`);
          }
          stack.push({ schema: value, path: `${path}.${key}` });
        }
        break;
      }
      case "ZodUnion":
      case "ZodDiscriminatedUnion":
        for (const option of (def.options as unknown[] | Map<unknown, unknown>).values()) {
          stack.push({ schema: option, path });
        }
        break;
      case "ZodTuple":
        for (const item of def.items as unknown[]) stack.push({ schema: item, path });
        break;
      case "ZodRecord":
      case "ZodMap":
        stack.push({ schema: def.valueType, path });
        break;
      case "ZodIntersection":
        stack.push({ schema: def.left, path }, { schema: def.right, path });
        break;
      default:
        // Wrappers: optional, nullable, default, effects, array, branded, ...
        for (const key of ["innerType", "schema", "type", "in", "out"]) {
          if (def[key]) stack.push({ schema: def[key], path });
        }
    }
  }
}

function refuse(message: string): never {
  throw new RelaxUIError({ code: "config_invalid", message: `Invalid contract: ${message}.` });
}
