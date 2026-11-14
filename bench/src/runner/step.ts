import type { Browser } from "@playwright/test";
import { BUDGETS, type Sample } from "../budgets.ts";
import type { BenchServer } from "./server.ts";

/**
 * Runs one step once, in a fresh page (plan D4):
 *   - applies the profile (viewport, touch, CPU slowdown);
 *   - loads the encoded frames before timing starts;
 *   - starts the run, clicks the interaction target half-way through the
 *     stream, and waits for done or the timeout;
 *   - after a forced garbage collection, reads heap and DOM counters.
 */

export type ProfileId = "desktop" | "phone";

export const PROFILES = {
  desktop: { cpuSlowdown: 1, viewport: { width: 1366, height: 900 }, deviceScaleFactor: 1, hasTouch: false, isMobile: false },
  phone: { cpuSlowdown: 4, viewport: { width: 412, height: 915 }, deviceScaleFactor: 2.625, hasTouch: true, isMobile: true },
} as const;

export interface StepRequest {
  page: string;
  dataUrl: string;
  profile: ProfileId;
  timeoutMs?: number;
  /** Extra CPU throttling on top of the profile's: the regression check's deliberate slowdown (T-450). */
  slowdown?: number;
}

export async function runOnce(browser: Browser, server: BenchServer, req: StepRequest): Promise<Sample> {
  const profile = PROFILES[req.profile];
  const context = await browser.newContext({
    viewport: profile.viewport,
    deviceScaleFactor: profile.deviceScaleFactor,
    hasTouch: profile.hasTouch,
    isMobile: profile.isMobile,
  });
  const page = await context.newPage();
  const errors: string[] = [];
  page.on("pageerror", (e) => errors.push(String(e)));
  const cdp = await context.newCDPSession(page);
  try {
    const rate = profile.cpuSlowdown * (req.slowdown ?? 1);
    if (rate > 1) await cdp.send("Emulation.setCPUThrottlingRate", { rate });
    await page.goto(`${server.url}/${req.page}`);
    await page.waitForFunction(() => window.__bench?.ready === true);
    await page.evaluate((url) => window.__bench.load(url), req.dataUrl);
    // Main-thread task time around the run: the renderer's own work, whatever
    // the delivery schedule (the pull-request regression check, FR-440).
    await cdp.send("Performance.enable");
    const taskTime = async () =>
      ((await cdp.send("Performance.getMetrics")) as { metrics: { name: string; value: number }[] }).metrics.find((m) => m.name === "TaskDuration")?.value ?? 0;
    const busyFrom = await taskTime();

    const timeout = req.timeoutMs ?? BUDGETS.timeoutMs[req.profile];
    const run = page.evaluate(() => window.__bench.run());
    const halfway = page
      .waitForFunction(() => window.__bench.pushed >= Math.ceil(window.__bench.total / 2), null, { timeout })
      .then(() => page.click("#bench-interact", { timeout: 5_000 }))
      .catch(() => undefined);
    let timer: ReturnType<typeof setTimeout> | undefined;
    const timedOut = new Promise<"timeout">((r) => {
      timer = setTimeout(() => r("timeout"), timeout);
    });
    const result = await Promise.race([run, timedOut]);
    clearTimeout(timer);
    await halfway;
    if (result === "timeout") {
      return { frames: [], longFrames: [], interaction: 0, firstNode: 0, complete: timeout, correct: false, timedOut: true };
    }
    const busy = Math.round(((await taskTime()) - busyFrom) * 10_000) / 10;

    await cdp.send("HeapProfiler.collectGarbage");
    const heap = (await cdp.send("Runtime.getHeapUsage")) as { usedSize: number };
    const counters = (await cdp.send("Memory.getDOMCounters")) as { nodes: number; jsEventListeners: number };
    const sample: Sample = {
      frames: result.frames,
      longFrames: result.longFrames,
      interaction: result.interaction,
      firstNode: result.firstNode,
      complete: result.complete,
      correct: result.correct,
      busy,
      heap: heap.usedSize,
      domNodes: counters.nodes,
      listeners: counters.jsEventListeners,
    };
    if (errors.length) sample.error = errors[0];
    return Object.assign(sample, result.detail ? { detail: result.detail } : {});
  } catch (cause) {
    const message = String(cause);
    return {
      frames: [],
      longFrames: [],
      interaction: 0,
      firstNode: 0,
      complete: 0,
      correct: false,
      ...(/crash/i.test(message) ? { crashed: true } : {}),
      error: message.slice(0, 300),
    };
  } finally {
    await context.close();
  }
}
