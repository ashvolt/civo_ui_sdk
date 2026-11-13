import { describe, expect, it } from "vitest";
import { readSource, UIStreamAccumulator } from "relax-ui-protocol";
import { classify, EVIDENCE_KINDS, noEvidence } from "../src/attacks/classify.ts";
import { CORPUS, PWN_HOST } from "../src/attacks/corpus.ts";
import { fuzzCorpus } from "../src/attacks/fuzz.ts";
import { BENIGN, caseId, placedDocument, slots } from "../src/attacks/place.ts";
import { PROTOCOL_CASES, buildProtocolCase } from "../src/attacks/protocol.ts";
import { tricks } from "../src/attacks/tricks.ts";
import { oursSSE } from "../src/runner/encode.ts";
import { benchContract } from "../src/workloads/contract.ts";
import type { Node } from "../src/workloads/generator.ts";

/** T-440, T-441, T-443: the attack harness's rules and cases, without a browser. */

describe("classification (T-440, invariant A2)", () => {
  it("any evidence of any kind is executed, whatever the renderer reported", () => {
    for (const kind of EVIDENCE_KINDS) {
      const e = { ...noEvidence(), [kind]: ["seen"] };
      expect(classify(e, false), kind).toBe("executed");
      expect(classify(e, true), kind).toBe("executed");
    }
  });

  it("no evidence: blocked if the renderer refused, else inert", () => {
    expect(classify(noEvidence(), true)).toBe("blocked");
    expect(classify(noEvidence(), false)).toBe("inert");
  });
});

describe("the corpus (T-441)", () => {
  it("covers every technique of the contract, with unique ids", () => {
    const ids = CORPUS.map((p) => p.id);
    expect(new Set(ids).size).toBe(ids.length);
    expect(new Set(CORPUS.map((p) => p.technique))).toEqual(
      new Set(["event-handler", "script-url", "breakout", "namespace", "mxss", "template-expression", "css", "policy-bypass", "spoofing"]),
    );
  });

  it("every payload that could run or fetch says which case it was", () => {
    for (const p of CORPUS) {
      if (p.technique === "spoofing" || p.id === "script-url.vbscript") continue;
      const text = p.make("CASE-1");
      // The call may be escaped inside a quoted attribute (`v-html`); the id is whole.
      const named = /__relaxPwned\(\\?'CASE-1\\?'\)/.test(text) || text.includes(`${PWN_HOST}/CASE-1`) || atobSafe(text).includes("CASE-1");
      expect(named, p.id).toBe(true);
    }
  });

  it("fuzzing is deterministic per seed and keeps the canary whole", () => {
    const a = fuzzCorpus(7, 50).map((p) => p.make("ID-9"));
    const b = fuzzCorpus(7, 50).map((p) => p.make("ID-9"));
    expect(a).toEqual(b);
    expect(fuzzCorpus(8, 50).map((p) => p.make("ID-9"))).not.toEqual(a);
    const canaries = a.filter((t) => t.includes("__relaxPwned"));
    expect(canaries.length).toBeGreaterThan(0);
    for (const t of canaries) expect(t).toContain("__relaxPwned('ID-9')");
  });
});

const atobSafe = (s: string) => {
  const m = /base64,([A-Za-z0-9+/=]+)/.exec(s);
  return m ? atob(m[1]!) : "";
};

describe("placement (T-441)", () => {
  it("the benign document is valid under the bench contract, so a refusal is the payload's doing", () => {
    expect(benchContract.documentSchema.safeParse(placedDocument(undefined)).success).toBe(true);
  });

  it("names every string prop of every component, the kit's included", () => {
    const ids = slots().map((s) => s.id);
    // Grid's only prop is a number.
    expect(new Set(slots().map((s) => s.type))).toEqual(new Set(Object.keys(BENIGN).filter((t) => t !== "Grid")));
    for (const id of ["Link.href", "Link.label", "Table.rows.0.1", "Chart.series.0.name", "Badge.tone", "Scatter.xLabel", "SparklineGrid.items.0.label"]) {
      expect(ids).toContain(id);
    }
  });

  it("puts the payload in exactly one prop of each node", () => {
    const payload = CORPUS[0]!;
    const doc = placedDocument(payload);
    const list = slots();
    expect(doc.root.children).toHaveLength(list.length);
    doc.root.children!.forEach((node: Node, i) => {
      const found = JSON.stringify(node.props).split("__relaxPwned").length - 1;
      expect(found, list[i]!.id).toBe(1);
      expect(JSON.stringify(node.props)).toContain(caseId(payload, list[i]!));
    });
  });
});

describe("injection tricks (T-443)", () => {
  it("prototype keys reach the page as own properties of props, as JSON.parse makes them", async () => {
    const doc = tricks().find((t) => t.id === "proto-key.props")!.document;
    const bytes = new TextEncoder().encode(oursSSE([doc]).join(""));
    const stream = new ReadableStream<Uint8Array>({ start: (c) => (c.enqueue(bytes), c.close()) });
    const acc = new UIStreamAccumulator();
    for await (const e of readSource({ stream })) acc.apply(e);
    const props = (acc.current() as unknown as { root: Node }).root.children![0]!.props;
    expect(Object.hasOwn(props, "__proto__")).toBe(true);
    expect(Object.getPrototypeOf(props)).toBe(Object.prototype);
    expect(({} as Record<string, unknown>).polluted).toBeUndefined();
  });

  it("identity props are on every component", () => {
    const doc = tricks().find((t) => t.id === "identity.props")!.document;
    for (const n of doc.root.children!) for (const name of ["style", "class", "slot", "part", "id"]) expect(n.props).toHaveProperty(name);
  });
});

describe("protocol cases (T-442)", () => {
  it("every case in the contract builds, with a requirement", () => {
    // The 100 MB frame is built in full; it is run in the browser, not here.
    for (const c of PROTOCOL_CASES.filter((c) => c.id !== "oversized-100mb")) {
      const built = buildProtocolCase(c.id);
      expect(built.setup.validate).toBe("full");
      expect(c.requirement).toBeTruthy();
    }
  });
});
