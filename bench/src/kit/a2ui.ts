import { CommonSchemas } from "@a2ui/web_core/v0_9";
import { z } from "zod3";
import { propOrder } from "../runner/contenders.ts";
import { benchContract } from "../workloads/contract.ts";

/**
 * The kit as an A2UI catalog's component APIs (T-432), shared by the Lit,
 * React and Angular implementations. Every prop is optional and of any type,
 * as on the other contenders' pages: the kit's props are not declared again
 * for each contender. Children are a child list, the property A2UI resolves
 * to child components.
 */
export const kitApis = benchContract.names.map((name) => ({
  name,
  schema: z.object(
    Object.fromEntries(propOrder(name).map((p) => [p, p === "children" ? CommonSchemas.ChildList.optional() : z.any().optional()])),
  ),
}));

/** A component's props as the kit takes them: no setters, no children, no nulls. */
export function kitProps(props: Record<string, unknown> | undefined): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(props ?? {})) {
    if (k === "children" || v === null || v === undefined || typeof v === "function") continue;
    out[k] = v;
  }
  return out;
}
