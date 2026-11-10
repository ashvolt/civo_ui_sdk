/**
 * `pnpm bench:selftest` — the harness proves itself before any result is
 * trusted (T-404, T-408, plan Verification "Ladder correctness").
 *
 * Four renderers on one small step. Each must be classified as stated, or
 * this exits non-zero:
 *   ok     → passes every budget
 *   slow   → breaks on longestTask (80 ms busy per frame)
 *   wrong  → breaks on correctness (a node dropped)
 *   hang   → breaks on timeout
 */
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { chromium } from "@playwright/test";
import { summarise, type Sample } from "../budgets.ts";
import { framesFor } from "../workloads/generator.ts";
import { LADDERS, planStep } from "../workloads/ladders.ts";
import { oursSSE } from "./encode.ts";
import { startServer } from "./server.ts";
import { runOnce } from "./step.ts";

const root = join(dirname(fileURLToPath(import.meta.url)), "..", "..");
const expected: Record<string, string | undefined> = { ok: undefined, slow: "longestTask", wrong: "correctness", hang: "timeout" };

const server = await startServer(join(root, "dist"));
const browser = await chromium.launch();
const step = planStep(LADDERS.find((l) => l.id === "nodes")!, 100);
const frames = framesFor(step);
const dataUrl = server.put("selftest", { chunks: oursSSE(frames), final: frames.at(-1), rateMs: 1000 / step.rate });

let failed = 0;
try {
  for (const [mode, want] of Object.entries(expected)) {
    const samples: Sample[] = [];
    for (let i = 0; i < 3; i++) {
      const s = await runOnce(browser, server, { page: `selftest.html?mode=${mode}`, dataUrl, profile: "desktop", timeoutMs: mode === "hang" ? 5_000 : 30_000 });
      samples.push(s);
      if (s.timedOut) break;
    }
    const got = summarise(samples).broken;
    const ok = got === want;
    if (!ok) failed++;
    console.log(`${ok ? "PASS" : "FAIL"}  ${mode.padEnd(6)} expected ${want ?? "no break"}, got ${got ?? "no break"}${samples[0]?.detail ? `  (${samples[0].detail})` : ""}${samples[0]?.error ? `  [${samples[0].error}]` : ""}`);
  }
} finally {
  await browser.close();
  await server.close();
}
if (failed) {
  console.error(`\n${failed} self-test case(s) misclassified: do not trust results from this harness.`);
  process.exit(1);
}
console.log("\nharness self-test passed");
