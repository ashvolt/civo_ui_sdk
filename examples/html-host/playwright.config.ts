import { defineConfig } from "@playwright/test";

/**
 * `<gen-ui>` in a plain HTML page, in a real browser, under the policy a strict
 * site serves: `script-src 'self'`, no `unsafe-eval`, no `unsafe-inline`
 * (T-248). The server is `serve.mjs`; its SDK route is a local stand-in with a
 * fixed document, so nothing here depends on a model.
 */

const PORT = 3300;
const chromiumPath = process.env["PLAYWRIGHT_CHROMIUM_PATH"];

export default defineConfig({
  testDir: "./e2e",
  timeout: 60_000,
  expect: { timeout: 15_000 },
  retries: 0,
  workers: 1,
  reporter: process.env["CI"] ? [["github"], ["list"]] : [["list"]],
  use: {
    baseURL: `http://127.0.0.1:${PORT}`,
    trace: "retain-on-failure",
    ...(chromiumPath ? { launchOptions: { executablePath: chromiumPath } } : {}),
  },
  webServer: {
    command: `node build.mjs && node serve.mjs ${PORT}`,
    url: `http://127.0.0.1:${PORT}/empty.html`,
    reuseExistingServer: false,
    timeout: 120_000,
    stdout: "pipe",
    stderr: "pipe",
  },
});
