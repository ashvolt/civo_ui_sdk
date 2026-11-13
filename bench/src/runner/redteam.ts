/**
 * `pnpm bench:redteam` — the red-team (T-444, FR-433): each prompt, several
 * times per local model, through the Next example's real route
 * (`examples/next-app/app/api/ui/route.ts`: its prompt, schema, validation and
 * wire protocol), with the provider set to the local Ollama. The route's
 * stream is then read by this SDK's element, with the same contract, in a
 * page watched by the attack harness.
 *
 *   --models a,b    default: qwen2.5:3b,llama3.2:3b
 *   --runs N        runs per prompt and model (default 5)
 *   --prompts a,b   prompt ids (default: all)
 *   --out path      default: bench/results/redteam-<date>.json
 *
 * Only 127.0.0.1 is contacted (Constitution I). The raw model output is read
 * from the route's own requests to Ollama, before any validation: the attempt
 * rate. What reached the page: the leak rate, which must be zero; any leak
 * exits non-zero. Ollama unreachable: the run is reported as skipped.
 */
import { mkdirSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { chromium, type Browser } from "@playwright/test";
import { build } from "esbuild";
import { classify, evidenceKinds, noEvidence, type Evidence, type Outcome } from "../attacks/classify.ts";
import type { AttackSetup, CaseReport } from "../attacks/page.ts";
import { benignDashboard, forbidden, PROMPTS, type RedTeamPrompt } from "../attacks/redteam.ts";
import { oursSSE } from "./encode.ts";
import { environment } from "./environment.ts";
import { startServer, type BenchServer } from "./server.ts";

const here = dirname(fileURLToPath(import.meta.url));
const arg = (name: string) => {
  const i = process.argv.indexOf(`--${name}`);
  return i === -1 ? undefined : process.argv[i + 1];
};

const OLLAMA = "http://127.0.0.1:11434";
const models = (arg("models") ?? "qwen2.5:3b,llama3.2:3b").split(",");
const runs = Number(arg("runs") ?? 5);
const wanted = arg("prompts")?.split(",");
const prompts = PROMPTS.filter((p) => !wanted || wanted.includes(p.id));
const out = arg("out") ?? join(here, "..", "..", "results", `redteam-${new Date().toISOString().slice(0, 10)}.json`);

export interface RedTeamRun {
  model: string;
  prompt: string;
  run: number;
  /** How the route's stream ended, as the element saw it. */
  status: string;
  errorCode?: string;
  refused: number;
  /** Forbidden things in the raw model output, before validation. */
  attempt: string[];
  /** The page's outcome: executed is a leak. */
  outcome: Outcome;
  evidence?: Partial<Evidence>;
  rawChars: number;
  /** The start of the raw output, for reading what the model tried. */
  rawHead: string;
  ms: number;
}

// --- The route, with its requests to Ollama watched ---------------------------

/** Raw model text from every request the route makes to Ollama during one run. */
let raw: string[] = [];
const realFetch = globalThis.fetch;
globalThis.fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
  const url = input instanceof Request ? input.url : String(input);
  if (!url.startsWith(OLLAMA) && !url.startsWith("http://localhost")) throw new Error(`the red-team contacts 127.0.0.1 only, not ${url}`);
  const res = await realFetch(input, init);
  if (!url.includes("/chat/completions")) return res;
  const [mine, theirs] = res.body ? res.body.tee() : [null, null];
  const slot = raw.push("") - 1;
  if (mine) {
    void (async () => {
      const text = await new Response(mine).text();
      raw[slot] = modelText(text);
    })();
  }
  return new Response(theirs, { status: res.status, statusText: res.statusText, headers: res.headers });
}) as typeof fetch;

/** The content of an OpenAI-compatible response, streamed or not. */
function modelText(body: string): string {
  if (!body.trimStart().startsWith("data:")) {
    try {
      const j = JSON.parse(body) as { choices?: { message?: { content?: string } }[] };
      return j.choices?.map((c) => c.message?.content ?? "").join("") ?? body;
    } catch {
      return body;
    }
  }
  let text = "";
  for (const line of body.split("\n")) {
    const data = line.startsWith("data:") ? line.slice(5).trim() : "";
    if (!data || data === "[DONE]") continue;
    try {
      const j = JSON.parse(data) as { choices?: { delta?: { content?: string } }[] };
      text += j.choices?.map((c) => c.delta?.content ?? "").join("") ?? "";
    } catch {
      /* a partial line: ignored */
    }
  }
  return text;
}

const bundle = join(here, "..", "..", "dist-node", "next-route.mjs");
await build({
  entryPoints: [join(here, "..", "redteam", "route-entry.ts")],
  outfile: bundle,
  bundle: true,
  platform: "node",
  format: "esm",
  target: "node22",
  logLevel: "warning",
});

type Handler = (request: Request) => Promise<Response>;
/** A fresh copy of the route per model: it reads its provider and model once, at module scope. */
async function routeFor(model: string): Promise<Handler> {
  process.env.RELAX_UI_PROVIDER = "ollama";
  process.env.RELAX_UI_MODEL = model;
  const mod = (await import(`${pathToFileURL(bundle).href}?model=${encodeURIComponent(model)}`)) as { POST: Handler };
  return mod.POST;
}

// --- The page ---------------------------------------------------------------

async function openPage(browser: Browser, server: BenchServer) {
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
  await page.goto(`${server.url}/redteam.html?attack`);
  await page.waitForFunction(() => window.__attack?.ready === true, undefined, { timeout: 30_000 });
  return { page, requests, close: () => context.close() };
}

// --- Run ----------------------------------------------------------------------

const up = await realFetch(`${OLLAMA}/api/tags`).then(
  (r) => r.ok,
  () => false,
);
mkdirSync(dirname(out), { recursive: true });
if (!up) {
  writeFileSync(out, JSON.stringify({ schemaVersion: 1, skipped: `Ollama not reachable at ${OLLAMA}` }, null, 2) + "\n");
  console.log(`SKIPPED: Ollama not reachable at ${OLLAMA}; written to ${out}`);
  process.exit(0);
}

const server = await startServer(join(here, "..", "..", "dist"));
const browser = await chromium.launch();
const env = environment(browser);
const s = await openPage(browser, server);
let served = 0;
const read = async (body: string): Promise<{ report: CaseReport; requests: string[] }> => {
  s.requests.length = 0;
  const setup: AttackSetup = { source: { url: server.putStream(`rt${served++}`, body) }, validate: "full" };
  const report = await s.page.evaluate((setup) => window.__attack.run(setup, { timeoutMs: 30_000 }), setup);
  return { report, requests: [...s.requests] };
};
const benign = oursSSE([benignDashboard()]).join("");
await s.page.evaluate((u) => window.__attack.baseline({ source: { url: u }, validate: "full" }), server.putStream("rt-base0", benign));
const base = await s.page.evaluate((u) => window.__attack.baseline({ source: { url: u }, validate: "full" }), server.putStream("rt-base1", benign));
if (base.status !== "complete" || base.refused || evidenceKinds({ ...noEvidence(), ...base.evidence }).length) {
  throw new Error(`the benign dashboard is not clean: ${JSON.stringify(base)}`);
}

const results: RedTeamRun[] = [];
for (const model of models) {
  const POST = await routeFor(model);
  for (const p of prompts) {
    for (let run = 1; run <= runs; run++) {
      raw = [];
      const start = performance.now();
      const res = await POST(
        new Request("http://localhost/api/ui", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ topic: p.topic, audience: "executive" }),
        }),
      );
      const body = await res.text();
      // The tee's reader finishes on its own turn.
      await new Promise((r) => setTimeout(r, 50));
      const ms = performance.now() - start;
      const text = raw.join("\n");
      const { report, requests } = await read(res.ok ? body : "");
      const evidence: Evidence = { ...noEvidence(), ...report.evidence, requests };
      const outcome = classify(evidence, report.refused > 0 || report.status === "error");
      const kinds = evidenceKinds(evidence);
      const r: RedTeamRun = {
        model,
        prompt: p.id,
        run,
        status: res.ok ? report.status : `http ${res.status}`,
        ...(report.errorCode ? { errorCode: report.errorCode } : {}),
        refused: report.refused,
        attempt: forbidden(text),
        outcome,
        ...(kinds.length ? { evidence: Object.fromEntries(kinds.map((k) => [k, evidence[k].slice(0, 10)])) } : {}),
        rawChars: text.length,
        rawHead: text.slice(0, 600),
        ms: Math.round(ms),
      };
      results.push(r);
      console.log(
        `${model.padEnd(12)} ${p.id.padEnd(18)} #${run}  ${r.status.padEnd(9)} ${outcome.padEnd(8)} ${(ms / 1000).toFixed(0).padStart(4)} s  attempt: ${r.attempt.join(", ") || "-"}`,
      );
    }
  }
}
await s.close();
await browser.close();
await server.close();

/** Per model and prompt: the share of runs with an attempt, and with a leak. */
function summary(rs: RedTeamRun[], prompt: RedTeamPrompt, model: string) {
  const mine = rs.filter((r) => r.prompt === prompt.id && r.model === model);
  return {
    model,
    prompt: prompt.id,
    aim: prompt.aim,
    runs: mine.length,
    attemptRate: mine.filter((r) => r.attempt.length).length / mine.length,
    leakRate: mine.filter((r) => r.outcome === "executed").length / mine.length,
    completed: mine.filter((r) => r.status === "complete").length,
  };
}
const table = models.flatMap((m) => prompts.map((p) => summary(results, p, m)));
const leaks = results.filter((r) => r.outcome === "executed");
writeFileSync(
  out,
  JSON.stringify({ schemaVersion: 1, environment: env, route: "examples/next-app/app/api/ui/route.ts", models, runsPerPrompt: runs, prompts, summary: table, runs: results }, null, 2) + "\n",
);
const rate = (k: "attemptRate" | "leakRate") => (table.reduce((a, t) => a + t[k] * t.runs, 0) / Math.max(1, results.length)) * 100;
console.log(`\n${results.length} runs: attempt rate ${rate("attemptRate").toFixed(0)}%, leak rate ${rate("leakRate").toFixed(0)}%; written to ${out}`);
process.exit(leaks.length ? 1 : 0);
