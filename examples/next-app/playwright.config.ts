import { defineConfig } from "@playwright/test";

/**
 * Browser-level coverage of the reference application.
 *
 * Everything below the browser is unit-tested: the partial parser against every
 * prefix of a document, the schema classifier, the renderer's refusal paths
 * through `react-dom/server`. What none of that covers is the wiring — that the
 * route's SSE frames reach the hook, that the hook's patches reach the renderer,
 * and that a half-written document paints rather than throwing. That is what
 * these tests are for, and it is why they drive the real app rather than
 * mounting components.
 *
 * The model is a local stand-in (`e2e/stub-endpoint.mjs`), not a real one: a
 * real model returns a different document every run, and a test that asserts on
 * model output is a test that fails for reasons that are not bugs.
 */

const STUB_PORT = 11437;
const APP_PORT = 3210;

/**
 * Where to find Chromium, when it is not where Playwright installs it.
 *
 * CI runs `playwright install chromium` and needs nothing here. A container that
 * ships its own browser sets `PLAYWRIGHT_CHROMIUM_PATH` instead, rather than
 * this file hardcoding a path that exists on exactly one machine.
 */
const chromiumPath = process.env["PLAYWRIGHT_CHROMIUM_PATH"];

export default defineConfig({
  testDir: "./e2e",
  // A generative UI streams; nothing here is instant, and a tight default just
  // produces flakes on a loaded CI runner.
  timeout: 60_000,
  expect: { timeout: 15_000 },
  // A flaky end-to-end test is worse than none: it teaches people to re-run
  // rather than to read. No retries, so a failure means something.
  retries: 0,
  fullyParallel: false,
  workers: 1,
  reporter: process.env["CI"] ? [["github"], ["list"]] : [["list"]],
  use: {
    baseURL: `http://127.0.0.1:${APP_PORT}`,
    ...(chromiumPath ? { launchOptions: { executablePath: chromiumPath } } : {}),
    trace: "retain-on-failure",
  },
  webServer: [
    {
      command: `node e2e/stub-endpoint.mjs ${STUB_PORT}`,
      url: `http://127.0.0.1:${STUB_PORT}/v1/models`,
      reuseExistingServer: false,
      stdout: "pipe",
      stderr: "pipe",
    },
    {
      // `next start`, not `next dev`: the test should exercise what ships, and a
      // dev-mode first-request compile is slow enough to look like a hang.
      command: `next build && next start -p ${APP_PORT}`,
      url: `http://127.0.0.1:${APP_PORT}`,
      reuseExistingServer: false,
      timeout: 180_000,
      stdout: "pipe",
      stderr: "pipe",
      env: {
        // Local mode, so the app needs no relaxAI account to be tested. The
        // sovereignty guard still runs; it is handed a loopback-only policy.
        RELAX_UI_PROVIDER: "ollama",
        OLLAMA_BASE_URL: `http://127.0.0.1:${STUB_PORT}/v1`,
      },
    },
  ],
});
