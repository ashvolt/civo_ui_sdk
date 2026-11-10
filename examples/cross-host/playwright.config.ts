import { defineConfig } from "@playwright/test";

/**
 * T-256: one document, four hosts, one structure. Starts the three example
 * servers (each builds first); the React host is a page of the HTML example.
 */

const chromiumPath = process.env["PLAYWRIGHT_CHROMIUM_PATH"];
const host = (dir: string, port: number, build: string) => ({
  command: `${build} && node serve.mjs ${port}`,
  cwd: `../${dir}`,
  url: `http://127.0.0.1:${port}/`,
  reuseExistingServer: false,
  timeout: 240_000,
  stdout: "pipe" as const,
  stderr: "pipe" as const,
  env: { NG_CLI_ANALYTICS: "false" },
});

export default defineConfig({
  testDir: "./e2e",
  timeout: 60_000,
  expect: { timeout: 15_000 },
  retries: 0,
  workers: 1,
  reporter: process.env["CI"] ? [["github"], ["list"]] : [["list"]],
  use: { trace: "retain-on-failure", ...(chromiumPath ? { launchOptions: { executablePath: chromiumPath } } : {}) },
  webServer: [
    host("html-host", 3300, "node build.mjs"),
    host("vue-host", 3301, "node build.mjs"),
    host("angular-host", 3302, "node node_modules/@angular/cli/bin/ng.js build"),
  ],
});
