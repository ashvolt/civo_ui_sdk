import { defineConfig } from "tsup";

export default defineConfig({
  entry: ["src/index.ts"],
  format: ["esm", "cjs"],
  // `relax-ui-protocol` is compiled into core, types included, rather than
  // depended on: core takes no runtime dependency (Constitution V, NFR-203).
  dts: { resolve: ["relax-ui-protocol"] },
  noExternal: ["relax-ui-protocol"],
  clean: true,
  sourcemap: true,
  target: "es2022",
  treeshake: true,
  external: ["zod"],
});
