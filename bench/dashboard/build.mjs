/**
 * `pnpm bench:dashboard` — the static dashboard (T-452, plan D8): one HTML
 * file built from the newest committed result of each kind, with no server.
 * Break points, ladder curves, desktop against phone, cold start, soak trends,
 * attack outcomes and the red-team; every figure names its workload and the
 * command that reproduces it.
 *
 *   node --experimental-strip-types dashboard/build.mjs [--results dir] [--out file]
 *
 * Results are read, reduced to what the page draws and inlined; the page's
 * script and styles are inlined too, so the file opens from disk.
 */
import { mkdirSync, readdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { RENDERERS } from "../src/runner/renderers.ts";
import { judgeSoak, SOAK_BUDGET } from "../src/soak.ts";
import { LADDERS } from "../src/workloads/ladders.ts";

const here = dirname(fileURLToPath(import.meta.url));
const arg = (name) => {
  const i = process.argv.indexOf(`--${name}`);
  return i === -1 ? undefined : process.argv[i + 1];
};
const resultsDir = arg("results") ?? join(here, "..", "results");
const out = arg("out") ?? join(here, "dist", "index.html");

/** The newest `<kind>-<date>.json`, by the date in its name. */
function newest(kind) {
  const files = readdirSync(resultsDir)
    .filter((f) => new RegExp(`^${kind}-\\d{4}-\\d{2}-\\d{2}\\.json$`).test(f))
    .sort();
  const file = files.at(-1);
  return file ? { file, data: JSON.parse(readFileSync(join(resultsDir, file), "utf8")) } : undefined;
}

const BUDGETS = { frameP95: 25, longestTask: 50, interaction: 200 };
const METRICS = ["frameP95", "longestTask", "interaction", "complete"];

function compare() {
  const r = newest("compare");
  if (!r) return undefined;
  const c = r.data;
  return {
    file: r.file,
    environment: c.environment,
    workloads: c.workloads.map((w) => {
      const l = LADDERS.find((x) => x.id === w.id);
      return { id: w.id, steps: w.steps, seed: w.seed, ...(l ? { frames: l.frames, rate: l.rate } : {}) };
    }),
    ladders: c.ladders.map((l) => ({
      renderer: l.renderer,
      profile: l.profile,
      workload: l.workload,
      expressible: l.expressible,
      breakPoint: l.breakPoint,
      ...(l.brokenBy ? { brokenBy: l.brokenBy } : {}),
      steps: l.steps.map((s) => ({
        size: s.size,
        ...Object.fromEntries(METRICS.filter((m) => s.metrics[m]).map((m) => [m, Math.round(s.metrics[m].median * 10) / 10])),
        ...(s.broken ? { broken: s.broken } : {}),
      })),
    })),
    coldStart: (c.coldStart ?? []).map((s) => ({
      renderer: s.renderer,
      profile: s.profile,
      firstNode: Math.round(s.metrics.firstNode.median),
      complete: Math.round(s.metrics.complete.median),
      longestTask: Math.round(s.metrics.longestTask.median),
    })),
  };
}

function soak() {
  const r = newest("soak");
  if (!r) return undefined;
  return {
    file: r.file,
    runs: r.data.soak.map((s) => ({
      renderer: s.renderer,
      minutes: s.minutes,
      passed: s.passed,
      // The soak's own judgement (median of the last window over the first), so the page cannot disagree with it.
      verdict: judgeSoak(s.series, s.detachedStart, s.detachedEnd),
      windowStart: SOAK_BUDGET.window,
      detachedStart: s.detachedStart,
      detachedEnd: s.detachedEnd,
      series: s.series.map((p) => ({ minute: Math.round(p.minute * 10) / 10, heap: p.heap, domNodes: p.domNodes, listeners: p.listeners, ...(p.mounted !== undefined ? { mounted: p.mounted } : {}) })),
    })),
  };
}

function attacks() {
  const r = newest("attacks");
  if (!r) return undefined;
  const a = r.data;
  const rows = new Map();
  for (const x of a.attacks) {
    if (x.family === "protocol") continue;
    const key = `${x.renderer}|${x.tier}`;
    const row = rows.get(key) ?? { renderer: x.renderer, tier: x.tier, connector: x.connector, blocked: 0, inert: 0, executed: 0, passedThrough: 0 };
    row[x.outcome]++;
    if (x.cause === "passed-through-unchecked") row.passedThrough++;
    rows.set(key, row);
  }
  const protocol = a.attacks.filter((x) => x.family === "protocol");
  return {
    file: r.file,
    fuzz: a.fuzz,
    rows: [...rows.values()],
    protocol: { cases: protocol.length, passed: protocol.filter((x) => x.passed).length },
    notExpressible: a.notExpressible ?? [],
    ...(a.withheld ? { withheld: a.withheld } : {}),
  };
}

function redteam() {
  const r = newest("redteam");
  if (!r) return undefined;
  const t = r.data;
  if (!t.summary) return { file: r.file, skipped: true };
  const runs = t.runs ?? [];
  return {
    file: r.file,
    models: t.models,
    runsPerPrompt: t.runsPerPrompt,
    total: runs.length,
    attempts: runs.filter((x) => x.attempt?.length).length,
    leaks: runs.filter((x) => x.outcome === "executed").length,
    summary: t.summary.map((s) => ({ model: s.model, prompt: s.prompt, aim: s.aim, attemptRate: s.attemptRate, leakRate: s.leakRate, completed: s.completed, runs: s.runs })),
  };
}

/** Each renderer's packages: what the result file recorded, else the bench's registry (FR-452). */
function versions(c) {
  const recorded = Object.fromEntries((c?.renderers ?? []).map((r) => [r.id, r.packages]));
  return Object.fromEntries(Object.entries(RENDERERS).map(([id, info]) => [id, recorded[id] ?? info.packages]));
}

const comparison = compare();
const data = {
  generated: new Date().toISOString(),
  budgets: BUDGETS,
  compare: comparison,
  versions: versions(newest("compare")?.data),
  soak: soak(),
  attacks: attacks(),
  redteam: redteam(),
};

// `</` inside inlined JSON would end the script element.
const json = JSON.stringify(data).replace(/</g, "\\u003c");
const template = readFileSync(join(here, "template.html"), "utf8");
const page = template
  .replace("/*STYLE*/", () => readFileSync(join(here, "style.css"), "utf8"))
  .replace("/*DATA*/", () => json)
  .replace("/*APP*/", () => readFileSync(join(here, "app.js"), "utf8"));
mkdirSync(dirname(out), { recursive: true });
writeFileSync(out, page);
console.log(`dashboard written to ${out} (${Math.round(page.length / 1024)} KB)`);
