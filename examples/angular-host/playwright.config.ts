import { defineConfig } from "@playwright/test";

/**
 * `<gen-ui>` in an Angular application, compiled ahead of time, served under a
 * strict policy (T-255): `script-src 'self'`, no `unsafe-eval`, no
 * `unsafe-inline`. Styles are `'self'` plus a per-page nonce for the component
 * styles Angular adds at runtime. The server is `serve.mjs`; its SDK route is a
 * local stand-in with a fixed document, so nothing here depends on a model.
 */

const PORT = 3302;
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
    command: `node node_modules/@angular/cli/bin/ng.js build && node serve.mjs ${PORT}`,
    url: `http://127.0.0.1:${PORT}/`,
    reuseExistingServer: false,
    timeout: 240_000,
    stdout: "pipe",
    stderr: "pipe",
    env: { NG_CLI_ANALYTICS: "false" },
  },
});
