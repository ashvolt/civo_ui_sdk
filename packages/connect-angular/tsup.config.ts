import { defineConfig } from "tsup";

export default defineConfig({
  entry: ["src/index.ts"],
  format: ["esm"],
  // `defineConnector` is compiled in from the render core, so the only
  // dependency is the peer: @angular/core (T-260).
  dts: { resolve: ["relax-ui-render", "relax-ui-protocol"] },
  noExternal: ["relax-ui-render", "relax-ui-protocol"],
  external: ["@angular/core"],
  clean: true,
  sourcemap: true,
  target: "es2022",
  treeshake: true,
});
