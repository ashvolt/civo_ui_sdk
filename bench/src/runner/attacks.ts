/**
 * `pnpm bench:attacks` — the attack suites against this SDK (phase 5, plan
 * D7): the injection corpus and its fuzzed variants in every string prop of
 * every component, the injection tricks, and protocol abuse; on every host,
 * at both validation tiers. Each case runs in a fresh renderer and is
 * classified from evidence (`../attacks/classify.ts`).
 *
 *   --renderer a,b       default: this SDK's four hosts, then each library
 *                        connector from the example apps (Bootstrap, Shoelace,
 *                        Element Plus, Angular Material, MUI), then each
 *                        contender (T-445) in its own wire format
 *   --suite a,b          injection, fuzz, tricks, protocol (default: all)
 *   --fuzz N             fuzzed variants (default 100)
 *   --seed S             fuzz seed (default: the day, so a nightly run explores)
 *   --self-test          the unsafe page and this SDK's element on one case per
 *                        evidence kind: the harness must see each (T-440)
 *   --out path.json      default: bench/results/attacks-<date>.json
 *
 * Exits non-zero if this SDK executes any case or misses a protocol
 * requirement (invariant A1). A contender that executes a case does not fail
 * the run; it is the disclosure gate's (FR-435, invariant A3): every result of
 * that contender goes to `bench/results/private/` (untracked), and the
 * committed file leaves the contender out, saying only how many were withheld.
 */
import { mkdirSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { chromium, type Browser, type CDPSession, type Page } from "@playwright/test";
import { classify, evidenceKinds, noEvidence, type Evidence, type Outcome } from "../attacks/classify.ts";
import { CORPUS, PWN_HOST, type Payload } from "../attacks/corpus.ts";
import { disclosureGate, EMBARGO_DAYS, passedThrough } from "../attacks/disclosure.ts";
import { fuzzCorpus } from "../attacks/fuzz.ts";
import type { AttackSetup, CaseReport } from "../attacks/page.ts";
import { baselineDocument, placedDocument } from "../attacks/place.ts";
import { PROTOCOL_CASES, type ProtocolCase } from "../attacks/protocol.ts";
import { tricks } from "../attacks/tricks.ts";
import type { Document } from "../workloads/generator.ts";
import { oursSSE } from "./encode.ts";
import { environment } from "./environment.ts";
import { RENDERERS } from "./renderers.ts";
import { startServer, type BenchServer } from "./server.ts";

const here = dirname(fileURLToPath(import.meta.url));
const arg = (name: string) => {
  const i = process.argv.indexOf(`--${name}`);
  return i === -1 ? undefined : process.argv[i + 1];
};
const flag = (name: string) => process.argv.includes(`--${name}`);

/** The library connector each connector page plugs in, beside the bench kit; the others use the base theme. */
const CONNECTORS: Record<string, string> = {
  "ours-bootstrap": "bootstrap-5",
  "ours-shoelace": "shoelace",
  "ours-element-plus": "element-plus",
  "ours-material": "angular-material",
  "ours-mui": "mui",
};
const OURS = ["ours-element", "ours-react", "ours-vue-host", "ours-angular-host", ...Object.keys(CONNECTORS)];
/** The other libraries (T-445): the same corpus in each one's own wire format, drawn with the same kit. */
const CONTENDERS = Object.keys(RENDERERS).filter((r) => RENDERERS[r]!.contender);
const connectorOf = (renderer: string) => (CONTENDERS.includes(renderer) ? "kit" : CONNECTORS[renderer] ? `${CONNECTORS[renderer]}+kit` : "base+kit");
/** Protocol abuse is the reader's, shared by every element host: run where the reading differs. */
const PROTOCOL_HOSTS = new Set(["ours-element", "ours-react"]);
const TIERS = ["full", "server"] as const;
/**
 * Tricks a contender's wire format cannot carry: OpenUI Lang passes props by
 * position, so a prop the component does not have cannot be written at all.
 * Recorded as not expressible, not as inert.
 */
const NOT_EXPRESSIBLE: Record<string, { techniques: readonly string[]; why: string }> = {
  openui: { techniques: ["proto-key", "identity-attribute"], why: "OpenUI Lang passes props by position: a prop the component does not have cannot be written" },
};
/** A contender has no validation tiers of its own: it is run as it ships. */
const tiersOf = (renderer: string): readonly Tier[] => (CONTENDERS.includes(renderer) ? ["own"] : TIERS);
type Tier = (typeof TIERS)[number] | "own";

export interface AttackResult {
  id: string;
  family: "injection" | "fuzz" | "tricks" | "protocol";
  technique: string;
  renderer: string;
  tier: Tier;
  connector: string;
  outcome: Outcome;
  status: string;
  refused: number;
  errorCode?: string;
  evidence?: Partial<Evidence>;
  /** Protocol cases: the requirement, whether it held, and the numbers it was judged on. */
  requirement?: string;
  passed?: boolean;
  why?: string;
  metrics?: Record<string, number>;
}

// --- One page per renderer and tier -------------------------------------------

interface Session {
  page: Page;
  cdp: CDPSession;
  requests: string[];
  renderer: string;
  close(): Promise<void>;
}

async function open(browser: Browser, server: BenchServer, renderer: string): Promise<Session> {
  const context = await browser.newContext({ viewport: { width: 1280, height: 900 } });
  const page = await context.newPage();
  const requests: string[] = [];
  const origin = new URL(server.url).origin;
  await context.route(
    (url) => url.origin !== origin,
    (route) => {
      requests.push(route.request().url());
      return route.abort();
    },
  );
  page.on("request", (r) => {
    if (r.url().includes(PWN_HOST) && new URL(r.url()).origin === origin) requests.push(r.url());
  });
  const errors: string[] = [];
  page.on("pageerror", (e) => errors.push(String(e)));
  await page.goto(`${server.url}/${renderer}.html?attack`);
  await page.waitForFunction(() => window.__attack?.ready === true, undefined, { timeout: 30_000 }).catch(() => {
    throw new Error(`${renderer}: no attack API (${errors.join("; ")})`);
  });
  const cdp = await context.newCDPSession(page);
  return { page, cdp, requests, renderer, close: () => context.close() };
}

let served = 0;
function route(server: BenchServer, doc: Document): string {
  return server.putStream(`a${served++}`, oursSSE([doc]).join(""));
}

/**
 * What the page reads: a route of this SDK's SSE, or a contender's own wire
 * format as chunks, fed through its page's mount (`../attacks/contender.ts`).
 */
function sourceFor(server: BenchServer, renderer: string, doc: Document): object {
  if (!CONTENDERS.includes(renderer)) return { url: route(server, doc) };
  const encoded = RENDERERS[renderer]!.encode!([doc], "nodes");
  if ("notExpressible" in encoded) throw new Error(`${renderer}: ${encoded.notExpressible}`);
  return { chunks: encoded.chunks };
}

async function runDocument(s: Session, server: BenchServer, doc: Document, tier: Tier): Promise<CaseReport & { requests: string[] }> {
  s.requests.length = 0;
  const setup: AttackSetup = { source: sourceFor(server, s.renderer, doc), validate: tier === "own" ? "full" : tier };
  const report = await s.page.evaluate((setup) => window.__attack.run(setup), setup);
  return { ...report, requests: [...s.requests] };
}

function compact(e: Evidence): Partial<Evidence> | undefined {
  const out: Partial<Evidence> = {};
  for (const k of evidenceKinds(e)) out[k] = e[k].slice(0, 10);
  return Object.keys(out).length ? out : undefined;
}

function result(base: Omit<AttackResult, "outcome" | "status" | "refused" | "evidence">, r: CaseReport & { requests: string[] }): AttackResult {
  const evidence: Evidence = { ...noEvidence(), ...r.evidence, requests: r.requests };
  const ev = compact(evidence);
  return {
    ...base,
    // A hang in this SDK is a denial of service (A1). A contender that never
    // says it finished is judged by the evidence alone.
    outcome: r.timedOut && !CONTENDERS.includes(base.renderer) ? "executed" : classify(evidence, r.refused > 0 || r.status === "error"),
    status: r.status,
    refused: r.refused,
    ...(r.errorCode ? { errorCode: r.errorCode } : {}),
    ...(ev ? { evidence: ev } : {}),
    ...(r.timedOut ? { why: "timed out" } : {}),
  };
}

// --- Protocol requirements --------------------------------------------------------

const RESPONSIVE_MS = 200; // budgets: interaction latency during an abuse case
const FAIL_CLOSED_MS = 1_000; // budgets: time to fail closed after the bad frame

function judge(c: ProtocolCase, r: CaseReport, heap: { idle: number; peak: number }, others: Map<string, CaseReport>): { passed: boolean; why: string } {
  const fails: string[] = [];
  const responsive = () => r.maxFrameGap <= RESPONSIVE_MS || fails.push(`unresponsive: a ${Math.round(r.maxFrameGap)} ms frame gap`);
  const closedFast = () => (r.failClosedMs ?? 0) <= FAIL_CLOSED_MS || fails.push(`failed closed after ${Math.round(r.failClosedMs!)} ms`);
  if (r.timedOut) fails.push("never settled");
  switch (c.requirement) {
    case "refused-intact":
      if (r.status !== "error") fails.push(`not refused (status ${r.status})`);
      else if (r.errorCode !== "stream_malformed") fails.push(`refused as ${r.errorCode}, not stream_malformed`);
      if (r.text.includes("AFTER")) fails.push("the frame after the bad one was applied");
      closedFast();
      break;
    case "truncated":
      if (r.errorCode !== "truncated") fails.push(`ended as ${r.errorCode ?? r.status}, not truncated`);
      closedFast();
      break;
    case "tolerated":
      // Ignored (the document completes) or refused with a stream code.
      if (!(r.status === "complete" || r.errorCode === "stream_malformed" || r.errorCode === "truncated")) fails.push(`ended as ${r.errorCode ?? r.status}`);
      if (c.id !== "keys-unique") responsive();
      break;
    case "bounded":
      if (!(r.status === "error" || heap.peak <= 2 * heap.idle)) fails.push(`heap ${mb(heap.peak)} MB against ${mb(heap.idle)} MB idle, not refused`);
      responsive();
      break;
    case "stoppable":
      if (r.status === "complete") fails.push("completed before stop");
      closedFast();
      responsive();
      break;
    case "refused-before-render":
      if (!(r.status === "error" || r.refused > 0)) fails.push("not refused");
      if (/node-\d|level \d|DEEPEST/.test(r.text)) fails.push("drew part of the document");
      break;
    case "bounded-time": {
      const against = others.get(c.against!);
      if (against && r.ms > 2 * against.ms + 200) fails.push(`${Math.round(r.ms)} ms against ${Math.round(against.ms)} ms with unique keys`);
      break;
    }
    case "no-globals":
      break;
  }
  return { passed: fails.length === 0, why: fails.join("; ") };
}

const mb = (n: number) => Math.round(n / 1_048_576);

async function heapUsed(cdp: CDPSession, gc = false): Promise<number> {
  if (gc) await cdp.send("HeapProfiler.collectGarbage");
  return (await cdp.send("Runtime.getHeapUsage")).usedSize;
}

async function runProtocol(s: Session, renderer: string): Promise<AttackResult[]> {
  const out: AttackResult[] = [];
  const reports = new Map<string, CaseReport>();
  for (const c of PROTOCOL_CASES) {
    s.requests.length = 0;
    const idle = await heapUsed(s.cdp, true);
    let peak = idle;
    let polling = true;
    const poll = (async () => {
      while (polling) {
        peak = Math.max(peak, await heapUsed(s.cdp).catch(() => 0));
        await new Promise((r) => setTimeout(r, 50));
      }
    })();
    const r = await s.page.evaluate((id) => window.__attack.protocol(id), c.id);
    polling = false;
    await poll;
    reports.set(c.id, r);
    const heap = { idle, peak };
    const { passed, why } = judge(c, r, heap, reports);
    const base = result({ id: `protocol.${c.id}`, family: "protocol", technique: c.id, renderer, tier: "full", connector: "base+kit" }, { ...r, requests: [...s.requests] });
    out.push({
      ...base,
      requirement: c.requirement,
      passed: passed && base.outcome !== "executed",
      ...(why ? { why } : {}),
      metrics: {
        ms: Math.round(r.ms),
        maxFrameGapMs: Math.round(r.maxFrameGap),
        heapIdleMB: mb(idle),
        heapPeakMB: mb(peak),
        ...(r.failClosedMs !== undefined ? { failClosedMs: Math.round(r.failClosedMs) } : {}),
      },
    });
    const last = out.at(-1)!;
    console.log(`${renderer.padEnd(18)} protocol ${c.id.padEnd(18)} ${last.passed ? "pass" : "FAIL"}  ${last.errorCode ?? last.status}${why ? `  (${why})` : ""}`);
  }
  return out;
}

// --- Self-test (T-440) --------------------------------------------------------------

async function selfTest(browser: Browser, server: BenchServer): Promise<boolean> {
  const byId = (id: string) => CORPUS.find((p) => p.id === id)!;
  const t = tricks();
  // A case for each evidence kind the unsafe page must show.
  const cases: { kind: keyof Evidence; doc: Document }[] = [
    { kind: "canary", doc: placedDocument(byId("event-handler.img")) },
    { kind: "policy", doc: placedDocument(byId("event-handler.img")) },
    { kind: "dom", doc: placedDocument(byId("policy-bypass.base")) },
    { kind: "requests", doc: placedDocument(byId("policy-bypass.image")) },
    { kind: "globals", doc: t.find((x) => x.id === "proto-key.props")!.document },
    { kind: "bounds", doc: t.find((x) => x.id === "identity.props")!.document },
  ];
  let ok = true;
  for (const renderer of ["attack-unsafe", "ours-element"]) {
    const s = await open(browser, server, renderer);
    await s.page.evaluate((setup) => window.__attack.baseline(setup), { source: { url: route(server, baselineDocument()) }, validate: "full" } as AttackSetup);
    for (const c of cases) {
      const r = await runDocument(s, server, c.doc, "full");
      const evidence: Evidence = { ...noEvidence(), ...r.evidence, requests: r.requests };
      const outcome = classify(evidence, r.refused > 0);
      const want = renderer === "attack-unsafe" ? evidence[c.kind].length > 0 : outcome !== "executed";
      ok &&= want;
      console.log(`${renderer.padEnd(14)} ${c.kind.padEnd(9)} ${want ? "ok  " : "MISS"} ${outcome}${evidence[c.kind].length ? `: ${evidence[c.kind][0]!.slice(0, 100)}` : ""}`);
    }
    await s.close();
  }
  return ok;
}

// --- Main ---------------------------------------------------------------------------

const server = await startServer(join(here, "..", "..", "dist"));
const browser = await chromium.launch();

if (flag("self-test")) {
  const ok = await selfTest(browser, server);
  await browser.close();
  await server.close();
  console.log(ok ? "attack self-test passed" : "attack self-test FAILED");
  process.exit(ok ? 0 : 1);
}

const renderers = arg("renderer")?.split(",") ?? [...OURS, ...CONTENDERS];
const suites = new Set(arg("suite")?.split(",") ?? ["injection", "fuzz", "tricks", "protocol"]);
const seed = Number(arg("seed") ?? Math.floor(Date.now() / 86_400_000));
const fuzzCount = Number(arg("fuzz") ?? 100);
const fuzzed = suites.has("fuzz") ? fuzzCorpus(seed, fuzzCount) : [];

const results: AttackResult[] = [];
const notExpressible: { renderer: string; id: string; why: string }[] = [];
for (const renderer of renderers) {
  for (const tier of tiersOf(renderer)) {
    const s = await open(browser, server, renderer);
    // Twice: a framework's first mount defines its own globals (Vue's flags).
    // The second is the baseline, and must be clean.
    const benign = () => ({ source: sourceFor(server, renderer, baselineDocument()), validate: tier === "own" ? "full" : tier }) as AttackSetup;
    await s.page.evaluate((setup) => window.__attack.baseline(setup), benign());
    s.requests.length = 0;
    const base = await s.page.evaluate((setup) => window.__attack.baseline(setup), benign());
    const noise = evidenceKinds({ ...noEvidence(), ...base.evidence, requests: [...s.requests] });
    if (noise.length || base.status !== "complete" || base.refused) {
      throw new Error(`${renderer} ${tier}: the benign document is not clean (${base.status}, ${base.refused} refused, ${noise.join(", ")}): ${JSON.stringify(base.evidence)}`);
    }
    const run = async (family: AttackResult["family"], id: string, technique: string, doc: Document) => {
      const r = await runDocument(s, server, doc, tier);
      results.push(result({ id, family, technique, renderer, tier, connector: connectorOf(renderer) }, r));
    };
    const payloads: [AttackResult["family"], Payload][] = [
      ...(suites.has("injection") ? CORPUS.map((p) => ["injection", p] as [AttackResult["family"], Payload]) : []),
      ...fuzzed.map((p) => ["fuzz", p] as [AttackResult["family"], Payload]),
    ];
    for (const [family, p] of payloads) await run(family, p.id, p.technique, placedDocument(p));
    if (suites.has("tricks")) {
      for (const t of tricks()) {
        const skip = NOT_EXPRESSIBLE[renderer];
        if (skip?.techniques.includes(t.technique)) notExpressible.push({ renderer, id: t.id, why: skip.why });
        else await run("tricks", t.id, t.technique, t.document);
      }
    }
    const mine = results.filter((r) => r.renderer === renderer && r.tier === tier);
    const count = (o: Outcome) => mine.filter((r) => r.outcome === o).length;
    // A run's log may be public (CI): a contender's findings are not printed (FR-435).
    if (CONTENDERS.includes(renderer)) {
      const executed = mine.filter((r) => r.outcome === "executed");
      const through = executed.filter((r) => passedThrough(r.evidence)).length;
      const held = executed.length > through;
      console.log(
        `${renderer.padEnd(18)} ${tier.padEnd(6)} ${mine.length} cases run${
          held ? "; results held privately (FR-435)" : `: ${count("blocked")} blocked, ${count("inert")} inert, ${through} executed (a URL passed unchecked to the app's link)`
        }`,
      );
    } else {
      console.log(`${renderer.padEnd(18)} ${tier.padEnd(6)} ${mine.length} cases: ${count("blocked")} blocked, ${count("inert")} inert, ${count("executed")} executed`);
      for (const r of mine.filter((r) => r.outcome === "executed")) console.log(`  EXECUTED ${r.id}: ${JSON.stringify(r.evidence).slice(0, 300)}`);
    }
    if (tier === "full" && suites.has("protocol") && PROTOCOL_HOSTS.has(renderer)) results.push(...(await runProtocol(s, renderer)));
    await s.close();
  }
}

const env = environment(browser);
await browser.close();
await server.close();

// Invariant A1: only this SDK fails the run.
const failures = results.filter((r) => !CONTENDERS.includes(r.renderer) && (r.outcome === "executed" || r.passed === false));
const date = new Date().toISOString().slice(0, 10);
const out = arg("out") ?? join(here, "..", "..", "results", `attacks-${date}.json`);
const gated = disclosureGate(results, (r) => CONTENDERS.includes(r));
mkdirSync(dirname(out), { recursive: true });
writeFileSync(
  out,
  JSON.stringify(
    {
      schemaVersion: 1,
      environment: env,
      fuzz: { seed, count: fuzzCount },
      ...(notExpressible.length ? { notExpressible } : {}),
      ...(gated.withheld ? { withheld: { contenders: gated.withheld, until: gated.until, why: `FR-435: held privately for ${EMBARGO_DAYS} days` } } : {}),
      attacks: gated.published,
    },
    null,
    2,
  ) + "\n",
);
if (gated.embargoed.length) {
  const secret = join(here, "..", "..", "results", "private", `attacks-embargoed-${date}.json`);
  mkdirSync(dirname(secret), { recursive: true });
  writeFileSync(secret, JSON.stringify({ schemaVersion: 1, found: date, until: gated.until, environment: env, attacks: gated.embargoed }, null, 2) + "\n");
  console.log(`${gated.withheld} contender(s) withheld under embargo until ${gated.until}; their results are in ${secret} (untracked)`);
}
console.log(`\n${results.length} cases, ${failures.length} failing; written to ${out}`);
process.exit(failures.length ? 1 : 0);
