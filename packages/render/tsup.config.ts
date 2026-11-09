import { defineConfig } from "tsup";

export default defineConfig({
  entry: ["src/index.ts"],
  format: ["esm", "cjs"],
  // The URL guard and the error type come from `relax-ui-protocol`, compiled
  // in: this package takes no runtime dependency (T-260).
  dts: { resolve: ["relax-ui-protocol"] },
  noExternal: ["relax-ui-protocol"],
  clean: true,
  sourcemap: true,
  target: "es2022",
  treeshake: true,
});
