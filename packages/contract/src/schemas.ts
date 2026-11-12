import { measureTree, RelaxUIError, type UINode } from "relax-ui-protocol";
import { z } from "zod";

/**
 * Turning a component vocabulary into the schemas that check a document.
 *
 * Moved here from `relax-ui-core`'s `createUIRegistry`, which now calls this.
 * One function builds the schema the server derives its JSON Schema from and
 * the schema the browser validates against, so the two cannot drift
 * (Principle II, FR-211).
 */

export type ChildrenPolicy = "none" | "optional" | "required";

export interface ComponentSpec<TProps extends Record<string, unknown> = Record<string, unknown>> {
  /** Shown to the model. The single biggest lever on output quality. */
  description?: string;
  /**
   * `unknown` as the *input* type is what lets a concrete `z.object({...})` be
   * stored in a heterogeneous registry without widening its output type to
   * `any`: the map stays assignable, and `safeParse` still returns the precise
   * props type at the point of use.
   */
  props: z.ZodType<TProps, z.ZodTypeDef, unknown>;
  /** Default `"none"`: leaf unless the application says otherwise. */
  children?: ChildrenPolicy;
  /**
   * The ARIA role a theme must give the component's root element (FR-214).
   * Required by `defineContract`; optional for a plain `createUIRegistry`.
   */
  role?: string;
}

export type ComponentSpecMap = Record<string, ComponentSpec>;

export interface UILimits {
  /** Ceiling on total nodes in one document. */
  maxNodes: number;
  /** Ceiling on tree depth. */
  maxDepth: number;
}

/** Feature 001's defaults. */
export const DEFAULT_LIMITS: Readonly<UILimits> = Object.freeze({ maxNodes: 500, maxDepth: 24 });

export interface UISchemas {
  /** Recursive schema for a single node. */
  nodeSchema: z.ZodType<UINode>;
  /** Wrapper document: `{ root: UINode }`, with the node and depth budget. */
  documentSchema: z.ZodType<{ root: UINode }>;
}

const KEY_SCHEMA = z.string().min(1).max(64).optional();

export function buildUISchemas(specs: ComponentSpecMap, limits: UILimits): UISchemas {
  const names = Object.keys(specs);
  if (names.length === 0) {
    throw new RelaxUIError({
      code: "config_invalid",
      message: "A UI registry needs at least one component.",
    });
  }

  // `z.lazy` keeps the reference stable, which is what lets the JSON Schema
  // emitter recognise the cycle and emit a `$ref` instead of recursing forever.
  // Zod calls the getter on every parse of every node, so the union is built
  // once and kept: rebuilt per call, validating a document constructed every
  // component's schema once per node (found by the benchmark, spec 004).
  let union: z.ZodType<UINode> | undefined;
  const nodeSchema: z.ZodType<UINode> = z.lazy(() => (union ??= buildUnion()));
  const buildUnion = (): z.ZodType<UINode> => {
    const variants = names.map((name) => {
      const spec = specs[name] as ComponentSpec;
      const policy: ChildrenPolicy = spec.children ?? "none";

      const base = {
        type: z.literal(name),
        key: KEY_SCHEMA,
        props: spec.props,
      };

      const shape =
        policy === "none"
          ? base
          : policy === "required"
            ? { ...base, children: z.array(nodeSchema).min(1) }
            : { ...base, children: z.array(nodeSchema).optional() };

      return z
        .object(shape)
        .strict()
        .describe(spec.description ?? `The ${name} component.`) as unknown as z.ZodObject<{
        type: z.ZodLiteral<string>;
      }>;
    });

    if (variants.length === 1) return variants[0] as unknown as z.ZodType<UINode>;
    return z.discriminatedUnion(
      "type",
      variants as unknown as [z.ZodObject<{ type: z.ZodLiteral<string> }>, ...z.ZodObject<{ type: z.ZodLiteral<string> }>[]],
    ) as unknown as z.ZodType<UINode>;
  };

  const documentSchema = z
    .object({ root: nodeSchema })
    .strict()
    .superRefine((doc, ctx) => {
      const budget = measureTree(doc.root);
      if (budget.nodes > limits.maxNodes) {
        ctx.addIssue({
          code: z.ZodIssueCode.too_big,
          maximum: limits.maxNodes,
          type: "array",
          inclusive: true,
          message: `UI document has ${budget.nodes} nodes; the limit is ${limits.maxNodes}.`,
        });
      }
      if (budget.depth > limits.maxDepth) {
        ctx.addIssue({
          code: z.ZodIssueCode.too_big,
          maximum: limits.maxDepth,
          type: "number",
          inclusive: true,
          message: `UI document is ${budget.depth} levels deep; the limit is ${limits.maxDepth}.`,
        });
      }
    }) as unknown as z.ZodType<{ root: UINode }>;

  return { nodeSchema, documentSchema };
}
