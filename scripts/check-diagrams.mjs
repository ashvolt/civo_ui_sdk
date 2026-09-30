/**
 * Render every fenced mermaid block under `docs/` and fail on a parse error.
 *
 * A diagram that does not render is worse than no diagram: it looks like
 * documentation and conveys nothing. Two of the eight diagrams in this repo were
 * syntactically wrong on first write (`state X as "..."` is backwards from
 * Mermaid's grammar) and looked entirely plausible in the source.
 *
 * This lives in a script rather than inline in the CI YAML because the previous
 * version used a heredoc nested inside a `run: |` block — a shape where the
 * terminator's indentation silently changes the meaning — and because a check
 * you cannot run locally is a check you debug through the CI queue.
 *
 * Usage:
 *   pnpm diagrams:check                  # mmdc from PATH
 *   MMDC=/path/to/mmdc pnpm diagrams:check
 *   pnpm diagrams:check -- --keep        # leave the rendered SVGs behind
 */
import { spawn } from "node:child_process";
import { mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, statSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, relative, resolve } from "node:path";

const ROOT = resolve(new URL("..", import.meta.url).pathname);
const DOCS = join(ROOT, "docs");
const MMDC = process.env.MMDC ?? "mmdc";
const keep = process.argv.includes("--keep");

/** Every fenced mermaid block, with where it came from. */
function collect(dir, found = []) {
  for (const entry of readdirSync(dir)) {
    const path = join(dir, entry);
    if (statSync(path).isDirectory()) {
      collect(path, found);
      continue;
    }
    if (!path.endsWith(".md")) continue;
    const source = readFileSync(path, "utf8");
    const re = /```mermaid\n([\s\S]*?)```/g;
    let match;
    let index = 0;
    while ((match = re.exec(source))) {
      found.push({ origin: `${relative(ROOT, path)} (block ${++index})`, body: match[1] });
    }
  }
  return found;
}

function render(file, out) {
  return new Promise((resolvePromise) => {
    const child = spawn(MMDC, ["-p", puppeteerConfig, "-i", file, "-o", out], { stdio: ["ignore", "ignore", "pipe"] });
    let stderr = "";
    child.stderr.on("data", (d) => (stderr += d));
    child.on("error", (error) => resolvePromise({ ok: false, stderr: `could not run "${MMDC}": ${error.message}` }));
    child.on("close", (code) => resolvePromise({ ok: code === 0, stderr }));
  });
}

const work = mkdtempSync(join(tmpdir(), "diagrams-"));
const blocksDir = join(work, "blocks");
const outDir = join(work, "out");
mkdirSync(blocksDir, { recursive: true });
mkdirSync(outDir, { recursive: true });

// Chromium on a CI runner has no usable sandbox, and /dev/shm is small.
// `executablePath` is only set when the environment supplies a browser: on CI,
// mermaid-cli's install downloads its own and puppeteer resolves it itself.
const puppeteerConfig = join(work, "puppeteer.json");
const browser = process.env.PUPPETEER_EXECUTABLE_PATH ?? process.env.CHROMIUM_PATH;
writeFileSync(
  puppeteerConfig,
  JSON.stringify({
    args: ["--no-sandbox", "--disable-dev-shm-usage"],
    ...(browser ? { executablePath: browser } : {}),
  }),
);

const blocks = collect(DOCS);
if (blocks.length === 0) {
  console.error("No mermaid blocks found under docs/ — the extractor is probably broken.");
  process.exit(1);
}

/** The parse error, without the puppeteer stack trace that dwarfs it. */
function summarise(stderr) {
  return stderr
    .split("\n")
    .filter((line) => line.trim() !== "" && !/^\s*at /.test(line))
    .slice(0, 8)
    .map((line) => `    ${line}`)
    .join("\n");
}

const DETAIL_LIMIT = 3;
let failed = 0;
for (const [i, block] of blocks.entries()) {
  const name = String(i + 1).padStart(3, "0");
  const file = join(blocksDir, `${name}.mmd`);
  writeFileSync(file, block.body);

  const { ok, stderr } = await render(file, join(outDir, `${name}.svg`));
  if (ok) continue;

  failed++;
  // GitHub surfaces `::error::` in the run summary, so the origin needs to be
  // in the message — the temp filename is no help to anyone.
  console.error(`::error::mermaid failed to render: ${block.origin}`);
  // A misconfigured browser fails every block with the same message; printing
  // it sixteen times buries the one line that matters.
  if (failed <= DETAIL_LIMIT) console.error(summarise(stderr));
  else if (failed === DETAIL_LIMIT + 1) console.error("    (further details suppressed — same failure repeating)");
}

if (keep) console.log(`Rendered SVGs kept in ${outDir}`);
else rmSync(work, { recursive: true, force: true });

if (failed > 0) {
  console.error(`\n${failed} of ${blocks.length} mermaid blocks failed to render.`);
  process.exit(1);
}
console.log(`✓ all ${blocks.length} mermaid blocks render`);
