import type { Dimension, StepPlan } from "./generator.ts";

/**
 * One ladder per dimension (research R4). Steps strictly increase (W1). Above
 * the standard contract's 500 nodes or depth 24, a step needs the bench
 * contract (W2); `contractFor` says which.
 */
export interface Ladder {
  id: Dimension;
  steps: number[];
  frames: number;
  /** Frames per second, unless the dimension is the rate itself. */
  rate: number;
  seed: number;
}

// First steps are small enough that a throttled phone profile has a step to
// pass: the phone's ceiling is the number this benchmark exists to find.
export const LADDERS: readonly Ladder[] = [
  { id: "nodes", steps: [10, 25, 50, 100, 250, 500, 1_000, 2_500, 5_000, 10_000], frames: 20, rate: 20, seed: 4011 },
  // The whole document in one frame: a static JSON source.
  { id: "static-nodes", steps: [10, 25, 50, 100, 250, 500, 1_000, 2_500, 5_000, 10_000], frames: 1, rate: 20, seed: 4018 },
  { id: "depth", steps: [2, 4, 8, 16, 24, 48, 96, 128, 160, 192], frames: 20, rate: 20, seed: 4012 },
  { id: "table-cells", steps: [20, 100, 1_000, 5_000, 10_000, 25_000, 50_000, 100_000], frames: 20, rate: 20, seed: 4013 },
  { id: "chart-points", steps: [8, 50, 250, 1_000, 2_500, 5_000, 10_000, 20_000], frames: 20, rate: 20, seed: 4014 },
  { id: "frame-rate", steps: [5, 10, 25, 50, 100], frames: 40, rate: 0, seed: 4015 },
  { id: "text-churn", steps: [1, 10, 50, 100], frames: 40, rate: 25, seed: 4016 },
  { id: "tone-density", steps: [0, 25, 50, 100], frames: 20, rate: 20, seed: 4017 },
];

export function planStep(ladder: Ladder, size: number): StepPlan {
  return {
    dimension: ladder.id,
    size,
    seed: ladder.seed,
    frames: ladder.frames,
    rate: ladder.id === "frame-rate" ? size : ladder.rate,
  };
}

export function contractFor(nodes: number, depth: number): "standard" | "bench" {
  return nodes > 500 || depth > 24 ? "bench" : "standard";
}
