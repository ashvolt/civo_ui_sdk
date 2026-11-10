/**
 * Builds one page per renderer adapter into bench/dist: the page's script, an
 * HTML shell with the host element and the interaction target, and the base
 * theme's stylesheet for renderers that do not adopt it themselves.
 */
import { copyFileSync, mkdirSync, readdirSync, rmSync, writeFileSync } from "node:fs";
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

copyFileSync(require.resolve("relax-ui-theme-base/theme.css"), join(out, "theme.css"));
for (const f of pages) {
  const name = parse(f).name;
  writeFileSync(
    join(out, `${name}.html`),
    `<!doctype html><html lang="en"><head><meta charset="utf-8"><title>${name}</title>
<link rel="stylesheet" href="/theme.css">
<style>body{margin:0;font-family:system-ui}#bench-interact{position:fixed;top:4px;right:4px;z-index:1}#host{padding:8px}</style>
<script type="module" src="/${name}.js"></script></head>
<body><button id="bench-interact" type="button">interact</button><div id="host"></div></body></html>\n`,
  );
}
console.log(`built ${pages.length} bench pages`);
