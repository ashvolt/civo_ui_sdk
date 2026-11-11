/**
 * `pnpm bench:soak` — keeps replacing and patching documents in one mounted
 * renderer, and samples memory at the same point each time (FR-415, T-421).
 *
 *   --minutes 30             default 30
 *   --sample-every 60        seconds between samples, default 60
 *   --renderer a,b           default: every renderer with a page
 *   --out path.json          default: bench/results/soak-<date>.json
 *
 * Each sample: pause when document 0 is complete, force garbage collection,
 * read the heap, DOM nodes, listeners and mounted framework components, then
 * resume. Detached DOM nodes are counted from a heap snapshot at the start and
 * the end only (research R2).
 */
import { mkdirSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { chromium, type Browser, type CDPSession } from "@playwright/test";
import { BUDGET_VERSION } from "../budgets.ts";
import type { SoakPause } from "../probe/page.ts";
import { resultSchema, type ResultFile } from "../results.ts";
import { countDetached, judgeSoak, type SoakSample, type SoakVerdict } from "../soak.ts";
import { SOAK_RATE, soakDocuments } from "../workloads/soak.ts";
import { oursSSE } from "./encode.ts";
import { environment } from "./environment.ts";
import { RENDERERS } from "./renderers.ts";
import { startServer, type BenchServer } from "./server.ts";
import { PROFILES } from "./step.ts";

export interface SoakOptions {
  page: string;
  /** Total length of the soak. */
  durationMs: number;
  sampleEveryMs: number;
  log?: (line: string) => void;
}

export interface SoakRun {
  series: SoakSample[];
  detachedStart: number;
  detachedEnd: number;
  verdict: SoakVerdict;
}

/** Puts the soak's documents on the server, once per server. */
export function putSoak(server: BenchServer): string {
  const documents = soakDocuments().map((frames) => ({ chunks: oursSSE(frames), final: frames.at(-1) }));
  return server.put("soak", { documents, rateMs: 1000 / SOAK_RATE });
}

async function detached(cdp: CDPSession): Promise<number> {
  const chunks: string[] = [];
  const collect = (e: { chunk: string }) => void chunks.push(e.chunk);
  cdp.on("HeapProfiler.addHeapSnapshotChunk", collect);
  await cdp.send("HeapProfiler.enable");
  await cdp.send("HeapProfiler.collectGarbage");
  await cdp.send("HeapProfiler.takeHeapSnapshot", { reportProgress: false });
  cdp.off("HeapProfiler.addHeapSnapshotChunk", collect);
  return countDetached(JSON.parse(chunks.join("")));
}

export async function runSoak(browser: Browser, server: BenchServer, dataUrl: string, opts: SoakOptions): Promise<SoakRun> {
  const profile = PROFILES.desktop;
  const context = await browser.newContext({ viewport: profile.viewport, deviceScaleFactor: profile.deviceScaleFactor });
  const page = await context.newPage();
  const errors: string[] = [];
  page.on("pageerror", (e) => errors.push(String(e)));
  const cdp = await context.newCDPSession(page);
  try {
    await page.goto(`${server.url}/${opts.page}`);
    await page.waitForFunction(() => window.__bench?.ready === true);
    await page.evaluate((url) => window.__bench.soak.start(url), dataUrl);

    const started = Date.now();
    const sample = async (): Promise<SoakSample> => {
      const pause = (await page.evaluate(() => window.__bench.soak.pause())) as SoakPause;
      await cdp.send("HeapProfiler.collectGarbage");
      const heap = (await cdp.send("Runtime.getHeapUsage")) as { usedSize: number };
      const counters = (await cdp.send("Memory.getDOMCounters")) as { nodes: number; jsEventListeners: number };
      const s: SoakSample = {
        minute: Math.round(((Date.now() - started) / 60_000) * 100) / 100,
        heap: heap.usedSize,
        domNodes: counters.nodes,
        listeners: counters.jsEventListeners,
        ...(pause.mounted !== undefined ? { mounted: pause.mounted } : {}),
        ...(pause.expectedMounted !== undefined ? { expectedMounted: pause.expectedMounted } : {}),
      };
      return s;
    };

    // Sample 0 after the first cycle, with the detached count beside it.
    const series: SoakSample[] = [await sample()];
    const detachedStart = await detached(cdp);
    await page.evaluate(() => window.__bench.soak.resume());
    opts.log?.(`  ${fmt(series[0]!)}  detached ${detachedStart}`);

    let next = started + opts.sampleEveryMs;
    while (next <= started + opts.durationMs) {
      await new Promise((r) => setTimeout(r, Math.max(0, next - Date.now())));
      const s = await sample();
      series.push(s);
      opts.log?.(`  ${fmt(s)}`);
      if (next + opts.sampleEveryMs > started + opts.durationMs) break;
      await page.evaluate(() => window.__bench.soak.resume());
      next += opts.sampleEveryMs;
    }
    const detachedEnd = await detached(cdp);
    await page.evaluate(() => window.__bench.soak.stop());
    if (errors.length) throw new Error(`page error during the soak: ${errors[0]}`);
    return { series, detachedStart, detachedEnd, verdict: judgeSoak(series, detachedStart, detachedEnd) };
  } finally {
    await context.close();
  }
}

function fmt(s: SoakSample): string {
  const mounted = s.mounted !== undefined ? `, mounted ${s.mounted}/${s.expectedMounted}` : "";
  return `minute ${s.minute.toFixed(2).padStart(5)}: heap ${(s.heap / 1e6).toFixed(2)} MB, DOM nodes ${s.domNodes}, listeners ${s.listeners}${mounted}`;
}

export function describeVerdict(v: SoakVerdict): string {
  const pct = (x: number) => `${(x * 100).toFixed(1)}%`;
  return (
    `${v.passed ? "PASSED" : `BROKEN (${v.broken.join(", ")})`}: heap ${pct(v.heapGrowth)}, DOM nodes ${v.domNodeGrowth >= 0 ? "+" : ""}${v.domNodeGrowth}, ` +
    `listeners ${v.listenerGrowth >= 0 ? "+" : ""}${v.listenerGrowth}, detached ${v.detachedGrowth >= 0 ? "+" : ""}${v.detachedGrowth}`
  );
}

// --- command line -------------------------------------------------------------

const isMain = process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1];
if (isMain) {
  const here = dirname(fileURLToPath(import.meta.url));
  const root = join(here, "..", "..");
  const arg = (name: string) => {
    const i = process.argv.indexOf(`--${name}`);
    return i === -1 ? undefined : process.argv[i + 1];
  };
  const minutes = Number(arg("minutes") ?? 30);
  const sampleEvery = Number(arg("sample-every") ?? 60);
  const renderers = arg("renderer")?.split(",").filter(Boolean) ?? Object.keys(RENDERERS);

  const server = await startServer(join(root, "dist"));
  const browser = await chromium.launch();
  const dataUrl = putSoak(server);
  const result: ResultFile = {
    schemaVersion: 1,
    budgetVersion: BUDGET_VERSION,
    suite: "local",
    environment: environment(browser),
    renderers: renderers.map((id) => ({ id, packages: RENDERERS[id]?.packages ?? {}, available: id in RENDERERS })),
    workloads: [],
    ladders: [],
    soak: [],
    attacks: [],
  };
  let failed = 0;
  try {
    for (const id of renderers) {
      const r = RENDERERS[id];
      if (!r) {
        console.error(`unknown renderer ${id}`);
        continue;
      }
      console.log(`${id}: soaking ${minutes} min, a sample every ${sampleEvery} s`);
      const run = await runSoak(browser, server, dataUrl, {
        page: r.page,
        durationMs: minutes * 60_000,
        sampleEveryMs: sampleEvery * 1000,
        log: (line) => console.log(line),
      });
      if (!run.verdict.passed) failed++;
      console.log(`${id}: ${describeVerdict(run.verdict)}`);
      result.soak!.push({
        renderer: id,
        minutes,
        series: run.series,
        detachedStart: run.detachedStart,
        detachedEnd: run.detachedEnd,
        passed: run.verdict.passed,
      });
    }
  } finally {
    await browser.close();
    await server.close();
  }
  const checked = resultSchema.parse(result);
  const out = arg("out") ?? join(root, "results", `soak-${checked.environment.date.slice(0, 10)}.json`);
  mkdirSync(dirname(out), { recursive: true });
  writeFileSync(out, `${JSON.stringify(checked, null, 1)}\n`);
  console.log(`\nwrote ${out}`);
  if (failed) process.exitCode = 1;
}
