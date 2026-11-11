import { describe, expect, it } from "vitest";
import { countDetached, judgeSoak, SOAK_BUDGET, type SoakSample } from "../src/soak.ts";
import { countNodes } from "../src/workloads/generator.ts";
import { soakDocuments } from "../src/workloads/soak.ts";

/** T-420: what breaks a soak (FR-415, contracts/budgets.md). */

const MB = 1_000_000;

/** Thirty one-minute samples of a page, with `f` changing each. */
function series(f: (minute: number) => Partial<SoakSample> = () => ({})): SoakSample[] {
  return Array.from({ length: 31 }, (_, minute) => ({
    minute,
    heap: 3 * MB + ((minute * 7919) % 13) * 10_000, // wanders, does not grow
    domNodes: 981,
    listeners: 13,
    ...f(minute),
  }));
}

describe("judgeSoak", () => {
  it("passes a steady page", () => {
    const v = judgeSoak(series(), 0, 0);
    expect(v).toMatchObject({ passed: true, broken: [], domNodeGrowth: 0, listenerGrowth: 0, detachedGrowth: 0 });
    expect(Math.abs(v.heapGrowth)).toBeLessThan(0.05);
  });

  it("breaks on one listener leaked per document", () => {
    // About 17 documents a minute in the soak cycle.
    const v = judgeSoak(series((m) => ({ listeners: 13 + m * 17 })), 0, 0);
    expect(v.broken).toEqual(["listeners"]);
  });

  it("breaks on a single listener more at the end", () => {
    expect(judgeSoak(series((m) => ({ listeners: m === 30 ? 14 : 13 })), 0, 0).broken).toEqual(["listeners"]);
  });

  it("breaks on detached nodes kept per document", () => {
    expect(judgeSoak(series(), 0, 510).broken).toEqual(["detached"]);
    expect(judgeSoak(series(), 4, 4).passed).toBe(true);
  });

  it("breaks on DOM nodes left behind", () => {
    expect(judgeSoak(series((m) => ({ domNodes: 981 + m })), 0, 0).broken).toEqual(["domNodes"]);
  });

  it("measures DOM growth from the first steady sample, not sample 0", () => {
    // First use can allocate once (a stylesheet, a lazily built element).
    expect(judgeSoak(series((m) => ({ domNodes: m === 0 ? 950 : 981 })), 0, 0).passed).toBe(true);
  });

  it("breaks on heap growth over 10%, first five minutes against the last five", () => {
    const grow = (rate: number) => series((m) => ({ heap: 3 * MB * (1 + rate * m) }));
    expect(judgeSoak(grow(0.002), 0, 0).passed).toBe(true); // about 5% over the run
    const v = judgeSoak(grow(0.005), 0, 0); // about 13%
    expect(v.broken).toEqual(["heap"]);
    expect(v.heapGrowth).toBeGreaterThan(SOAK_BUDGET.heapGrowth);
  });

  it("is not fooled by one late spike in heap", () => {
    expect(judgeSoak(series((m) => (m === 30 ? { heap: 9 * MB } : {})), 0, 0).passed).toBe(true);
  });

  it("breaks when mounted framework components differ from the document's", () => {
    const ok = series(() => ({ mounted: 43, expectedMounted: 43 }));
    expect(judgeSoak(ok, 0, 0).passed).toBe(true);
    const leaked = series((m) => ({ mounted: 43 + Math.floor(m / 10), expectedMounted: 43 }));
    expect(judgeSoak(leaked, 0, 0).broken).toEqual(["mounted"]);
  });

  it("reports every break, not only the first", () => {
    const v = judgeSoak(series((m) => ({ listeners: 13 + m, domNodes: 981 + m })), 0, 3);
    expect(v.broken).toEqual(["domNodes", "listeners", "detached"]);
  });

  it("judges a short run (the self-test) by thirds", () => {
    const short = series().slice(0, 7);
    expect(judgeSoak(short, 0, 0).passed).toBe(true);
    expect(() => judgeSoak(short.slice(0, 2), 0, 0)).toThrow();
  });
});

describe("countDetached", () => {
  it("counts nodes whose detachedness is detached (current Chromium)", () => {
    const strings = ["", "HTMLDivElement"];
    // Three fields per node: type, name, detachedness (0 unknown, 1 attached, 2 detached).
    const nodes = [0, 1, 1, 0, 1, 2, 0, 1, 0, 0, 1, 2];
    expect(countDetached({ snapshot: { meta: { node_fields: ["type", "name", "detachedness"] } }, nodes, strings })).toBe(2);
  });

  it("counts nodes named Detached in a snapshot without detachedness (older Chromium)", () => {
    const strings = ["", "HTMLDivElement", "Detached HTMLDivElement", "Detached <div>", "(system)"];
    // Two fields per node: type, name.
    const snapshot = { snapshot: { meta: { node_fields: ["type", "name"] } }, nodes: [0, 1, 0, 2, 0, 3, 0, 4, 0, 2], strings };
    expect(countDetached(snapshot)).toBe(3);
  });
});

describe("soak documents", () => {
  it("replace each other, and document 0 holds framework-mounted types", () => {
    const docs = soakDocuments();
    expect(docs.length).toBeGreaterThanOrEqual(4);
    const first = docs[0]!.at(-1)!;
    let mounted = 0;
    const walk = (n: (typeof first)["root"]) => {
      if (n.type === "Card" || n.type === "Metric") mounted++;
      n.children?.forEach(walk);
    };
    walk(first.root);
    expect(mounted).toBeGreaterThan(10);
    expect(countNodes(first.root)).toBe(250);
    // Each is streamed as frames: patched, not only replaced.
    for (const frames of docs) expect(frames.length).toBeGreaterThanOrEqual(10);
  });
});
