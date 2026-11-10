import { defineConfig } from "tsup";

export default defineConfig({
  entry: ["src/index.ts"],
  format: ["esm"],
  // `defineConnector` is compiled in from the render core, so the only
  // dependencies are the peers: React and React DOM (T-260).
  dts: { resolve: ["relax-ui-render", "relax-ui-protocol"] },
  noExternal: ["relax-ui-render", "relax-ui-protocol"],
  external: ["react", "react-dom", "react-dom/client", "react/jsx-runtime"],
  clean: true,
  sourcemap: true,
  target: "es2022",
  treeshake: true,
});
