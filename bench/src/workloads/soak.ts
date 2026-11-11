import { framesFor, type Document } from "./generator.ts";
import { LADDERS, planStep } from "./ladders.ts";

/**
 * The soak's documents (FR-415, spec scenario 6): a cycle that keeps
 * replacing documents and patching them as they stream. Document 0 is where
 * every sample is taken, so it is a mixed document holding Cards and Metrics
 * (the types a framework connector mounts). The others churn text, grow a
 * table, change counters every frame and grow a heatmap.
 */
export function soakDocuments(): Document[][] {
  const step = (id: string, size: number, frames: number) => ({ ...planStep(LADDERS.find((l) => l.id === id)!, size), frames });
  return [
    framesFor(step("nodes", 250, 10)),
    framesFor(step("text-churn", 50, 20)),
    framesFor(step("table-cells", 1_000, 10)),
    framesFor(step("counters", 50, 20)),
    framesFor(step("heatmap-cells", 1_000, 10)),
  ];
}

/** Frames per second while soaking. */
export const SOAK_RATE = 20;
