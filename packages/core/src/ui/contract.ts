import {
  buildUISchemas,
  type ChildrenPolicy,
  type ComponentSpec,
  type ComponentSpecMap,
} from "relax-ui-contract";
import type { UINode } from "relax-ui-protocol";
import type { z } from "zod";
import type { UrlPolicy } from "../guard/url.js";
import { defineStructuredSchema, type StructuredSchema } from "../schema/define.js";

// The document shape, the field helpers and the schema builder moved to
// `relax-ui-protocol` and `relax-ui-contract` in feature 003, so the browser
// validates with the same code the server derives its JSON Schema from.
// Re-exported so every existing import keeps working.
export { measureTree } from "relax-ui-protocol";
export type { TreeBudget, UINode } from "relax-ui-protocol";
export { displayText, urlString } from "relax-ui-contract";
export type { ChildrenPolicy, ComponentSpec, ComponentSpecMap };

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

export function createUIRegistry<M extends ComponentSpecMap>(
  specs: M,
  options: UIRegistryOptions = {},
): UIRegistry<M> {
  const names = Object.keys(specs) as (keyof M & string)[];
  const limits = {
    maxNodes: options.maxNodes ?? 500,
    maxDepth: options.maxDepth ?? 24,
  };
  const { nodeSchema, documentSchema } = buildUISchemas(specs, limits);

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
