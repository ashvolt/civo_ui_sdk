import { defineConfig } from "@playwright/test";

/**
 * Records the demo video. Not a test suite, and not run in CI.
 *
 *   pnpm demo:record                       # a real model on local Ollama
 *   DEMO_MODEL=qwen2.5:7b pnpm demo:record # pin which one
 *   DEMO_ENDPOINT=stub pnpm demo:record    # no model at all (says so on screen)
 *
 * It builds the reference app, starts it against the chosen endpoint, and
 * drives it in Chromium with Playwright's recorder running. The output is
 * `docs/demo/generative-ui-local-model.webm`.
 *
 * Kept apart from `playwright.config.ts` deliberately. That file's stand-in
 * endpoint exists so assertions are deterministic; this one's job is the
 * opposite — to show a real open-weight model producing a different document
 * every time — and a generation here takes as long as the model takes.
 */

const APP_PORT = 3220;
const STUB_PORT = 11439;
const useStub = process.env["DEMO_ENDPOINT"] === "stub";
const chromiumPath = process.env["PLAYWRIGHT_CHROMIUM_PATH"];

const appEnv: Record<string, string> = {
  // Always a local provider: the recording must be reproducible by someone with
  // no relaxAI account, which is the point of the feature it demonstrates.
  RELAX_UI_PROVIDER: "ollama",
  ...(useStub ? { OLLAMA_BASE_URL: `http://127.0.0.1:${STUB_PORT}/v1` } : {}),
  ...(process.env["DEMO_MODEL"] && !useStub ? { RELAX_UI_MODEL: process.env["DEMO_MODEL"] } : {}),
};

export default defineConfig({
  testDir: "./demo",
  testMatch: "record.spec.ts",
  // Two generations on CPU, with a cold model load in front of the first.
  timeout: 15 * 60_000,
  retries: 0,
  workers: 1,
  reporter: [["list"]],
  use: {
    baseURL: `http://127.0.0.1:${APP_PORT}`,
    ...(chromiumPath ? { launchOptions: { executablePath: chromiumPath } } : {}),
  },
  webServer: [
    ...(useStub
      ? [
          {
            command: `node e2e/stub-endpoint.mjs ${STUB_PORT}`,
            url: `http://127.0.0.1:${STUB_PORT}/v1/models`,
            reuseExistingServer: false,
            // Paced, so the stream is watchable rather than instantaneous.
            env: { SCHEMA: "on", DELAY_MS: "45" },
          },
        ]
      : []),
    {
      command: `next build && next start -p ${APP_PORT}`,
      url: `http://127.0.0.1:${APP_PORT}`,
      reuseExistingServer: false,
      timeout: 180_000,
      stdout: "pipe",
      stderr: "pipe",
      env: appEnv,
    },
  ],
});
