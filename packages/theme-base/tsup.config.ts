import { writeFileSync } from "node:fs";
import { resolve } from "node:path";
import { pathToFileURL } from "node:url";
import { defineConfig } from "tsup";

export default defineConfig({
  entry: ["src/index.ts"],
  format: ["esm", "cjs"],
  dts: true,
  clean: true,
  sourcemap: true,
  target: "es2022",
  treeshake: true,
  // The stylesheet is written from the strings the package exports, read back
  // from the build, so a linked theme.css and an adopted stylesheet can never
  // differ.
  async onSuccess() {
    const built = await import(`${pathToFileURL(resolve("dist/index.js")).href}?t=${Date.now()}`);
    writeFileSync("dist/theme.css", `/* relax-ui-theme-base */\n${String(built.themeCss).trim()}\n`);
  },
});
