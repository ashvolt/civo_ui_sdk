import type { Browser } from "@playwright/test";
import { breakPoint, summarise, type Sample } from "../budgets.ts";
import type { ColdStartEntry, LadderEntry } from "../results.ts";
import { framesFor, warmupDocument, type Dimension, type Document } from "../workloads/generator.ts";
import { planStep, type Ladder } from "../workloads/ladders.ts";
import type { Encoded } from "./contenders.ts";
import { oursSSE } from "./encode.ts";
import type { BenchServer } from "./server.ts";
import { runOnce, type ProfileId } from "./step.ts";

/**
 * Climbs one ladder for one renderer on one profile: each step a warm-up and
 * `reps` measured runs in fresh pages, summarised against the budgets, until
 * the first broken step (FR-412, R6).
 */

export interface LadderOptions {
  renderer: string;
  page: string;
  profile: ProfileId;
  reps: number;
  /** Only the first N steps. */
  maxSteps?: number;
  /** Only these steps, in order (the pull-request smoke run); a step not on the ladder is an error. */
  sizes?: readonly number[];
  /** Extra CPU throttling on every run (the regression check's deliberate slowdown). */
  slowdown?: number;
  /** The renderer's wire format. Default: this SDK's SSE. */
  encode?: (frames: readonly Document[], dimension: Dimension) => Encoded;
  log?: (line: string) => void;
}

/**
 * Cold start: the twelve-component document in a fresh page with nothing
 * loaded yet. What a user pays once per page; reported beside the ladders,
 * not mixed into them.
 */
export async function coldStart(browser: Browser, server: BenchServer, opts: Omit<LadderOptions, "maxSteps">): Promise<ColdStartEntry> {
  const doc = warmupDocument();
  const dataUrl = server.put(`cold-start-${opts.renderer}`, { chunks: chunksOf(encoderOf(opts)([doc], "static-nodes")), final: doc, rateMs: 50 });
  const samples: Sample[] = [];
  for (let i = 0; i < opts.reps; i++) samples.push(await runOnce(browser, server, { page: opts.page, dataUrl, profile: opts.profile }));
  const summary = summarise(samples);
  const m = summary.metrics;
  opts.log?.(`${opts.renderer} ${opts.profile} cold start: first node ${Math.round(m.firstNode!.median)}ms, longest task ${m.longestTask!.median}ms${summary.broken ? `  (${summary.broken})` : ""}`);
  return { renderer: opts.renderer, profile: opts.profile, metrics: summary.metrics, ...(summary.broken ? { broken: summary.broken } : {}) };
}

const ours = (frames: readonly Document[]): Encoded => ({ chunks: oursSSE(frames) });
const encoderOf = (opts: Pick<LadderOptions, "encode">) => opts.encode ?? ours;

function chunksOf(e: Encoded): string[] {
  if ("notExpressible" in e) throw new Error(e.notExpressible);
  return e.chunks;
}

export async function climb(browser: Browser, server: BenchServer, ladder: Ladder, opts: LadderOptions): Promise<LadderEntry> {
  const steps: LadderEntry["steps"] = [];
  const encode = encoderOf(opts);
  const warmup = chunksOf(encode([warmupDocument()], "static-nodes"));
  const sizes = opts.sizes ?? ladder.steps.slice(0, opts.maxSteps ?? ladder.steps.length);
  for (const size of sizes) {
    if (!ladder.steps.includes(size)) throw new Error(`${ladder.id}: ${size} is not a step of the ladder`);
    const step = planStep(ladder, size);
    const frames = framesFor(step);
    const encoded = encode(frames, ladder.id);
    // A format that cannot write this workload is reported, not timed (T-436).
    if ("notExpressible" in encoded) {
      opts.log?.(`${opts.renderer} ${opts.profile} ${ladder.id}: not expressible (${encoded.notExpressible})`);
      return { renderer: opts.renderer, profile: opts.profile, workload: ladder.id, expressible: false, reason: encoded.notExpressible, steps: [], breakPoint: "not-expressible" };
    }
    const dataUrl = server.put(`${opts.renderer}-${ladder.id}-${size}`, {
      chunks: encoded.chunks,
      final: frames.at(-1),
      rateMs: 1000 / step.rate,
      warmup,
    });
    const run = () => runOnce(browser, server, { page: opts.page, dataUrl, profile: opts.profile, ...(opts.slowdown ? { slowdown: opts.slowdown } : {}) });
    await run(); // warm-up: browser caches, JIT
    const samples: Sample[] = [];
    for (let i = 0; i < opts.reps; i++) {
      const s = await run();
      samples.push(s);
      // A step that times out or errors once will not recover by repeating.
      if (s.timedOut || s.error || s.crashed) break;
    }
    const summary = summarise(samples);
    const detail = samples.find((s) => s.detail || s.error)?.detail ?? samples.find((s) => s.error)?.error;
    steps.push({
      size,
      metrics: summary.metrics,
      samples: samples.map(({ frames: f, longFrames, ...rest }) => ({ ...rest, frames: f.length, longFrames })),
      ...(summary.broken ? { broken: summary.broken } : {}),
      ...(summary.broken && detail ? { detail } : {}),
    });
    const m = summary.metrics;
    opts.log?.(
      `${opts.renderer} ${opts.profile} ${ladder.id} ${size}: p95 ${m.frameP95!.median}ms, longest ${m.longestTask!.median}ms, interaction ${m.interaction!.median}ms, complete ${Math.round(m.complete!.median)}ms, busy ${m.busy!.median}ms${summary.broken ? `  BROKEN (${summary.broken})` : ""}`,
    );
    if (summary.broken) break;
  }
  return {
    renderer: opts.renderer,
    profile: opts.profile,
    workload: ladder.id,
    expressible: true,
    steps,
    ...breakPoint(steps),
  };
}
