/**
 * Bundles the example's scripts with code splitting, as an application would,
 * and copies the theme libraries' stylesheets next to them. Every file is
 * served from the page's own origin: nothing from a CDN, so `script-src 'self'`
 * holds.
 */
import { copyFileSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { createRequire } from "node:module";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { build } from "esbuild";

const here = dirname(fileURLToPath(import.meta.url));
const require = createRequire(import.meta.url);
const out = join(here, "public", "dist");
const vendor = join(here, "public", "vendor");

rmSync(out, { recursive: true, force: true });
mkdirSync(vendor, { recursive: true });

await build({
  entryPoints: { main: "src/main.ts", light: "src/light.ts", empty: "src/empty.ts" },
  absWorkingDir: here,
  outdir: out,
  bundle: true,
  splitting: true,
  format: "esm",
  platform: "browser",
  target: "es2022",
  minify: true,
  sourcemap: true,
  chunkNames: "chunks/[name]-[hash]",
  logLevel: "warning",
});

copyFileSync(require.resolve("bootstrap/dist/css/bootstrap.min.css"), join(vendor, "bootstrap.min.css"));
copyFileSync(require.resolve("@shoelace-style/shoelace/dist/themes/light.css"), join(vendor, "shoelace-light.css"));
// Shoelace's dark theme applies to `:host` as well as `.sl-theme-dark`; adopted
// into a shadow root, `:host` would make that element dark whatever its
// variant. The class alone is what the connector switches.
const dark = readFileSync(require.resolve("@shoelace-style/shoelace/dist/themes/dark.css"), "utf8");
writeFileSync(join(vendor, "shoelace-dark.css"), dark.replace(/^:host,\s*/m, ""));
console.log("built examples/html-host/public");
