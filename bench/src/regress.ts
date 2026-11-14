import { TOLERANCE } from "./budgets.ts";
import type { ResultFile } from "./results.ts";

/**
 * The pull-request regression check (T-450, FR-440, contracts/budgets.md):
 * this SDK's element on the desktop profile, each ladder at its first step
 * and at one step where the renderer's own work dominates, compared with the
 * last `main` result.
 *
 * Frame intervals and completion times on these steps follow the delivery
 * schedule, not the renderer, so the check reads main-thread busy time
 * (Chromium's TaskDuration around each run). One number decides: the median,
 * over the steps, of each step's median now against `main`'s, which must not
 * exceed the tolerance (20%). A slower renderer moves every step; noise moves
 * a few, or the whole run a little, and the median of the ratios absorbs
 * both. The total is reported beside it. A step that breaks a budget now and
 * did not on `main` fails the check as well.
 *
 * Measured on one laptop (research R6): over ten quiet runs against one
 * baseline, the median ratio stayed within 0.96–1.14 (the total within
 * 0.94–1.21, one run over 20%); a 1.5× CPU throttle gave 2.02.
 *
 * A fixed CPU job's time (`calibrate`) is recorded and reported, not used to
 * scale: beside those runs it varied 0.5–2.4× with no relation to the busy
 * time.
 */

/**
 * First step, then one where the renderer's work dominates. The second is
 * at least one ladder step below the element's desktop break point
 * (`results/compare-2026-11-11.json`), mostly two: a step at the break
 * point flips between runs (chart points at 1,000 measured a 51.9 ms longest
 * task on a run, against the 50 ms budget), and would fail pull requests at
 * random.
 */
export const SMOKE_SIZES: Readonly<Record<string, readonly number[]>> = {
  nodes: [10, 1_000],
  "static-nodes": [10, 250],
  depth: [2, 24],
  "table-cells": [20, 1_000],
  "chart-points": [8, 250],
  "frame-rate": [5, 50],
  "text-churn": [1, 50],
  "tone-density": [0, 50],
  "heatmap-cells": [25, 1_000],
  "scatter-points": [25, 1_000],
  sparklines: [5, 250],
  counters: [5, 50],
};

/**
 * A fixed CPU job, timed: sorting numbers and a JSON round trip, the kind of
 * work a renderer does. The median of several runs, in ms. Comparing two
 * machines' results by it removes most of the difference between runners.
 */
export function calibrate(runs = 7): number {
  const times: number[] = [];
  for (let r = 0; r < runs; r++) {
    const start = performance.now();
    let seed = 42;
    const xs = Array.from({ length: 200_000 }, () => (seed = (seed * 1_103_515_245 + 12_345) % 2_147_483_648));
    xs.sort((a, b) => a - b);
    const tree = Array.from({ length: 20_000 }, (_, i) => ({ type: "Text", key: `k${i}`, props: { text: `node ${xs[i]}`, tone: "muted" } }));
    JSON.parse(JSON.stringify({ root: { type: "Stack", children: tree } }));
    times.push(performance.now() - start);
  }
  times.sort((a, b) => a - b);
  return Math.round(times[Math.floor(times.length / 2)]! * 100) / 100;
}

export interface StepComparison {
  workload: string;
  size: number;
  before: number;
  after: number;
  /** after ÷ before. */
  ratio: number;
  /** The budget this step broke now and did not on `main`. */
  newlyBroken?: string;
}

export interface RegressionReport {
  baseline: { commit: string; calibrationMs?: number };
  current: { commit: string; calibrationMs?: number };
  /** current ÷ baseline calibration: above 1, this machine ran the fixed job slower. Reported, not used. */
  speed: number;
  busyBefore: number;
  /** Total busy time now. */
  busyAfter: number;
  /** Total now ÷ total on main: reported. */
  ratio: number;
  /** The median over the steps of now ÷ main: judged. */
  medianRatio: number;
  steps: StepComparison[];
  missing: string[];
  regressed: boolean;
  reasons: string[];
}

const round = (n: number, d = 1) => Math.round(n * 10 ** d) / 10 ** d;

export function compareSmoke(base: ResultFile, now: ResultFile, renderer = "ours-element", profile: "desktop" | "phone" = "desktop"): RegressionReport {
  const cb = base.environment.calibrationMs;
  const cn = now.environment.calibrationMs;
  const speed = cb && cn ? cn / cb : 1;
  const steps: StepComparison[] = [];
  const missing: string[] = [];
  const reasons: string[] = [];
  for (const before of base.ladders.filter((l) => l.renderer === renderer && l.profile === profile)) {
    const after = now.ladders.find((l) => l.renderer === renderer && l.profile === profile && l.workload === before.workload);
    for (const s of before.steps) {
      const t = after?.steps.find((x) => x.size === s.size);
      const b = s.metrics.busy?.median;
      const a = t?.metrics.busy?.median;
      if (!t || b === undefined || a === undefined) {
        missing.push(`${before.workload} ${s.size}`);
        continue;
      }
      const c: StepComparison = { workload: before.workload, size: s.size, before: b, after: round(a), ratio: b > 0 ? round(a / b, 2) : 1 };
      if (t.broken && !s.broken) {
        c.newlyBroken = t.broken;
        reasons.push(`${before.workload} ${s.size} now breaks on ${t.broken}`);
      }
      steps.push(c);
    }
  }
  const busyBefore = round(steps.reduce((n, s) => n + s.before, 0));
  const busyAfter = round(steps.reduce((n, s) => n + s.after, 0));
  // Ratios from the unrounded medians; steps under the 2 ms floor are not judged.
  const ratios = steps.filter((s) => s.before >= TOLERANCE.absoluteMs).map((s) => s.after / s.before).sort((a, b) => a - b);
  const medianRatio = ratios.length ? (ratios.length % 2 ? ratios[(ratios.length - 1) / 2]! : (ratios[ratios.length / 2 - 1]! + ratios[ratios.length / 2]!) / 2) : 1;
  if (!steps.length) reasons.push("no step in common with the baseline");
  else if (medianRatio > 1 + TOLERANCE.relative) {
    reasons.push(`main-thread time per step ×${round(medianRatio, 2)} main's (median over ${ratios.length} steps; tolerance 20%)`);
  }
  return {
    baseline: { commit: base.environment.commit, ...(cb ? { calibrationMs: cb } : {}) },
    current: { commit: now.environment.commit, ...(cn ? { calibrationMs: cn } : {}) },
    speed: round(speed, 3),
    busyBefore,
    busyAfter,
    ratio: busyBefore > 0 ? round(busyAfter / busyBefore, 3) : 1,
    medianRatio: round(medianRatio, 3),
    steps,
    missing,
    regressed: reasons.length > 0,
    reasons,
  };
}

/** The report as Markdown, for the job summary. */
export function reportMarkdown(r: RegressionReport): string {
  const lines = [
    `### Bench smoke: ${r.regressed ? "regressed" : "within tolerance"}`,
    "",
    `Main-thread time per step: ×${r.medianRatio} main's, the median over the steps (fails above ×1.2). In total ${r.busyAfter} ms against ${r.busyBefore} ms (×${r.ratio}). For reference, this machine took ×${r.speed} main's time on a fixed CPU job (not used to scale).`,
    ...(r.reasons.length ? ["", ...r.reasons.map((x) => `- **${x}**`)] : []),
    "",
    "| Workload | Step | main (ms) | now (ms) | ratio |",
    "|---|---:|---:|---:|---:|",
    ...r.steps.map((s) => `| ${s.workload} | ${s.size} | ${s.before} | ${s.after} | ${s.ratio}${s.newlyBroken ? ` (broke: ${s.newlyBroken})` : ""} |`),
    ...(r.missing.length ? ["", `Not compared: ${r.missing.join(", ")}.`] : []),
  ];
  return lines.join("\n") + "\n";
}
