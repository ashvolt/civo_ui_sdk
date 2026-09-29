import { z } from "zod";
import { RelaxUIError } from "../errors.js";
import { sanitizeUrl, type UrlPolicy } from "../guard/url.js";
import { defineStructuredSchema, type StructuredSchema } from "../schema/define.js";

/**
 * The Generative UI contract.
 *
 * A model does not return components; it returns a *description* of components,
 * drawn from a vocabulary the application declared up front. That inversion is
 * what makes model-authored UI safe to render: there is no path from a
 * generation to an element the application did not already ship, because the
 * union of legal `type` values is closed at schema-construction time and the
 * model is decoded against it.
 *
 * It is also what makes it ergonomic. Register the components once and the
 * JSON Schema sent to relaxAI, the runtime validator, and the renderer's lookup
 * table are all derived from the same declaration — no second source of truth
 * to drift.
 */

export interface UINode {
  type: string;
  props: Record<string, unknown>;
  children?: UINode[];
  /** Stable identity for reconciliation across streaming frames. */
  key?: string;
}

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
}

export type ComponentSpecMap = Record<string, ComponentSpec>;

export interface UIRegistryOptions {
  /** Ceiling on total nodes in one document. Default 500. */
  maxNodes?: number;
  /** Ceiling on tree depth. Default 24. */
  maxDepth?: number;
  /** Policy applied by {@link urlString}. */
  urlPolicy?: UrlPolicy;
}

export interface UIRegistry<M extends ComponentSpecMap> {
  readonly specs: M;
  readonly names: (keyof M & string)[];
  /** Recursive Zod schema for a single node. */
  readonly nodeSchema: z.ZodType<UINode>;
  /** Wrapper document: `{ root: UINode }`. What generation actually targets. */
  readonly documentSchema: z.ZodType<{ root: UINode }>;
  readonly limits: Required<Pick<UIRegistryOptions, "maxNodes" | "maxDepth">>;
  /** Ready to hand to `generateObject` / `streamObject`. */
  structuredSchema(name?: string, description?: string): StructuredSchema<{ root: UINode }>;
  spec(type: string): ComponentSpec | undefined;
}

/**
 * A string prop that is safe to put in an `href` or `src`.
 *
 * `z.string().url()` checks syntax; it happily accepts `javascript:alert(1)`,
 * which is a valid URL and an XSS. This refines *and* normalises through the
 * SDK's URL guard, so a rejected scheme fails schema validation rather than
 * reaching the DOM.
 */
export function urlString(policy: UrlPolicy = {}): z.ZodType<string> {
  return z
    .string()
    .describe("An absolute https URL, a site-relative path, or a mailto: link.")
    .superRefine((value, ctx) => {
      if (sanitizeUrl(value, policy) === null) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          message: "URL scheme or host is not permitted by the generative-UI URL policy.",
        });
      }
    })
    .transform((value) => sanitizeUrl(value, policy) as string);
}

/** Plain display text: no control characters, bounded length. */
export function displayText(maxLength = 2_000): z.ZodType<string> {
  return z
    .string()
    .max(maxLength)
    // eslint-disable-next-line no-control-regex
    .regex(/^[^\u0000-\u0008\u000b\u000c\u000e-\u001f]*$/, "Control characters are not allowed.");
}

const KEY_SCHEMA = z.string().min(1).max(64).optional();

export function createUIRegistry<M extends ComponentSpecMap>(
  specs: M,
  options: UIRegistryOptions = {},
): UIRegistry<M> {
  const names = Object.keys(specs) as (keyof M & string)[];
  if (names.length === 0) {
    throw new RelaxUIError({
      code: "config_invalid",
      message: "A UI registry needs at least one component.",
    });
  }

  const limits = {
    maxNodes: options.maxNodes ?? 500,
    maxDepth: options.maxDepth ?? 24,
  };

  // `z.lazy` keeps the reference stable, which is what lets the JSON Schema
  // emitter recognise the cycle and emit a `$ref` instead of recursing forever.
  const nodeSchema: z.ZodType<UINode> = z.lazy(() => {
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
  });

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

  return {
    specs,
    names,
    nodeSchema,
    documentSchema,
    limits,
    spec: (type: string) => specs[type] as ComponentSpec | undefined,
    structuredSchema(name = "GenerativeUIDocument", description?: string) {
      return defineStructuredSchema<{ root: UINode }>({
        name,
        description:
          description ??
          `A UI document built only from these components: ${names.join(", ")}. ` +
            `Every node must declare a "type" from that list and "props" matching that component.`,
        schema: documentSchema,
      });
    },
  };
}

export interface TreeBudget {
  nodes: number;
  depth: number;
}

/**
 * Counts nodes and depth, iteratively.
 *
 * Recursion here would mean a model could crash the server with a deeply nested
 * document before the depth limit was ever checked — the stack overflow happens
 * during measurement. An explicit stack makes the guard actually a guard.
 */
export function measureTree(root: UINode | undefined): TreeBudget {
  if (!root) return { nodes: 0, depth: 0 };
  let nodes = 0;
  let depth = 0;
  const stack: { node: UINode; level: number }[] = [{ node: root, level: 1 }];

  while (stack.length > 0) {
    const entry = stack.pop() as { node: UINode; level: number };
    nodes++;
    if (entry.level > depth) depth = entry.level;
    // Hard stop: a pathological document must not be walked to completion.
    if (nodes > 100_000) break;
    const children = entry.node.children;
    if (Array.isArray(children)) {
      for (const child of children) {
        if (child && typeof child === "object") stack.push({ node: child, level: entry.level + 1 });
      }
    }
  }

  return { nodes, depth };
}
