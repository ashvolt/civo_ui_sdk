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
 *
 * There are two stand-ins and two instances of the app, from one build:
 *
 *   modern  honours `response_format: json_schema`, as a current local runtime does
 *   legacy  refuses it, and is used to walk the ladder down
 *
 * Two, because the SDK *remembers* what an endpoint refused for the life of the
 * process. One app talking to an endpoint that changed its mind between tests
 * would be asserting against state the previous test had deliberately poisoned.
 */

const MODERN = { stub: 11437, app: 3210 };
const LEGACY = { stub: 11438, app: 3211 };

/**
 * Where to find Chromium, when it is not where Playwright installs it.
 *
 * CI runs `playwright install chromium` and needs nothing here. A container that
 * ships its own browser sets `PLAYWRIGHT_CHROMIUM_PATH` instead, rather than
 * this file hardcoding a path that exists on exactly one machine.
 */
const chromiumPath = process.env["PLAYWRIGHT_CHROMIUM_PATH"];
const launchOptions = chromiumPath ? { launchOptions: { executablePath: chromiumPath } } : {};

/** Local provider, so the app needs no relaxAI account to be tested. */
const appEnv = (stubPort: number) => ({
  RELAX_UI_PROVIDER: "ollama",
  // The sovereignty guard still runs; the Ollama profile hands it a
  // loopback-only policy, which this address satisfies.
  OLLAMA_BASE_URL: `http://127.0.0.1:${stubPort}/v1`,
});

const stub = (port: number, schema: "on" | "off") => ({
  command: `node e2e/stub-endpoint.mjs ${port}`,
  url: `http://127.0.0.1:${port}/v1/models`,
  reuseExistingServer: false,
  stdout: "pipe" as const,
  stderr: "pipe" as const,
  env: { SCHEMA: schema },
});

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
  use: { trace: "retain-on-failure" },
  projects: [
    {
      name: "modern-runtime",
      testMatch: "dashboard.spec.ts",
      use: { baseURL: `http://127.0.0.1:${MODERN.app}`, ...launchOptions },
    },
    {
      name: "legacy-runtime",
      testMatch: "legacy-runtime.spec.ts",
      use: { baseURL: `http://127.0.0.1:${LEGACY.app}`, ...launchOptions },
    },
  ],
  // Started in order, each awaited before the next — which is what lets the
  // second app instance reuse the build the first one made.
  webServer: [
    stub(MODERN.stub, "on"),
    stub(LEGACY.stub, "off"),
    {
      // `next start`, not `next dev`: the test should exercise what ships, and a
      // dev-mode first-request compile is slow enough to look like a hang.
      command: `next build && next start -p ${MODERN.app}`,
      url: `http://127.0.0.1:${MODERN.app}`,
      reuseExistingServer: false,
      timeout: 180_000,
      stdout: "pipe",
      stderr: "pipe",
      env: appEnv(MODERN.stub),
    },
    {
      command: `next start -p ${LEGACY.app}`,
      url: `http://127.0.0.1:${LEGACY.app}`,
      reuseExistingServer: false,
      timeout: 60_000,
      stdout: "pipe",
      stderr: "pipe",
      env: appEnv(LEGACY.stub),
    },
  ],
});
