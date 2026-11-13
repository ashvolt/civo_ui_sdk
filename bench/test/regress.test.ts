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

  it("reports the calibration but does not scale by it (it measured noise, R6)", () => {
    const r = compareSmoke(result(base, 100), result(scale(1.5), 150));
    expect(r.speed).toBe(1.5);
    expect(r.regressed).toBe(true);
    expect(compareSmoke(result(base, 100), result(base, 300)).regressed).toBe(false);
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
    expect(md).toContain("not used to scale");
  });
});
