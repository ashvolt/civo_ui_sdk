import { describe, expect, it } from "vitest";
import { mergeAttacks, mergeLadders, mergeSoaks } from "../src/merge.ts";
import type { ResultFile } from "../src/results.ts";

/** T-451: the nightly run's parallel jobs merged into one file per kind. */

const env = { machine: "runner", cpu: "c", cores: 4, memoryGb: 16, os: "linux", browser: "b", node: "22", commit: "abc", date: "2026-11-14" };

function ladders(renderer: string): ResultFile {
  return {
    schemaVersion: 1,
    budgetVersion: 2,
    suite: "nightly",
    environment: env,
    renderers: [{ id: renderer, packages: { x: "1" }, available: true }],
    workloads: [{ id: "nodes", dimension: "nodes", seed: 1, steps: [10, 25], contract: "standard" }],
    ladders: [
      {
        renderer,
        profile: "desktop",
        workload: "nodes",
        expressible: true,
        steps: [{ size: 10, metrics: { busy: { median: 5, iqr: 1 } }, samples: [{ frames: 40 }] }],
        breakPoint: "not-reached",
      },
    ],
    coldStart: [{ renderer, profile: "desktop", metrics: { firstNode: { median: 7, iqr: 0 } } }],
    attacks: [],
  };
}

describe("merging the nightly jobs (T-451)", () => {
  it("joins every renderer's ladders and cold starts, keeping medians and dropping raw samples", () => {
    const m = mergeLadders([ladders("a"), ladders("b")]);
    expect(m.renderers.map((r) => r.id)).toEqual(["a", "b"]);
    expect(m.ladders.map((l) => l.renderer)).toEqual(["a", "b"]);
    expect(m.coldStart!.map((c) => c.renderer)).toEqual(["a", "b"]);
    expect(m.ladders[0]!.steps[0]!.samples).toEqual([]);
    expect(m.ladders[0]!.steps[0]!.metrics.busy!.median).toBe(5);
    expect(m.suite).toBe("nightly");
  });

  it("joins the soaks", () => {
    const s = (r: string) => ({ ...ladders(r), ladders: [], soak: [{ renderer: r }] }) as ResultFile;
    expect(mergeSoaks([s("a"), s("b")]).soak).toEqual([{ renderer: "a" }, { renderer: "b" }]);
  });

  it("keeps a withheld contender withheld, by count only, to the latest date", () => {
    const m = mergeAttacks([
      { schemaVersion: 1, environment: env, attacks: [{ id: 1 }] },
      { schemaVersion: 1, environment: env, withheld: { contenders: 1, until: "2026-12-13", why: "FR-435" }, attacks: [] },
      { schemaVersion: 1, environment: env, withheld: { contenders: 1, until: "2026-12-14", why: "FR-435" }, attacks: [{ id: 2 }] },
    ]);
    expect(m.attacks).toEqual([{ id: 1 }, { id: 2 }]);
    expect(m.withheld).toEqual({ contenders: 2, until: "2026-12-14", why: "FR-435" });
  });
});
