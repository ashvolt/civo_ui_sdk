/**
 * Bundles the Vue app with code splitting and copies Element Plus's stylesheet
 * next to it. Vue's runtime-only build: the app uses render functions, so there
 * is no template compiler and no `new Function` — `script-src 'self'` holds.
 */
import { copyFileSync, mkdirSync, rmSync } from "node:fs";
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
  entryPoints: { main: "src/main.ts" },
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
  define: {
    "process.env.NODE_ENV": '"production"',
    __VUE_OPTIONS_API__: "true",
    __VUE_PROD_DEVTOOLS__: "false",
    __VUE_PROD_HYDRATION_MISMATCH_DETAILS__: "false",
  },
  logLevel: "warning",
});

copyFileSync(require.resolve("element-plus/dist/index.css"), join(vendor, "element-plus.css"));
console.log("built examples/vue-host/public");
