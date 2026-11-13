/**
 * Builds one page per renderer adapter into bench/dist: the page's script, an
 * HTML shell with the host element and the interaction target, and the base
 * theme's stylesheet for renderers that do not adopt it themselves.
 *
 * Pages in `pages/` are bundled by esbuild. The Angular pages (`angular/`)
 * are built ahead of time by the Angular CLI, as an Angular app is (plan),
 * both at once, and copied to `dist/ng/<page>/`. `BENCH_SKIP_ANGULAR=1`
 * reuses the last Angular build.
 */
import { spawn } from "node:child_process";
import { copyFileSync, cpSync, existsSync, mkdirSync, readdirSync, rmSync, writeFileSync } from "node:fs";
import { createRequire } from "node:module";
import { dirname, join, parse } from "node:path";
import { fileURLToPath } from "node:url";
import { build } from "esbuild";

const here = dirname(fileURLToPath(import.meta.url));
const require = createRequire(import.meta.url);
const out = join(here, "dist");
rmSync(out, { recursive: true, force: true });
mkdirSync(out, { recursive: true });

const pages = readdirSync(join(here, "pages")).filter((f) => /\.(ts|tsx)$/.test(f));
await build({
  entryPoints: Object.fromEntries(pages.map((f) => [parse(f).name, join("pages", f)])),
  absWorkingDir: here,
  outdir: out,
  bundle: true,
  splitting: true,
  format: "esm",
  platform: "browser",
  target: "es2022",
  minify: true,
  sourcemap: true,
  jsx: "automatic",
  chunkNames: "chunks/[name]-[hash]",
  define: { "process.env.NODE_ENV": '"production"' },
  logLevel: "warning",
});

const ANGULAR = ["a2ui-angular", "ours-angular-host"];
const angularOut = join(here, "dist-angular");

/** Runs `ng build <project>`; rejects with its output if it fails. */
function ngBuild(project) {
  return new Promise((resolve, reject) => {
    const child = spawn("npx", ["ng", "build", project], { cwd: join(here, "angular"), shell: true });
    let log = "";
    child.stdout.on("data", (d) => (log += d));
    child.stderr.on("data", (d) => (log += d));
    child.on("close", (code) => (code === 0 ? resolve() : reject(new Error(`ng build ${project} failed:\n${log}`))));
  });
}

if (!(process.env.BENCH_SKIP_ANGULAR && ANGULAR.every((p) => existsSync(join(angularOut, p, "main.js"))))) {
  rmSync(angularOut, { recursive: true, force: true });
  await Promise.all(ANGULAR.map(ngBuild));
}
for (const p of ANGULAR) cpSync(join(angularOut, p), join(out, "ng", p), { recursive: true });

function shell(name, script) {
  writeFileSync(
    join(out, `${name}.html`),
    `<!doctype html><html lang="en"><head><meta charset="utf-8"><title>${name}</title>
<link rel="stylesheet" href="/theme.css">
<style>body{margin:0;font-family:system-ui}#bench-interact{position:fixed;top:4px;right:4px;z-index:1}#host{padding:8px}</style>
<script type="module" src="${script}"></script></head>
<body><button id="bench-interact" type="button">interact</button><div id="host"></div></body></html>\n`,
  );
}

copyFileSync(require.resolve("relax-ui-theme-base/theme.css"), join(out, "theme.css"));
for (const f of pages) shell(parse(f).name, `/${parse(f).name}.js`);
for (const p of ANGULAR) shell(p, `/ng/${p}/main.js`);
console.log(`built ${pages.length + ANGULAR.length} bench pages`);
