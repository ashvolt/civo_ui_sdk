import { createRequire } from "node:module";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

/**
 * T-238, at the level that matters: what a bundler emits.
 *
 * Builds a page with esbuild and code splitting, the way an application would.
 * The page sets up the lazy base theme and a renderer but renders nothing. Its
 * entry chunk must contain no component code; each component group must be a
 * chunk of its own, fetched only by a dynamic `import()`.
 */

const root = resolve(dirname(fileURLToPath(import.meta.url)), "../../..");
/** The one esbuild call this test makes. esbuild is reached through tsup. */
interface Esbuild {
  build(options: Record<string, unknown>): Promise<{ outputFiles: { path: string; text: string }[] }>;
}
const esbuild = createRequire(createRequire(join(root, "package.json")).resolve("tsup/package.json"))(
  "esbuild",
) as Esbuild;

const alias = {
  "relax-ui-protocol": join(root, "packages/protocol/src/index.ts"),
  "relax-ui-render": join(root, "packages/render/src/index.ts"),
  "relax-ui-theme-base": join(root, "packages/theme-base/src/index.ts"),
};

/** Strings that exist only inside one component's template. */
const MARKERS = {
  Metric: "gen-metric__value",
  Chart: "gen-chart__bar",
  Table: "gen-table",
  layout: "gen-stack--",
  text: "gen-callout__title",
};

async function build(entry: string) {
  const result = await esbuild.build({
    stdin: { contents: entry, resolveDir: root, loader: "ts" },
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
  const entryFile = files.find((f) => f.path.endsWith("/stdin.js"))!;
  const chunks = files.filter((f) => f !== entryFile);
  // The entry and every chunk it imports statically, transitively: what loads
  // with the page, before any `import()` runs.
  const loaded = new Set([entryFile]);
  const queue = [entryFile];
  while (queue.length > 0) {
    const file = queue.pop()!;
    for (const [, name] of file.text.matchAll(/(?:from|import) "\.\/([^"]+)"/g)) {
      const chunk = chunks.find((c) => c.path.endsWith(`/${name}`));
      if (chunk && !loaded.has(chunk)) {
        loaded.add(chunk);
        queue.push(chunk);
      }
    }
  }
  return { entry: entryFile, chunks, withPage: [...loaded].map((f) => f.text).join("\n") };
}

describe("a page that renders nothing loads no component (T-238)", () => {
  it("the entry chunk carries no component code; each group is its own chunk", async () => {
    const { entry, chunks, withPage } = await build(`
      import { createCatalog, DomRenderer } from "relax-ui-render";
      import { baseLoaders } from "relax-ui-theme-base";
      const catalog = createCatalog({ loaders: baseLoaders });
      export const renderer = new DomRenderer(document.body, {
        catalog,
        types: Object.keys(baseLoaders),
        validate: "server",
      });
    `);

    for (const [name, marker] of Object.entries(MARKERS)) {
      expect(withPage.includes(marker), `${name} code loads with the page`).toBe(false);
      expect(chunks.some((c) => c.text.includes(marker)), `${name} has a chunk`).toBe(true);
    }
    // Reached only through import(), never a static import.
    expect(entry.text).toMatch(/import\(["']\.\/(chart|metric|table|layout|text)-/);
  });

  it("the eager base theme, by contrast, loads with the page", async () => {
    const { withPage } = await build(`
      import { baseTemplates } from "relax-ui-theme-base";
      export const t = baseTemplates;
    `);
    for (const marker of Object.values(MARKERS)) expect(withPage).toContain(marker);
  });

  it("the lazy loaders do not pull the eager templates in with them", async () => {
    const { withPage } = await build(`
      import { baseLoaders } from "relax-ui-theme-base";
      export const l = baseLoaders;
    `);
    for (const marker of Object.values(MARKERS)) expect(withPage).not.toContain(marker);
  });
});
