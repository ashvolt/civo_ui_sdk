/**
 * `pnpm bench:gate` — the structural gate (T-436, research R3): before any
 * timing counts, every renderer must draw every workload to the reference's
 * markup, or be reported as unable to express it, with the reason.
 *
 * For each renderer: the document with every component once, then the first
 * two steps of every ladder, each run once on the desktop profile after a
 * warm-up document, as the ladders run it. Exits
 * non-zero if any expressible workload draws wrong.
 *
 *   --renderer a,b     default: every renderer that ladders
 */
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { chromium } from "@playwright/test";
import { framesFor, warmupDocument } from "../workloads/generator.ts";
import { LADDERS, planStep } from "../workloads/ladders.ts";
import type { Encoded } from "./contenders.ts";
import { oursSSE } from "./encode.ts";
import { RENDERERS } from "./renderers.ts";
import { startServer } from "./server.ts";
import { runOnce } from "./step.ts";

export interface GateRow {
  renderer: string;
  workload: string;
  size: number;
  verdict: "equal" | "different" | "not-expressible" | "failed";
  detail?: string;
}

const here = dirname(fileURLToPath(import.meta.url));
const arg = (name: string) => {
  const i = process.argv.indexOf(`--${name}`);
  return i === -1 ? undefined : process.argv[i + 1];
};
const renderers = arg("renderer")?.split(",") ?? Object.keys(RENDERERS).filter((id) => RENDERERS[id]!.ladders !== false);

const server = await startServer(join(here, "..", "..", "dist"));
const browser = await chromium.launch();
const rows: GateRow[] = [];
try {
  for (const id of renderers) {
    const r = RENDERERS[id]!;
    const encode = r.encode ?? ((frames) => ({ chunks: oursSSE(frames) }) as Encoded);
    // The ladders' path: a warm-up document first, then the case as the next
    // document, so each case also checks that a renderer can replace one.
    const warm = encode([warmupDocument()], "static-nodes");
    const warmup = "chunks" in warm ? warm.chunks : undefined;
    const cases = [
      { workload: "every-component", size: 16, frames: [warmupDocument()], dimension: "static-nodes" as const },
      ...LADDERS.flatMap((l) =>
        l.steps.slice(0, 2).map((size) => ({ workload: l.id, size, frames: framesFor(planStep(l, size)), dimension: l.id })),
      ),
    ];
    for (const c of cases) {
      const encoded = encode(c.frames, c.dimension);
      if ("notExpressible" in encoded) {
        rows.push({ renderer: id, workload: c.workload, size: c.size, verdict: "not-expressible", detail: encoded.notExpressible });
        continue;
      }
      const dataUrl = server.put(`gate-${id}-${c.workload}-${c.size}`, { chunks: encoded.chunks, final: c.frames.at(-1), rateMs: 20, warmup });
      const s = await runOnce(browser, server, { page: r.page, dataUrl, profile: "desktop", timeoutMs: 30_000 });
      const verdict = s.timedOut || s.error || s.crashed ? "failed" : s.correct ? "equal" : "different";
      rows.push({
        renderer: id,
        workload: c.workload,
        size: c.size,
        verdict,
        ...(s.detail || s.error ? { detail: (s.detail ?? s.error)!.slice(0, 240) } : s.timedOut ? { detail: "timed out" } : {}),
      });
    }
  }
} finally {
  await browser.close();
  await server.close();
}

let bad = 0;
for (const r of rows) {
  if (r.verdict === "different" || r.verdict === "failed") bad++;
  const mark = r.verdict === "equal" ? "ok  " : r.verdict === "not-expressible" ? "n/a " : "FAIL";
  console.log(`${mark} ${r.renderer.padEnd(14)} ${r.workload.padEnd(16)} ${String(r.size).padStart(6)}  ${r.verdict}${r.detail ? `: ${r.detail}` : ""}`);
}
console.log(bad ? `\n${bad} case(s) drew different markup: no timing from them counts.` : "\nstructural gate passed");
if (bad) process.exitCode = 1;
