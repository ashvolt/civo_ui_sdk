import { describe, expect, it } from "vitest";
import { readSource, UIStreamAccumulator } from "relax-ui-protocol";
import { classify, EVIDENCE_KINDS, noEvidence } from "../src/attacks/classify.ts";
import { CORPUS, PWN_HOST } from "../src/attacks/corpus.ts";
import { disclosureGate, passedThrough } from "../src/attacks/disclosure.ts";
import { badUrl } from "../src/attacks/page.ts";
import { RENDERERS } from "../src/runner/renderers.ts";
import { fuzzCorpus } from "../src/attacks/fuzz.ts";
import { BENIGN, caseId, placedDocument, slots } from "../src/attacks/place.ts";
import { PROTOCOL_CASES, buildProtocolCase } from "../src/attacks/protocol.ts";
import { benignDashboard, DASHBOARD_TYPES, forbidden, PROMPTS } from "../src/attacks/redteam.ts";
import { dashboardContract } from "../../examples/next-app/app/ui-registry.ts";
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

describe("the red-team (T-444)", () => {
  it("about twenty prompts, unique, each within the route's 300-character topic", () => {
    expect(PROMPTS.length).toBeGreaterThanOrEqual(20);
    expect(new Set(PROMPTS.map((p) => p.id)).size).toBe(PROMPTS.length);
    for (const p of PROMPTS) expect(p.topic.length, p.id).toBeLessThanOrEqual(300);
  });

  it("the benign dashboard is valid under the Next example's contract, and holds nothing forbidden", () => {
    const doc = benignDashboard();
    expect(dashboardContract.documentSchema.safeParse(doc).success).toBe(true);
    expect(forbidden(JSON.stringify(doc))).toEqual([]);
    const types = new Set<string>();
    const walk = (n: Node) => (types.add(n.type), n.children?.forEach(walk));
    walk(doc.root);
    expect(types).toEqual(DASHBOARD_TYPES);
  });

  it("finds what a model should not have written, in text or in the document's shape", () => {
    const doc = (root: object) => JSON.stringify({ root });
    expect(forbidden(doc({ type: "Text", props: { text: "<script>x</script>" } }))).toContain("markup");
    expect(forbidden(doc({ type: "Link", props: { label: "a", href: "javascript:alert(1)" } }))).toEqual(expect.arrayContaining(["script-url", "canary"]));
    expect(forbidden(doc({ type: "Iframe", props: { src: "https://x" } }))).toEqual(expect.arrayContaining(["type:Iframe", "prop:src"]));
    expect(forbidden(doc({ type: "Card", props: { title: "t", onClick: "go" } }))).toContain("prop:onClick");
    const deep = Array.from({ length: 8 }).reduce<object>((child) => ({ type: "Card", props: { title: "t" }, children: [child] }), { type: "Text", props: { text: "x" } });
    expect(forbidden(doc(deep))).toContain("depth:9");
    expect(forbidden("not json, but <iframe srcdoc=x>")).toEqual(["markup"]);
  });
});

describe("the DOM scan's URL rule (T-445)", () => {
  it("a framework's neutralised URL is not a script URL; anything else with a bad scheme is", () => {
    expect(badUrl("javascript:throw new Error('React has blocked a javascript: URL as a security precaution.')")).toBe(false);
    expect(badUrl("unsafe:javascript:__relaxPwned(1)")).toBe(false);
    expect(badUrl("javascript:throw new Error('React has blocked a javascript: URL as a security precaution.');__relaxPwned(1)")).toBe(true);
    expect(badUrl("x-unsafe:javascript:1")).toBe(true);
    for (const u of ["javascript:1", "JaVa\tScRiPt:1", "data:text/html,x", "vbscript:1"]) expect(badUrl(u), u).toBe(true);
    for (const u of ["https://example.com/", "mailto:a@b.c", "/relative", "#top"]) expect(badUrl(u), u).toBe(false);
  });
});

describe("the disclosure gate (T-445, FR-435, invariant A3)", () => {
  const r = (renderer: string, outcome: string, id = "c") => ({ renderer, outcome, id });
  const contender = (name: string) => !name.startsWith("ours-");

  it("a contender that executes anything is left out of the committed part, its clean cases too", () => {
    const g = disclosureGate([r("ours-element", "blocked"), r("lib-a", "inert", "1"), r("lib-a", "executed", "2"), r("lib-b", "inert")], contender, new Date("2026-11-13T12:00:00Z"));
    expect(g.published.map((x) => x.renderer)).toEqual(["ours-element", "lib-b"]);
    expect(JSON.stringify(g.published)).not.toContain("lib-a");
    expect(g.embargoed.map((x) => x.id)).toEqual(["1", "2"]);
    expect(g.embargoed.every((x) => x.embargoed)).toBe(true);
    expect(g).toMatchObject({ withheld: 1, until: "2026-12-13" });
  });

  it("a bad URL on the kit's own link alone is published, marked as passed through; anything more is withheld", () => {
    const through = { dom: ['url kit-link href="data:text/html,x"'] };
    const own = { dom: ['url <a href="javascript:x">'] };
    expect(passedThrough(through)).toBe(true);
    expect(passedThrough(own)).toBe(false);
    expect(passedThrough({ ...through, canary: ["c"] })).toBe(false);
    expect(passedThrough({ dom: [...through.dom, "new element <script>"] })).toBe(false);
    expect(passedThrough({})).toBe(false);
    const g = disclosureGate(
      [
        { renderer: "lib-a", outcome: "executed", evidence: through },
        { renderer: "lib-b", outcome: "executed", evidence: through },
        { renderer: "lib-b", outcome: "executed", evidence: own },
      ],
      contender,
    );
    expect(g.published).toEqual([{ renderer: "lib-a", outcome: "executed", evidence: through, cause: "passed-through-unchecked" }]);
    expect(g.withheld).toBe(1);
    expect(JSON.stringify(g.published)).not.toContain("lib-b");
  });

  it("this SDK is never withheld, and nothing is when no contender executes", () => {
    const g = disclosureGate([r("ours-element", "executed"), r("lib-b", "blocked")], contender);
    expect(g.published).toHaveLength(2);
    expect(g.embargoed).toEqual([]);
    expect(g.withheld).toBe(0);
    expect(g.until).toBeUndefined();
  });
});

describe("contender encodings carry the corpus (T-445)", () => {
  it("each contender's wire format holds the payload and the prototype key, as its parser will read them", () => {
    const payload = CORPUS[0]!;
    const doc = placedDocument(payload);
    const proto = tricks().find((t) => t.id === "proto-key.props")!.document;
    for (const [name, info] of Object.entries(RENDERERS)) {
      if (!info.contender) continue;
      for (const d of [doc, proto]) {
        const e = info.encode!([d], "nodes");
        expect("chunks" in e, name).toBe(true);
      }
      const text = (info.encode!([doc], "nodes") as { chunks: string[] }).chunks.join("");
      expect(text, name).toContain("__relaxPwned");
      // OpenUI Lang passes props by position: the runner records this trick as not expressible.
      if (name !== "openui") expect((info.encode!([proto], "nodes") as { chunks: string[] }).chunks.join(""), name).toContain("__proto__");
    }
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
