import { createRequire } from "node:module";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

/**
 * FR-242 for the element, at the level that matters: what a bundler emits for
 * a page that registers `<gen-ui>`. Its entry, and every chunk the entry
 * imports statically, must hold no component template and no validator;
 * each of those is reached only through `import()`.
 */

const root = resolve(dirname(fileURLToPath(import.meta.url)), "../../..");
interface Esbuild {
  build(options: Record<string, unknown>): Promise<{ outputFiles: { path: string; text: string }[] }>;
}
const esbuild = createRequire(createRequire(join(root, "package.json")).resolve("tsup/package.json"))(
  "esbuild",
) as Esbuild;

const src = (pkg: string) => join(root, "packages", pkg, "src", "index.ts");
const alias = {
  "relax-ui-protocol": src("protocol"),
  "relax-ui-render": src("render"),
  "relax-ui-theme-base": src("theme-base"),
  "relax-ui-contract": src("contract"),
  "relax-ui-element": src("element"),
};

/** Function names that exist only in one template, or in the validator. */
const MARKERS = {
  layout: "function Stack(",
  text: "function Heading(",
  Metric: "function Metric(",
  Table: "function Table(",
  Chart: "function Chart(",
  validator: "ZodError",
};

describe("a page with <gen-ui> and no document loads no component and no validator (FR-242)", () => {
  it("component code and Zod are only in lazily imported chunks", async () => {
    const result = await esbuild.build({
      stdin: { contents: `import { defineGenUI } from "relax-ui-element"; defineGenUI();`, resolveDir: root, loader: "ts" },
      bundle: true,
      splitting: true,
      format: "esm",
      outdir: "out",
      write: false,
      minify: false,
      alias,
      logLevel: "silent",
      platform: "browser",
    });
    const files = result.outputFiles.map((f) => ({ path: f.path.replace(/\\/g, "/"), text: f.text }));
    const entry = files.find((f) => f.path.endsWith("/stdin.js"))!;
    const loaded = new Set([entry]);
    const queue = [entry];
    while (queue.length > 0) {
      const file = queue.pop()!;
      for (const [, name] of file.text.matchAll(/(?:from|import) "\.\/([^"]+)"/g)) {
        const chunk = files.find((c) => c.path.endsWith(`/${name}`));
        if (chunk && !loaded.has(chunk)) {
          loaded.add(chunk);
          queue.push(chunk);
        }
      }
    }
    const withPage = [...loaded].map((f) => f.text).join("\n");
    const lazy = files.filter((f) => !loaded.has(f)).map((f) => f.text).join("\n");
    for (const [name, marker] of Object.entries(MARKERS)) {
      expect(withPage.includes(marker), `${name} loads with the page`).toBe(false);
      expect(lazy.includes(marker), `${name} is in a lazy chunk`).toBe(true);
    }
  });
});
