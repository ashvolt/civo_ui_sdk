/**
 * Deliberately broken renderers, for `pnpm bench:selftest` (T-404, T-408).
 * The harness must classify each correctly before any result is trusted:
 *
 *   ?mode=slow   blocks the main thread 80 ms per frame  → breaks on longestTask
 *   ?mode=wrong  drops a node after rendering            → breaks on correctness
 *   ?mode=hang   never reports done                      → breaks on timeout
 *   ?mode=ok     this SDK's element, untouched           → passes
 *   ?mode=warm   blocks 250 ms once, after the warm-up    → passes: the warm-up
 *                is not the run, though its long frame is reported late
 */
import { elementAdapter } from "../src/adapters/element.ts";
import { installHarness, type PageAdapter } from "../src/probe/page.ts";

const mode = new URLSearchParams(location.search).get("mode") ?? "ok";
const base = elementAdapter(`selftest-${mode}`);

const adapter: PageAdapter = {
  ...base,
  async mount(host) {
    const m = await base.mount(host);
    return {
      ...m,
      push(chunk) {
        if (mode === "slow") {
          const until = performance.now() + 80;
          while (performance.now() < until) {
            // busy: the point of this renderer
          }
        }
        m.push(chunk);
      },
      async done() {
        if (mode === "hang") return new Promise<void>(() => {});
        await m.done();
        if (mode === "warm") {
          requestAnimationFrame(() => {
            const until = performance.now() + 250;
            while (performance.now() < until) {
              // a slow first style pass, as lazy component code brings
            }
          });
        }
        if (mode === "wrong") {
          const nodes = m.root()?.querySelectorAll("p, h2, h3, h4, li, a");
          nodes?.[nodes.length - 1]?.remove();
        }
      },
    };
  },
};

installHarness(adapter);
