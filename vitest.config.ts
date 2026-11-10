import { defineConfig } from "vitest/config";
import { fileURLToPath } from "node:url";

const r = (p: string) => fileURLToPath(new URL(p, import.meta.url));

export default defineConfig({
  resolve: {
    alias: {
      "relax-ui-protocol": r("./packages/protocol/src/index.ts"),
      "relax-ui-contract": r("./packages/contract/src/index.ts"),
      "relax-ui-theme-base": r("./packages/theme-base/src/index.ts"),
      "relax-ui-render": r("./packages/render/src/index.ts"),
      "relax-ui-element": r("./packages/element/src/index.ts"),
      "relax-ui-connect-react": r("./packages/connect-react/src/index.ts"),
      "relax-ui-connect-vue": r("./packages/connect-vue/src/index.ts"),
      "relax-ui-connect-angular": r("./packages/connect-angular/src/index.ts"),
      "relax-ui-core": r("./packages/core/src/index.ts"),
      "relax-ui-react": r("./packages/react/src/index.ts"),
      "relax-ui-next": r("./packages/next/src/index.ts"),
    },
  },
  test: {
    environment: "node",
    include: [
      "packages/*/test/**/*.test.ts",
      "packages/*/test/**/*.test.tsx",
      // The example's model-selection ordering decides what a reviewer sees on
      // first run, so it is covered here rather than left to a manual check.
      "examples/*/test/**/*.test.ts",
      // The benchmark's pure logic: generator, statistics, budgets, ladder.
      "bench/test/**/*.test.ts",
    ],
    globals: false,
  },
});
