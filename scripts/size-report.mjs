#!/usr/bin/env node
/**
 * Size report (NFR-201, research R10). Reported, never enforced: this script
 * exits 0 whatever the numbers are.
 *
 * Measures two things, from the built `dist/` of each package:
 *
 * - **Packages**: each package's own code, minified and gzipped, with its
 *   dependencies left external. What changes when that package changes.
 * - **Scenarios**: what a browser actually downloads for one way of using the
 *   SDK, with workspace packages bundled in and only the host's framework left
 *   out. What an application pays.
 *
 * Uses esbuild's metafile to attribute each scenario's bytes to the packages
 * they came from. esbuild is reached through tsup, which the workspace already
 * has, so this adds no dependency.
 *
 *   node scripts/size-report.mjs [--out size.json] [--previous size.json]
 *
 * With `--previous`, each row shows the change from that report. In CI the
 * previous report is the last `main` build's; the table goes to the job
 * summary.
 */
import { appendFileSync, existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { createRequire } from "node:module";
import { dirname, join, relative, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { gzipSync } from "node:zlib";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const requireFromTsup = createRequire(createRequire(join(root, "package.json")).resolve("tsup/package.json"));
const esbuild = requireFromTsup("esbuild");

const args = process.argv.slice(2);
const option = (name) => {
  const i = args.indexOf(name);
  return i === -1 ? undefined : args[i + 1];
};
const outPath = option("--out");
const previousPath = option("--previous");

const dist = (pkg) => join(root, "packages", pkg, "dist", "index.js");
const FRAMEWORK = ["react", "react-dom", "react/jsx-runtime", "next", "next/*"];

/** Each package alone: every import that is not its own code stays external. */
const PACKAGES = [
  { name: "relax-ui-protocol", entry: dist("protocol"), note: "browser protocol, no dependencies" },
  { name: "relax-ui-contract", entry: dist("contract"), note: "twelve components and the schema builder" },
  { name: "relax-ui-theme-base", entry: dist("theme-base"), note: "tokens, variants, twelve templates" },
  { name: "relax-ui-render", entry: dist("render"), note: "render core and DOM backend; protocol's guard compiled in" },
  { name: "relax-ui-element", entry: dist("element"), note: "<gen-ui>; render core, base theme loaders and protocol compiled in" },
  { name: "relax-ui-core", entry: dist("core"), note: "server engine; includes protocol" },
  { name: "relax-ui-react", entry: dist("react"), note: "hook and renderer" },
  { name: "relax-ui-next", entry: dist("next"), note: "route handler (server)" },
];

/** What a browser downloads for one use. `code` is the entry module. */
const SCENARIOS = [
  {
    name: "protocol: read any source",
    note: "readSource + accumulator: the minimum to turn a source into a document",
    code: `export { readSource, UIStreamAccumulator, resolveValidation } from ${JSON.stringify(dist("protocol"))};`,
    external: [],
  },
  {
    name: "react: hook only",
    note: "useGenerativeObject, with core and protocol bundled; React external",
    code: `export { useGenerativeObject } from ${JSON.stringify(dist("react"))};`,
    external: [...FRAMEWORK, "zod"],
  },
  {
    name: "react: hook + renderer",
    note: "the reference app's client imports",
    code: `export { useGenerativeObject, GenerativeUI, createGenerativeRenderer } from ${JSON.stringify(dist("react"))};`,
    external: [...FRAMEWORK, "zod"],
  },
  {
    name: "react: hook + renderer + base theme",
    note: "what the reference app ships: the twelve, drawn by the base theme",
    code: `export { useGenerativeObject, createGenerativeRenderer, baseComponents, GenerativeTheme } from ${JSON.stringify(dist("react"))};`,
    external: [...FRAMEWORK, "zod"],
  },
  {
    name: "dom: renderer + lazy base theme, nothing rendered",
    note: "what a non-React page loads before its first document: no component code",
    code: `export { createCatalog, DomRenderer } from ${JSON.stringify(dist("render"))}; export { baseLoaders } from ${JSON.stringify(dist("theme-base"))};`,
    external: [],
    splitting: true,
  },
  {
    name: "element: <gen-ui> on a page, nothing rendered",
    note: "registers the element: the base theme's CSS, no component code, no validator",
    code: `import ${JSON.stringify(join(root, "packages", "element", "dist", "define.js"))};`,
    external: [],
    splitting: true,
  },
  {
    name: "contract: browser validation",
    note: "the standard contract's schemas, Zod included: what full validation costs",
    code: `export { standardContract } from ${JSON.stringify(dist("contract"))};`,
    external: [],
  },
  {
    name: "validator: zod",
    note: "the browser-validation cost a same-origin route with validate: \"server\" avoids (R7)",
    code: `import { z } from "zod"; export const schema = z.object({ title: z.string().max(80), items: z.array(z.object({ label: z.string(), value: z.number() })).max(20) }).strict();`,
    external: [],
  },
];

async function measure({ entry, code, external, splitting = false }) {
  const result = await esbuild.build({
    ...(splitting ? { splitting: true, outdir: "out" } : {}),
    ...(entry ? { entryPoints: [entry] } : { stdin: { contents: code, resolveDir: root, loader: "js" } }),
    bundle: true,
    write: false,
    minify: true,
    format: "esm",
    platform: "browser",
    target: "es2022",
    metafile: true,
    logLevel: "silent",
    external,
  });
  // With splitting, the entry is the file built from stdin or the entry point;
  // lazily loaded chunks are measured separately below.
  const index = splitting ? result.outputFiles.findIndex((f) => /stdin\.js$|index\.js$/.test(f.path)) : 0;
  const bytes = result.outputFiles[index].contents;
  const output = Object.entries(result.metafile.outputs).find(([, o]) => o.entryPoint !== undefined)?.[1] ?? Object.values(result.metafile.outputs)[0];
  const byPackage = {};
  for (const [input, { bytesInOutput }] of Object.entries(output.inputs)) {
    const key = owner(input);
    byPackage[key] = (byPackage[key] ?? 0) + bytesInOutput;
  }
  return { min: bytes.length, gzip: gzipSync(bytes, { level: 9 }).length, byPackage };
}

/** Which package an esbuild input path belongs to. */
function owner(input) {
  const path = input.replace(/\\/g, "/");
  const ws = path.match(/packages\/([^/]+)\//);
  if (ws && !path.includes("node_modules")) return `relax-ui-${ws[1]}`;
  const nm = path.match(/node_modules\/(?:\.pnpm\/[^/]+\/node_modules\/)?((?:@[^/]+\/)?[^/]+)/);
  if (nm) return nm[1];
  return path.startsWith("<stdin>") ? "(entry)" : relative(root, input);
}

/**
 * For packages: every bare import stays external, so only the package's own
 * code counts. Core's protocol is compiled into core's dist, so it counts there.
 */
const OWN_CODE_ONLY = [...FRAMEWORK, "zod", "relax-ui-*"];

const kb = (n) => `${(n / 1024).toFixed(2)} KB`;
function delta(now, before) {
  if (before === undefined) return "new";
  const d = now - before;
  if (d === 0) return "±0";
  const pct = before === 0 ? "" : ` (${d > 0 ? "+" : ""}${((d / before) * 100).toFixed(1)}%)`;
  return `${d > 0 ? "+" : "−"}${kb(Math.abs(d))}${pct}`;
}

const report = { generatedAt: new Date().toISOString(), packages: {}, scenarios: {} };

for (const pkg of PACKAGES) {
  if (!existsSync(pkg.entry)) {
    console.error(`skip ${pkg.name}: ${relative(root, pkg.entry)} not built (run pnpm build)`);
    continue;
  }
  report.packages[pkg.name] = { ...(await measure({ entry: pkg.entry, external: OWN_CODE_ONLY })), note: pkg.note };
}
for (const scenario of SCENARIOS) {
  try {
    report.scenarios[scenario.name] = { ...(await measure(scenario)), note: scenario.note };
  } catch (error) {
    console.error(`skip ${scenario.name}: ${error.message.split("\n")[0]}`);
  }
}

/**
 * Each lazily loaded base-theme component group (NFR-201): what the first
 * document using one of its components fetches. Measured from source, one group
 * at a time, each with the small helpers it shares with the others, so a row
 * slightly over-counts and never under-counts.
 */
const GROUPS = {
  "layout (Stack, Grid, Card)": "layout",
  "text (Heading, Text, List, Link, Badge, Callout)": "text",
  Metric: "metric",
  Table: "table",
  Chart: "chart",
};
report.chunks = {};
for (const [name, file] of Object.entries(GROUPS)) {
  try {
    const entry = join(root, "packages", "theme-base", "src", "components", `${file}.ts`);
    report.chunks[name] = await measure({ entry, external: [] });
  } catch (error) {
    console.error(`skip chunk ${name}: ${error.message.split("\n")[0]}`);
  }
}

const previous = previousPath && existsSync(previousPath) ? JSON.parse(readFileSync(previousPath, "utf8")) : undefined;

const lines = [];
lines.push("## Size report", "");
lines.push(
  previous
    ? `Compared with the last \`main\` build (${previous.generatedAt}). Reported, not enforced (NFR-201).`
    : "No previous report to compare with. Reported, not enforced (NFR-201).",
  "",
);
lines.push("### Packages (own code; dependencies external)", "");
lines.push("| Package | gzip | change | minified | |", "|---|---:|---:|---:|---|");
for (const [name, r] of Object.entries(report.packages)) {
  lines.push(`| \`${name}\` | ${kb(r.gzip)} | ${delta(r.gzip, previous?.packages?.[name]?.gzip)} | ${kb(r.min)} | ${r.note} |`);
}
lines.push("", "### What a browser downloads", "");
lines.push("| Scenario | gzip | change | minified | made of (minified) |", "|---|---:|---:|---:|---|");
for (const [name, r] of Object.entries(report.scenarios)) {
  const parts = Object.entries(r.byPackage)
    .filter(([, n]) => n > 0)
    .sort((a, b) => b[1] - a[1])
    .map(([p, n]) => `${p} ${kb(n)}`)
    .join(", ");
  lines.push(`| ${name} | ${kb(r.gzip)} | ${delta(r.gzip, previous?.scenarios?.[name]?.gzip)} | ${kb(r.min)} | ${parts} |`);
}
lines.push("", "### Lazily loaded base-theme chunks", "");
lines.push("| Chunk | gzip | change | minified |", "|---|---:|---:|---:|");
for (const [name, r] of Object.entries(report.chunks ?? {}).sort()) {
  lines.push(`| ${name} | ${kb(r.gzip)} | ${delta(r.gzip, previous?.chunks?.[name]?.gzip)} | ${kb(r.min)} |`);
}
lines.push("");
const markdown = lines.join("\n");

console.log(markdown);
if (process.env.GITHUB_STEP_SUMMARY) appendFileSync(process.env.GITHUB_STEP_SUMMARY, `${markdown}\n`);
if (outPath) {
  mkdirSync(dirname(resolve(outPath)), { recursive: true });
  writeFileSync(outPath, `${JSON.stringify(report, null, 2)}\n`);
}
