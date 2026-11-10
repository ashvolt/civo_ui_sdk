import { describe, expect, it } from "vitest";
import { createValidator, standardContract } from "relax-ui-contract";
import { benchContract } from "../src/workloads/contract.ts";
import { countNodes, depthOf, documentFor, framesFor, type Node } from "../src/workloads/generator.ts";
import { contractFor, LADDERS, planStep } from "../src/workloads/ladders.ts";

/** T-402: the seeded generator (FR-401, FR-403, data model W1–W3, F1–F2). */

const every = LADDERS.flatMap((ladder) => ladder.steps.map((size) => ({ ladder, size })));
// The largest steps are slow to build in a unit test; they share code with the rest.
const small = every.filter(({ size, ladder }) => size <= (ladder.id === "table-cells" ? 10_000 : ladder.id === "chart-points" ? 2_500 : 2_500));

function walk(node: Node, f: (n: Node) => void) {
  const stack = [node];
  while (stack.length) {
    const x = stack.pop()!;
    f(x);
    for (const c of x.children ?? []) stack.push(c);
  }
}

describe("workloads", () => {
  it("ladders strictly increase (W1)", () => {
    for (const ladder of LADDERS) {
      for (let i = 1; i < ladder.steps.length; i++) expect(ladder.steps[i]!).toBeGreaterThan(ladder.steps[i - 1]!);
    }
  });

  it.each(small.map(({ ladder, size }) => [ladder.id, size, ladder] as const))("%s %i: same seed, same document and frames", (_, size, ladder) => {
    const step = planStep(ladder, size);
    expect(JSON.stringify(framesFor(step))).toBe(JSON.stringify(framesFor(step)));
    expect(JSON.stringify(documentFor({ ...step, seed: step.seed + 1 }))).not.toBe(JSON.stringify(documentFor(step)));
  });

  it.each(small.map(({ ladder, size }) => [ladder.id, size, ladder] as const))("%s %i: the last frame is the document (F2)", (_, size, ladder) => {
    const step = planStep(ladder, size);
    const frames = framesFor(step);
    expect(frames).toHaveLength(step.frames);
    if (ladder.id !== "text-churn") expect(frames.at(-1)).toEqual(documentFor(step));
  });

  it("frames grow, never shrink, outside the churn workload (F1)", () => {
    for (const ladder of LADDERS.filter((l) => l.id === "nodes" || l.id === "depth")) {
      const frames = framesFor(planStep(ladder, ladder.steps[3]!));
      const counts = frames.map((f) => countNodes(f.root));
      for (let i = 1; i < counts.length; i++) expect(counts[i]!).toBeGreaterThanOrEqual(counts[i - 1]!);
      expect(counts[0]!).toBeLessThan(counts.at(-1)!);
    }
  });

  it("table and chart frames grow their rows and points, not only their node count", () => {
    const table = framesFor(planStep(LADDERS.find((l) => l.id === "table-cells")!, 5_000));
    const rows = table.map((f) => ((f.root.children![1]!.props.rows as unknown[]) ?? []).length);
    expect(rows[0]!).toBeLessThan(rows.at(-1)!);
    expect(rows.at(-1)).toBe(500);
  });

  it("text churn keeps untouched subtrees as the same objects", () => {
    const frames = framesFor(planStep(LADDERS.find((l) => l.id === "text-churn")!, 10));
    // The first half builds the document; churn starts after it.
    const half = frames.length / 2;
    const [a, b] = [frames[half]!, frames[half + 1]!];
    expect(countNodes(frames[0]!.root)).toBeLessThan(countNodes(a.root));
    const same = a.root.children!.filter((g, i) => g === b.root.children![i]).length;
    expect(same).toBeGreaterThan(0);
    expect(same).toBeLessThan(a.root.children!.length);
  });

  it("node counts and depths are what the ladder says", () => {
    expect(countNodes(documentFor({ dimension: "nodes", size: 1000, seed: 1 }).root)).toBe(1000);
    expect(depthOf(documentFor({ dimension: "depth", size: 48, seed: 1 }).root)).toBe(49);
    expect(countNodes(documentFor({ dimension: "depth", size: 48, seed: 1 }).root)).toBe(200);
  });

  it("documents within the standard budgets pass the standard contract; larger ones the bench contract (W2)", () => {
    const standard = createValidator(standardContract);
    const bench = createValidator(benchContract);
    for (const { ladder, size } of small) {
      const doc = documentFor(planStep(ladder, size));
      const nodes = countNodes(doc.root);
      const which = contractFor(nodes, depthOf(doc.root));
      const big = ladder.id === "table-cells" || ladder.id === "chart-points";
      const validator = which === "standard" && !big ? standard : bench;
      walk(doc.root, (n) => {
        const r = validator.props(n.type, n.props);
        expect(r.ok, `${ladder.id} ${size}: ${n.type} ${r.ok ? "" : r.detail}`).toBe(true);
      });
    }
  });

  it("every frame of every step is valid against the bench contract, not only the last", () => {
    const bench = createValidator(benchContract);
    for (const { ladder, size } of small.filter(({ size }) => size <= 1_000)) {
      for (const frame of framesFor(planStep(ladder, size))) {
        walk(frame.root, (n) => {
          const r = bench.props(n.type, n.props);
          expect(r.ok, `${ladder.id} ${size}: ${n.type} ${r.ok ? "" : r.detail}`).toBe(true);
        });
      }
    }
  });

  it("the bench contract leaves the standard twelve unchanged", () => {
    expect(standardContract.limits).toEqual({ maxNodes: 500, maxDepth: 24 });
    expect(benchContract.limits).toEqual({ maxNodes: 200_000, maxDepth: 200 });
    expect([...benchContract.names].sort()).toEqual([...standardContract.names].sort());
    expect(standardContract.spec("Table")!.props.safeParse({ columns: ["a"], rows: Array(51).fill(["x"]) }).success).toBe(false);
  });
});
