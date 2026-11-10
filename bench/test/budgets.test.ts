import { describe, expect, it } from "vitest";
import { BUDGETS, breakPoint, regressed, summarise, type Sample } from "../src/budgets.ts";
import { iqr, median, percentile } from "../src/stats.ts";

/** The budget rules (FR-411, FR-412, FR-440), set before any result existed. */

const steady = (over: Partial<Sample> = {}): Sample => ({
  frames: Array(60).fill(16.6),
  longFrames: [],
  interaction: 0,
  firstNode: 20,
  complete: 1000,
  correct: true,
  ...over,
});

describe("statistics", () => {
  it("nearest-rank percentiles, median and spread", () => {
    const xs = [5, 1, 4, 2, 3];
    expect(percentile(xs, 95)).toBe(5);
    expect(median(xs)).toBe(3);
    expect(iqr([1, 2, 3, 4, 5, 6, 7, 8])).toBe(4);
    expect(percentile([], 95)).toBe(0);
  });
});

describe("a step breaks on the first budget it exceeds", () => {
  it("a steady page passes", () => {
    expect(summarise([steady(), steady(), steady()]).broken).toBeUndefined();
  });

  it("a long task over 50 ms breaks it", () => {
    expect(summarise([steady({ longFrames: [80] }), steady({ longFrames: [80] }), steady()]).broken).toBe("longestTask");
  });

  it("slow frames break it at the 95th percentile, not on one slow frame", () => {
    const janky = steady({ frames: [...Array(50).fill(16.6), ...Array(10).fill(33.4)] });
    expect(summarise([janky, janky, janky]).broken).toBe("frameP95");
    const oneSlow = steady({ frames: [...Array(59).fill(16.6), 40] });
    expect(summarise([oneSlow, oneSlow, oneSlow]).broken).toBeUndefined();
  });

  it("interaction latency over 200 ms breaks it", () => {
    expect(summarise([steady({ interaction: 250 }), steady({ interaction: 250 }), steady()]).broken).toBe("interaction");
  });

  it("one wrong render breaks it, however fast (R1)", () => {
    expect(summarise([steady(), steady({ correct: false }), steady()]).broken).toBe("correctness");
  });

  it("a timeout or an error breaks it, before any timing is considered", () => {
    expect(summarise([steady({ timedOut: true, longFrames: [80] })]).broken).toBe("timeout");
    expect(summarise([steady({ error: "boom" })]).broken).toBe("error");
    expect(summarise([steady({ crashed: true, error: "Target crashed" })]).broken).toBe("crash");
  });

  it("budgets are the contract's values", () => {
    expect(BUDGETS).toMatchObject({ frameP95: 25, longestTask: 50, interaction: 200 });
  });

  it("vsync jitter is not a late frame: an idle page's intervals pass (budget v2)", () => {
    const idle = steady({ frames: [...Array(55).fill(16.7), ...Array(5).fill(16.8)] });
    expect(summarise([idle, idle, idle]).broken).toBeUndefined();
  });
});

describe("the ladder's break point (FR-412)", () => {
  it("is the last passing step, with the budget that stopped the next", () => {
    expect(breakPoint([{ size: 1 }, { size: 2 }, { size: 3, broken: "frameP95" }])).toEqual({ breakPoint: 2, brokenBy: "frameP95" });
    expect(breakPoint([{ size: 1, broken: "timeout" }])).toEqual({ breakPoint: "below-first-step", brokenBy: "timeout" });
    expect(breakPoint([{ size: 1 }, { size: 2 }])).toEqual({ breakPoint: "not-reached" });
  });
});

describe("pull-request regression (FR-440)", () => {
  it("20% or 2 ms, whichever is larger; 10% for memory", () => {
    expect(regressed(12, 10)).toBe(false); // +2 ms: within the 2 ms floor
    expect(regressed(12.5, 10)).toBe(true);
    expect(regressed(119, 100)).toBe(false);
    expect(regressed(121, 100)).toBe(true);
    expect(regressed(109, 100, true)).toBe(false);
    expect(regressed(111, 100, true)).toBe(true);
  });
});
