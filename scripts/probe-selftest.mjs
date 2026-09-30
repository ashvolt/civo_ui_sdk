/**
 * Self-test for `probe-models.ts`.
 *
 * The probe is the one piece of code in this repository that cannot be unit
 * tested against the real thing — it needs a live relaxAI key, and CI has none.
 * That is not a reason to ship it unverified: `stub-relax.mjs` impersonates four
 * models with known, deliberately awkward behaviour, and this script asserts the
 * probe reaches the right conclusion about each of them.
 *
 * It caught two real bugs on first run: a streaming rejection being recorded as
 * an error rather than a capability fact, and a model that fails every probe as
 * "not a chat model" still being written back as `chatCapable: true`.
 *
 * Requires `pnpm build` first — the probe imports `relax-ui-core` by name, so it
 * exercises the published artifact.
 */
import { spawn } from "node:child_process";
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

const PORT = Number(process.env.PROBE_SELFTEST_PORT ?? 8099);
const BASE = `http://127.0.0.1:${PORT}/v1`;

/** What the stub's behaviour means the probe must conclude. */
const EXPECTATIONS = [
  { model: "stub-full", contains: ["json_schema=yes", "tool=yes", "json_object=yes", "stream=yes"] },
  { model: "stub-tools", contains: ["json_schema=no", "tool=yes", "stream=yes"] },
  { model: "stub-floor", contains: ["json_schema=no", "tool=no", "json_object=yes", "stream=no"] },
  { model: "stub-embed-1b", contains: ["not a chat model"] },
];

const SEED_EXPECTATIONS = [
  ["stub-full", { jsonSchema: true, toolCalling: true, jsonObject: true, streaming: true, chatCapable: true }],
  // The reasoning wrapper and code fence the stub emits must not stop the
  // payload validating, and must be detected.
  ["stub-tools", { jsonSchema: false, toolCalling: true, reasoningTrace: true, chatCapable: true }],
  // A 400 saying "streaming is not available" is a capability fact, not an error.
  ["stub-floor", { jsonSchema: false, toolCalling: false, jsonObject: true, streaming: false }],
  // Every probe failed with "does not support chat completions", so the prior
  // (chatCapable: true) must be overridden rather than inherited.
  ["stub-embed-1b", { chatCapable: false }],
];

const fail = (message) => {
  console.error(`✗ ${message}`);
  process.exitCode = 1;
};

async function waitForStub(timeoutMs = 10_000) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    try {
      const response = await fetch(`${BASE}/models`);
      if (response.ok) return true;
    } catch {
      // not listening yet
    }
    await new Promise((r) => setTimeout(r, 100));
  }
  return false;
}

const outDir = mkdtempSync(join(tmpdir(), "probe-selftest-"));
const outFile = join(outDir, "caps.json");

const stub = spawn(process.execPath, [new URL("stub-relax.mjs", import.meta.url).pathname, String(PORT)], {
  stdio: ["ignore", "ignore", "inherit"],
});

let probeOutput = "";
try {
  if (!(await waitForStub())) {
    fail(`stub did not start on ${BASE}`);
    process.exit(1);
  }

  probeOutput = await new Promise((resolve, reject) => {
    const child = spawn(
      process.execPath,
      [
        "--experimental-strip-types",
        new URL("probe-models.ts", import.meta.url).pathname,
        "--base-url",
        BASE,
        "--allow-insecure-loopback",
        "--out",
        outFile,
      ],
      {
        // A loopback stub must not be routed through an outbound proxy.
        env: { ...process.env, RELAX_API_KEY: "stub-key", NO_PROXY: "127.0.0.1,localhost", no_proxy: "127.0.0.1,localhost" },
        stdio: ["ignore", "pipe", "pipe"],
      },
    );
    let out = "";
    child.stdout.on("data", (d) => (out += d));
    child.stderr.on("data", (d) => (out += d));
    child.on("error", reject);
    child.on("close", (code) => (code === 0 ? resolve(out) : reject(new Error(`probe exited ${code}\n${out}`))));
  });
} finally {
  stub.kill("SIGTERM");
}

// --- assert on the console report -------------------------------------------

for (const { model, contains } of EXPECTATIONS) {
  const line = probeOutput.split("\n").find((l) => l.startsWith(`${model} `));
  if (!line) {
    fail(`no report line for ${model}`);
    continue;
  }
  for (const needle of contains) {
    if (!line.includes(needle)) fail(`${model}: expected "${needle}" in "${line.trim()}"`);
  }
}

// --- assert on the machine-readable seed -------------------------------------

let seed;
try {
  seed = JSON.parse(readFileSync(outFile, "utf8"));
} catch (error) {
  fail(`could not read ${outFile}: ${error.message}`);
  process.exit(1);
}

for (const [model, expected] of SEED_EXPECTATIONS) {
  const actual = seed[model];
  if (!actual) {
    fail(`seed is missing ${model}`);
    continue;
  }
  for (const [key, value] of Object.entries(expected)) {
    if (actual[key] !== value) {
      fail(`seed ${model}.${key}: expected ${value}, got ${JSON.stringify(actual[key])}`);
    }
  }
}

// A non-chat model must not have strategy flags guessed for it.
for (const key of ["jsonSchema", "toolCalling", "jsonObject"]) {
  if (key in (seed["stub-embed-1b"] ?? {})) {
    fail(`seed stub-embed-1b must not record ${key} — nothing was learned about it`);
  }
}

// The whole point of the script is surfacing disagreement with the priors.
if (!probeOutput.includes("differ from the shipped prior")) {
  fail("expected the report to flag drift against the shipped priors");
}

rmSync(outDir, { recursive: true, force: true });

if (process.exitCode) {
  console.error("\n--- probe output ---\n" + probeOutput);
  console.error("probe self-test FAILED");
} else {
  console.log(`✓ probe self-test passed (${EXPECTATIONS.length} models, ${SEED_EXPECTATIONS.length} seed assertions)`);
}
