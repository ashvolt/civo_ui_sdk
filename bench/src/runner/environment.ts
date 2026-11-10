import { execSync } from "node:child_process";
import { cpus, hostname, platform, release, totalmem } from "node:os";
import type { Browser } from "@playwright/test";
import type { ResultFile } from "../results.ts";

/** What a result must say about where it came from (FR-423, FR-452). */
export function environment(browser: Browser): ResultFile["environment"] {
  let commit = "unknown";
  try {
    commit = execSync("git rev-parse --short HEAD", { encoding: "utf8" }).trim();
  } catch {
    // not a checkout
  }
  return {
    machine: process.env["BENCH_MACHINE"] ?? (process.env["GITHUB_ACTIONS"] ? "github-ubuntu-latest" : hostname()),
    cpu: cpus()[0]?.model.trim() ?? "unknown",
    cores: cpus().length,
    memoryGb: Math.round(totalmem() / 1024 ** 3),
    os: `${platform()} ${release()}`,
    browser: `Chromium ${browser.version()}`,
    node: process.version,
    commit,
    date: new Date().toISOString(),
  };
}
