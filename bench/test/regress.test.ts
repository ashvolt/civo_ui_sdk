import { describe, expect, it } from "vitest";
import { calibrate, compareSmoke, reportMarkdown, SMOKE_SIZES } from "../src/regress.ts";
import type { ResultFile } from "../src/results.ts";
import { LADDERS } from "../src/workloads/ladders.ts";

/** T-450: the pull-request regression check, without a browser. */

function result(busy: Record<string, number[]>, calibrationMs = 100, broken: Record<string, string> = {}): ResultFile {
  return {
    schemaVersion: 1,
    budgetVersion: 2,
    suite: "smoke",
    environment: { machine: "m", cpu: "c", cores: 4, memoryGb: 16, os: "o", browser: "b", node: "n", commit: "abc", date: "2026-11-14", calibrationMs },
    renderers: [],
    workloads: [],
    ladders: Object.entries(busy).map(([workload, values]) => ({
      renderer: "ours-element",
      profile: "desktop",
      workload,
      expressible: true,
      steps: values.map((v, i) => ({
        size: SMOKE_SIZES[workload]![i]!,
        metrics: { busy: { median: v, iqr: 0 } },
        samples: [],
        ...(broken[`${workload}:${i}`] ? { broken: broken[`${workload}:${i}`] } : {}),
      })),
      breakPoint: "not-reached",
    })),
    attacks: [],
  };
}

const base = { nodes: [20, 400], "table-cells": [20, 300], counters: [30, 250] };
const scale = (k: number) => Object.fromEntries(Object.entries(base).map(([w, v]) => [w, v.map((x) => x * k)]));

describe("the smoke steps (T-450)", () => {
  it("every ladder has a first step and a step on the ladder", () => {
    for (const l of LADDERS) {
      const sizes = SMOKE_SIZES[l.id];
      expect(sizes, l.id).toBeDefined();
      expect(sizes![0], l.id).toBe(l.steps[0]);
      for (const s of sizes!) expect(l.steps, `${l.id} ${s}`).toContain(s);
    }
  });

  it("calibration is a positive time, steady enough to compare machines", () => {
    const a = calibrate(3);
    expect(a).toBeGreaterThan(0);
  });
});

describe("the regression judgement (T-450, FR-440)", () => {
  it("a 50% slowdown regresses; noise within the tolerance does not", () => {
    expect(compareSmoke(result(base), result(scale(1.5))).regressed).toBe(true);
    expect(compareSmoke(result(base), result(scale(1.15))).regressed).toBe(false);
    // Uneven noise: one step much slower, the total within 20%.
    const noisy = { ...base, nodes: [30, 420] };
    expect(compareSmoke(result(base), result(noisy)).regressed).toBe(false);
  });

  it("one large step that spikes does not fail it, though the total would", () => {
    const spike = { ...base, nodes: [20, 1_200] };
    const r = compareSmoke(result(base), result(spike));
    expect(r.ratio).toBeGreaterThan(1.2);
    expect(r.medianRatio).toBe(1);
    expect(r.regressed).toBe(false);
  });

  it("fails only when the ratio exceeds the tolerance both as measured and for the machine's speed (R6, the CI runs)", () => {
    // [measured ratio, calibration ratio, regressed?], from the runs that decided the rule.
    const cases: [number, number, boolean][] = [
      [0.994, 1.028, false], // PR #20
      [1.282, 1.276, false], // main after #20: a slower runner, no rendering change
      [1.051, 0.808, false], // PR #21: the calibration said faster, the renderer was not slower
      [1.045, 1.015, false], // main after #21
      [2.02, 0.799, true], // a 1.5x CPU throttle on the laptop
      [1.5, 1.0, true], // a real 50% slowdown on a runner like main's
    ];
    for (const [measured, speed, regressed] of cases) {
      const r = compareSmoke(result(base, 100), result(scale(measured), 100 * speed));
      expect(r.regressed, `×${measured} at speed ×${speed}`).toBe(regressed);
      expect(r.scaledRatio).toBeCloseTo(measured / speed, 2);
    }
  });

  it("a step that breaks now and did not on main fails, whatever the time", () => {
    const r = compareSmoke(result(base), result(base, 100, { "counters:1": "longestTask" }));
    expect(r.regressed).toBe(true);
    expect(r.reasons).toEqual(["counters 50 now breaks on longestTask"]);
  });

  it("reports the steps it could not compare, and fails when none match", () => {
    const r = compareSmoke(result(base), result({ nodes: [20, 400] }));
    expect(r.missing).toEqual(["table-cells 20", "table-cells 1000", "counters 5", "counters 50"]);
    expect(compareSmoke(result(base), result({})).regressed).toBe(true);
  });

  it("writes a summary that says what decided", () => {
    const md = reportMarkdown(compareSmoke(result(base), result(scale(1.5))));
    expect(md).toContain("regressed");
    expect(md).toContain("| nodes | 1000 | 400 | 600 | 1.5 |");
    expect(md).toContain("Fails when both exceed ×1.2");
  });
});
