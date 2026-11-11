import { median } from "./stats.ts";

/**
 * What breaks a soak (FR-415, contracts/budgets.md "What breaks the soak").
 *
 * Every sample is taken at the same point (the same document complete on the
 * page, after a forced garbage collection), so a steady page samples the same
 * DOM node and listener counts every time, and its heap only wanders.
 */

export interface SoakSample {
  /** Minutes since the soak started. */
  minute: number;
  heap: number;
  domNodes: number;
  listeners: number;
  /** Framework components mounted, for a renderer that mounts them. */
  mounted?: number;
  /** How many the document on the page should have mounted. */
  expectedMounted?: number;
}

export const SOAK_BUDGET = {
  /** Heap after GC, the median of the last window over the first. */
  heapGrowth: 0.1,
  /** Samples per window: the first and last five minutes at one per minute. */
  window: 5,
} as const;

export type SoakBreak = "heap" | "domNodes" | "listeners" | "detached" | "mounted";

export interface SoakVerdict {
  passed: boolean;
  broken: SoakBreak[];
  heapGrowth: number;
  domNodeGrowth: number;
  listenerGrowth: number;
  detachedGrowth: number;
}

export function judgeSoak(series: readonly SoakSample[], detachedStart: number, detachedEnd: number): SoakVerdict {
  if (series.length < 3) throw new Error("a soak needs at least three samples");
  // A short run (the self-test) has fewer than ten samples: a third each.
  const w = Math.max(1, Math.min(SOAK_BUDGET.window, Math.floor(series.length / 3)));
  const first = median(series.slice(0, w).map((s) => s.heap));
  const last = median(series.slice(-w).map((s) => s.heap));
  const heapGrowth = last / first - 1;
  // The first steady sample: sample 0 can still hold first-use allocations.
  const steady = series[1]!;
  const end = series.at(-1)!;
  const domNodeGrowth = end.domNodes - steady.domNodes;
  const listenerGrowth = end.listeners - steady.listeners;
  const detachedGrowth = detachedEnd - detachedStart;

  const broken: SoakBreak[] = [];
  if (heapGrowth > SOAK_BUDGET.heapGrowth) broken.push("heap");
  if (domNodeGrowth > 0) broken.push("domNodes");
  if (listenerGrowth > 0) broken.push("listeners");
  if (detachedGrowth > 0) broken.push("detached");
  if (series.some((s) => s.mounted !== undefined && s.expectedMounted !== undefined && s.mounted !== s.expectedMounted)) {
    broken.push("mounted");
  }
  return { passed: broken.length === 0, broken, heapGrowth, domNodeGrowth, listenerGrowth, detachedGrowth };
}

/**
 * Detached DOM nodes in a V8 heap snapshot (research R2: taken at the start
 * and the end of the soak only).
 *
 * Current Chromium marks each node with a `detachedness` field (0 unknown,
 * 1 attached, 2 detached); DevTools draws the "Detached" label from it. Older
 * snapshots have no such field and put "Detached " in the node's name.
 */
export const DETACHED = 2;

export function countDetached(snapshot: {
  snapshot: { meta: { node_fields: string[] } };
  nodes: number[];
  strings: string[];
}): number {
  const fields = snapshot.snapshot.meta.node_fields;
  const stride = fields.length;
  const name = fields.indexOf("name");
  const detachedness = fields.indexOf("detachedness");
  let n = 0;
  for (let i = 0; i < snapshot.nodes.length; i += stride) {
    if (detachedness >= 0 ? snapshot.nodes[i + detachedness] === DETACHED : snapshot.strings[snapshot.nodes[i + name]!]?.startsWith("Detached ")) n++;
  }
  return n;
}
