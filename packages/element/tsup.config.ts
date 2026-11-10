import { defineConfig } from "tsup";

export default defineConfig({
  entry: ["src/index.ts", "src/define.ts"],
  // ESM only: lazy loading is dynamic import(), and a custom element is a
  // browser module.
  format: ["esm"],
  // The protocol, render core and base theme are compiled in, so the element
  // takes no runtime dependency (T-260). The contract stays a peer, reached by
  // a dynamic import only when a document is validated in the browser.
  dts: { resolve: ["relax-ui-protocol", "relax-ui-render", "relax-ui-theme-base"] },
  noExternal: ["relax-ui-protocol", "relax-ui-render", "relax-ui-theme-base"],
  external: ["relax-ui-contract", "zod"],
  splitting: true,
  clean: true,
  sourcemap: true,
  target: "es2022",
  treeshake: true,
});
