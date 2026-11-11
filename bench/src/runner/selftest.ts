/**
 * `pnpm bench:selftest` — the harness proves itself before any result is
 * trusted (T-404, T-408, plan Verification "Ladder correctness").
 *
 * Six renderers on one small step. Each must be classified as stated, or
 * this exits non-zero:
 *   ok     → passes every budget
 *   slow   → breaks on longestTask (80 ms busy per frame)
 *   wrong  → breaks on correctness (a node dropped)
 *   hang   → breaks on timeout
 *   warm   → passes: a long frame in the warm-up is not the run's
 *   phone  → passes: the smallest step, on the phone profile
 *
 * Then the heavy visuals (spec scenario 5): this SDK's element draws a small
 * step of each correctly, and its counters animate unless the reader asks for
 * reduced motion.
 *
 * Last, the soak's detection (T-420), in 30-second soaks: a steady page
 * passes; a page that leaks a listener per document breaks on listeners; one
 * that keeps each replaced document breaks on detached DOM.
 */
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { chromium } from "@playwright/test";
import { summarise, type Sample } from "../budgets.ts";
import { framesFor, warmupDocument } from "../workloads/generator.ts";
import { LADDERS, planStep } from "../workloads/ladders.ts";
import { oursSSE } from "./encode.ts";
import type { SoakBreak } from "../soak.ts";
import { startServer } from "./server.ts";
import { describeVerdict, putSoak, runSoak } from "./soak.ts";
import { runOnce } from "./step.ts";

const root = join(dirname(fileURLToPath(import.meta.url)), "..", "..");
const expected: Record<string, string | undefined> = {
  ok: undefined,
  slow: "longestTask",
  wrong: "correctness",
  hang: "timeout",
  warm: undefined,
  // The smallest step on the phone profile, after a warm-up, with the
  // half-way click: a frame stretched by the driver's input is not a long task.
  phone: undefined,
};

const server = await startServer(join(root, "dist"));
const browser = await chromium.launch();
const step = planStep(LADDERS.find((l) => l.id === "nodes")!, 100);
const frames = framesFor(step);
const dataUrl = server.put("selftest", { chunks: oursSSE(frames), final: frames.at(-1), rateMs: 1000 / step.rate });
// The same step after a warm-up document, as the ladders run it.
const warmUrl = server.put("selftest-warm", { chunks: oursSSE(frames), final: frames.at(-1), rateMs: 1000 / step.rate, warmup: oursSSE([warmupDocument()]) });
const tiny = framesFor(planStep(LADDERS.find((l) => l.id === "nodes")!, 10));
const phoneUrl = server.put("selftest-phone", { chunks: oursSSE(tiny), final: tiny.at(-1), rateMs: 1000 / step.rate, warmup: oursSSE([warmupDocument()]) });

let failed = 0;
try {
  for (const [mode, want] of Object.entries(expected)) {
    const samples: Sample[] = [];
    for (let i = 0; i < 3; i++) {
      const s = await runOnce(browser, server, {
        page: `selftest.html?mode=${mode === "phone" ? "ok" : mode}`,
        dataUrl: mode === "warm" ? warmUrl : mode === "phone" ? phoneUrl : dataUrl,
        profile: mode === "phone" ? "phone" : "desktop",
        timeoutMs: mode === "hang" ? 5_000 : 30_000,
      });
      samples.push(s);
      if (s.timedOut) break;
    }
    const got = summarise(samples).broken;
    const ok = got === want;
    if (!ok) failed++;
    console.log(`${ok ? "PASS" : "FAIL"}  ${mode.padEnd(6)} expected ${want ?? "no break"}, got ${got ?? "no break"}${samples[0]?.detail ? `  (${samples[0].detail})` : ""}${samples[0]?.error ? `  [${samples[0].error}]` : ""}`);
  }

  for (const id of ["heatmap-cells", "scatter-points", "sparklines", "counters"] as const) {
    const ladder = LADDERS.find((l) => l.id === id)!;
    const heavy = framesFor(planStep(ladder, ladder.steps[1]!));
    const url = server.put(`selftest-${id}`, { chunks: oursSSE(heavy), final: heavy.at(-1), rateMs: 1000 / ladder.rate });
    const s = await runOnce(browser, server, { page: "ours-element.html", dataUrl: url, profile: "desktop" });
    const got = summarise([s]).broken;
    // Timing is the ladders' business; here only whether it drew, and drew right.
    const ok = got === undefined || got === "frameP95" || got === "longestTask";
    if (!ok) failed++;
    console.log(`${ok ? "PASS" : "FAIL"}  ${id.padEnd(14)} drawn correctly${ok ? "" : `: ${got}${s.detail ? ` (${s.detail})` : ""}${s.error ? ` [${s.error}]` : ""}`}`);
  }

  const counters = framesFor(planStep(LADDERS.find((l) => l.id === "counters")!, 10));
  const motionUrl = server.put("selftest-motion", { chunks: oursSSE(counters), final: counters.at(-1), rateMs: 40 });
  for (const reducedMotion of ["no-preference", "reduce"] as const) {
    const animations = await runningAnimations(motionUrl, reducedMotion);
    const ok = reducedMotion === "reduce" ? animations === 0 : animations > 0;
    if (!ok) failed++;
    console.log(`${ok ? "PASS" : "FAIL"}  motion ${reducedMotion.padEnd(13)} ${animations} running animation(s)`);
  }

  // The soak's detection (T-420): short soaks, the same judgement as 30 minutes.
  const soakUrl = putSoak(server);
  const soaks: [string, SoakBreak | undefined][] = [
    ["ok", undefined],
    ["leak-listener", "listeners"],
    ["leak-detached", "detached"],
  ];
  for (const [mode, want] of soaks) {
    const run = await runSoak(browser, server, soakUrl, { page: `selftest.html?mode=${mode}`, durationMs: 30_000, sampleEveryMs: 5_000 });
    const ok = want === undefined ? run.verdict.passed : run.verdict.broken.includes(want);
    if (!ok) failed++;
    console.log(`${ok ? "PASS" : "FAIL"}  soak ${mode.padEnd(13)} expected ${want ?? "steady"}: ${describeVerdict(run.verdict)}`);
  }
} finally {
  await browser.close();
  await server.close();
}
/** Animations running after a counters document has rendered, shadow trees included. */
async function runningAnimations(dataUrl: string, reducedMotion: "reduce" | "no-preference"): Promise<number> {
  const context = await browser.newContext({ reducedMotion });
  try {
    const page = await context.newPage();
    await page.goto(`${server.url}/ours-element.html`);
    await page.waitForFunction(() => window.__bench?.ready === true);
    await page.evaluate((url) => window.__bench.load(url), dataUrl);
    await page.evaluate(() => window.__bench.run());
    // Chromium's document.getAnimations() leaves out shadow trees: ask each root.
    return await page.evaluate(() => {
      const roots: DocumentOrShadowRoot[] = [document];
      for (const el of document.querySelectorAll("*")) if (el.shadowRoot) roots.push(el.shadowRoot);
      return roots.flatMap((r) => r.getAnimations()).filter((a) => a.playState === "running").length;
    });
  } finally {
    await context.close();
  }
}

if (failed) {
  console.error(`\n${failed} self-test case(s) misclassified: do not trust results from this harness.`);
  process.exit(1);
}
console.log("\nharness self-test passed");
