import { defineConfig } from "vitest/config";
import { fileURLToPath } from "node:url";

const r = (p: string) => fileURLToPath(new URL(p, import.meta.url));

export default defineConfig({
  resolve: {
    alias: {
      "relax-ui-core": r("./packages/core/src/index.ts"),
      "relax-ui-react": r("./packages/react/src/index.ts"),
      "relax-ui-next": r("./packages/next/src/index.ts"),
    },
  },
  test: {
    environment: "node",
    include: ["packages/*/test/**/*.test.ts", "packages/*/test/**/*.test.tsx"],
    globals: false,
  },
});
