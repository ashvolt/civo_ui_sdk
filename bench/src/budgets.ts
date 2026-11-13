import { iqr, median, percentile } from "./stats.ts";

/**
 * Budgets, mirrored from specs/004-stress-security-benchmark/contracts/budgets.md
 * (budget version 1). Fixed before any result existed (Constitution VII).
 */
export const BUDGET_VERSION = 2;

export const BUDGETS = {
  /**
   * Frame interval at the 95th percentile while streaming. A frame is late when
   * its interval exceeds 1.5 refresh intervals at 60 Hz: 25 ms. (Budget v1 said
   * 16.7 ms, which an idle page fails: intervals jitter around the 16.67 ms
   * refresh, idle p95 measured 16.8 ms. See contracts/budgets.md, v2.)
   */
  frameP95: 25,
  /** The longest long-animation-frame. */
  longestTask: 50,
  /** The scripted interaction's event duration. */
  interaction: 200,
  timeoutMs: { desktop: 60_000, phone: 180_000 },
} as const;

export const TOLERANCE = { relative: 0.2, absoluteMs: 2, memoryRelative: 0.1 } as const;

/** What the page reports for one run. */
export interface Sample {
  /** requestAnimationFrame deltas while streaming, ms. */
  frames: number[];
  /** long-animation-frame durations, ms. */
  longFrames: number[];
  /** Longest event duration of the scripted interaction, ms; 0 if under 16 ms. */
  interaction: number;
  firstNode: number;
  complete: number;
  correct: boolean;
  /** Main-thread task time while the run streamed, ms (Chromium's TaskDuration). */
  busy?: number;
  /** Filled in by the runner. */
  heap?: number;
  domNodes?: number;
  listeners?: number;
  timedOut?: boolean;
  /** The browser tab crashed (for example past Chromium's nesting limit). */
  crashed?: boolean;
  error?: string;
  /** Where the output first differed from the reference, when it did. */
  detail?: string;
}

export interface StepSummary {
  metrics: Record<string, { median: number; iqr: number }>;
  /** The budget the step broke, if any. */
  broken?: "frameP95" | "longestTask" | "interaction" | "correctness" | "timeout" | "crash" | "error";
}

/** Summarises the repetitions of one step and decides whether it broke (FR-411). */
export function summarise(samples: readonly Sample[]): StepSummary {
  const per = (f: (s: Sample) => number) => {
    const xs = samples.map(f);
    return { median: round(median(xs)), iqr: round(iqr(xs)) };
  };
  const metrics: StepSummary["metrics"] = {
    frameP50: per((s) => percentile(s.frames, 50)),
    frameP95: per((s) => percentile(s.frames, 95)),
    frameP99: per((s) => percentile(s.frames, 99)),
    longestTask: per((s) => Math.max(0, ...s.longFrames)),
    longTasks: per((s) => s.longFrames.filter((d) => d > BUDGETS.longestTask).length),
    interaction: per((s) => s.interaction),
    firstNode: per((s) => s.firstNode),
    complete: per((s) => s.complete),
    busy: per((s) => s.busy ?? 0),
    heap: per((s) => s.heap ?? 0),
    domNodes: per((s) => s.domNodes ?? 0),
  };
  let broken: StepSummary["broken"];
  if (samples.some((s) => s.crashed)) broken = "crash";
  else if (samples.some((s) => s.error)) broken = "error";
  else if (samples.some((s) => s.timedOut)) broken = "timeout";
  else if (samples.some((s) => !s.correct)) broken = "correctness";
  else if (metrics.longestTask!.median > BUDGETS.longestTask) broken = "longestTask";
  else if (metrics.frameP95!.median > BUDGETS.frameP95) broken = "frameP95";
  else if (metrics.interaction!.median > BUDGETS.interaction) broken = "interaction";
  return broken ? { metrics, broken } : { metrics };
}

/** The ladder's break point: the last passing step (FR-412). */
export function breakPoint(steps: readonly { size: number; broken?: string }[]): {
  breakPoint: number | "below-first-step" | "not-reached";
  brokenBy?: string;
} {
  const first = steps.findIndex((s) => s.broken);
  if (first === -1) return { breakPoint: "not-reached" };
  if (first === 0) return { breakPoint: "below-first-step", brokenBy: steps[0]!.broken! };
  return { breakPoint: steps[first - 1]!.size, brokenBy: steps[first]!.broken! };
}

/** Pull-request regression check against the stored `main` result (FR-440). */
export function regressed(now: number, before: number, memory = false): boolean {
  if (memory) return now > before * (1 + TOLERANCE.memoryRelative);
  return now - before > Math.max(before * TOLERANCE.relative, TOLERANCE.absoluteMs);
}

const round = (n: number) => Math.round(n * 100) / 100;
